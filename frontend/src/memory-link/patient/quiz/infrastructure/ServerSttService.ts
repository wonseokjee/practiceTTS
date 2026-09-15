// 서버 STT 구현 (ISttService) — 마이크를 WAV로 녹음해 백엔드 /ai/stt로 인식한다.
//
// start(candidates): 녹음 시작 + 정답 후보(phrase hint) 저장.
// stop(): 녹음 종료 → WAV 인코딩 → POST /stt → onResult/onError.
//
// 실패(마이크·서버·인식) 시 onError로 알린다. 엔진 선택(서버 vs Web Speech)은
// sttFactory가 조립 시점에 담당한다(런타임 오디오 소실 방지).

import type { SttResult } from '../../domain/TrainingSession.js';
import type { ISttService } from '../../infrastructure/SttService.js';
import { WavRecorder } from './WavRecorder.js';
import { QUIZ_RECORDING_LIMIT_MS } from './recordingLimits.js';
import { API_BASE_URL, ML_TOKEN_KEY } from '../../../shared/MemoryLinkApi.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { i18n } from '../../../../shared/i18n/i18n.js';

// ai-service를 브라우저가 직접 부르지 않는다. 그러면 그 경로만 인증을 걸 수 없어
// 누구나 Azure 음성 할당량을 태울 수 있다. 백엔드 프록시를 거쳐 JWT로 막는다.

/** /stt 응답 대기 상한(ms). 초과 시 요청을 abort하고 폴백 안내한다. */
const FETCH_TIMEOUT_MS = 10000;

/** Azure 서버 STT 서비스 (WAV 녹음 + phrase hint 제약 인식). */
export class ServerSttService implements ISttService {
  onResult: ((result: SttResult) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  // 퀴즈 답변용이라 30초에서 스스로 끊는다. 상한에 닿으면 그때까지 녹음된
  // 발화를 그대로 인식으로 넘긴다 — 서버가 크기로 거부해 답변이 통째로
  // 사라지는 것보다 훨씬 낫다.
  private readonly recorder = new WavRecorder({
    maxDurationMs: QUIZ_RECORDING_LIMIT_MS,
    onLimitReached: () => {
      // 이미 stop()이 진행 중이면 중복 인식하지 않는다.
      if (!this.isRecording) return;
      this.stop();
    },
  });
  private readonly lang: string;
  private candidates: string[] = [];
  private isRecording = false;
  // recorder.start()는 마이크 권한으로 비동기다. 시작 완료 전 stop()이 눌리는
  // 경합에 대비해 시작 프로미스를 보관하고, recognize()에서 이를 기다린다.
  private startPromise: Promise<void> | null = null;
  private startFailed = false;
  // 취소 여부 + 진행 중 fetch 핸들. cancel()이 이탈 시 업로드를 막고 중단한다.
  private cancelled = false;
  private inflight: AbortController | null = null;

  constructor(lang: string = DEFAULT_LOCALE) {
    this.lang = lang;
  }

  start(candidates?: string[]): void {
    if (this.isRecording) return;
    this.candidates = candidates ?? [];
    this.isRecording = true;
    this.startFailed = false;
    this.cancelled = false;
    // catch로 거부를 흡수해 startPromise는 항상 resolve → 미대기 unhandled rejection 방지.
    this.startPromise = this.recorder.start().catch(() => {
      this.isRecording = false;
      this.startFailed = true;
      this.onError?.(i18n.t('sttError.micStartFailed', { ns: 'quiz' }));
    });
  }

  stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;
    void this.recognize();
  }

  cancel(): void {
    // 이탈/언마운트: 녹음된 음성을 서버로 올리지 않고 마이크만 해제한다.
    this.cancelled = true;
    const wasRecording = this.isRecording;
    this.isRecording = false;
    this.inflight?.abort();
    if (wasRecording) {
      void this.recorder.stop().catch(() => {});
    }
  }

  private async recognize(): Promise<void> {
    // 녹음 시작이 끝나기 전 stop이 눌렸을 수 있으므로 시작 완료를 먼저 기다린다.
    await this.startPromise;
    if (this.startFailed || this.cancelled) return;

    let wav: Blob;
    try {
      wav = await this.recorder.stop();
    } catch {
      this.onError?.(i18n.t('sttError.recordingFailed', { ns: 'quiz' }));
      return;
    }
    if (this.cancelled) return; // 처리 중 이탈했으면 업로드하지 않는다.

    // 서버가 무응답이면 UI가 "듣는 중"에 갇히지 않도록 타임아웃으로 abort한다.
    const controller = new AbortController();
    this.inflight = controller; // cancel()이 이 요청을 중단할 수 있게 등록
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append('audio', wav, 'speech.wav');
      form.append('lang', this.lang);
      for (const candidate of this.candidates) {
        form.append('candidates', candidate);
      }

      const token = localStorage.getItem(ML_TOKEN_KEY);
      const res = await fetch(`${API_BASE_URL}/ai/stt`, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`STT ${res.status}`);

      const data = (await res.json()) as {
        transcript?: string;
        confidence?: number;
      };
      if (this.cancelled) return; // 응답 대기 중 이탈했으면 결과를 버린다.
      const transcript = (data.transcript ?? '').trim();
      if (transcript.length === 0) {
        this.onError?.(i18n.t('sttError.noResult', { ns: 'quiz' }));
        return;
      }
      this.onResult?.({ transcript, confidence: data.confidence ?? 0 });
    } catch {
      if (this.cancelled) return; // 취소로 인한 abort는 오류로 알리지 않는다.
      this.onError?.(i18n.t('sttError.serverConnectFailed', { ns: 'quiz' }));
    } finally {
      clearTimeout(timer);
      this.inflight = null;
    }
  }
}
