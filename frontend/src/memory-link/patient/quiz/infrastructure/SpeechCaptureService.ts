// 발화 캡처 서비스 — 따라말하기(검사6)·읽기(검사7)에서 마이크를 녹음해
// "전사 + (가능하면) 음소 단위 발음 점수"를 함께 돌려준다.
//
// 서버 발음 평가(/ai/pronunciation)가 가능하면 Azure 음소 점수(azure≠null)를,
// 실패하면 같은 녹음을 /ai/stt로 재시도해 전사만(azure=null) 돌려준다. 서버 녹음
// 자체가 불가능한 환경(WebSpeech)에서는 브라우저 인식으로 폴백한다(azure=null).
//
// azure가 있으면 상위(useMixedQuizSession)는 evaluateFromAzure로, 없으면
// evaluateSpeech(문자열 근접도)로 채점한다.

import type { SttResult } from '../../domain/TrainingSession.js';
import type { AzurePronunciationScores } from '../domain/pronunciationScore.js';
import type {
  CompetitorInfo,
  CompetitorScore,
} from '../domain/neighborScoring.js';
import { WebSpeechSttService } from '../../infrastructure/SttService.js';
import { WavRecorder } from './WavRecorder.js';
import { QUIZ_RECORDING_LIMIT_MS } from './recordingLimits.js';
import { API_BASE_URL, ML_TOKEN_KEY } from '../../../shared/MemoryLinkApi.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { i18n } from '../../../../shared/i18n/i18n.js';

/** 발화 캡처 결과 — 전사 + (있으면) Azure 음소 점수. */
export interface SpeechCaptureResult {
  transcript: string;
  confidence: number;
  azure: AzurePronunciationScores | null;
  /**
   * 이웃 비교 채점의 경쟁자 결과.
   *
   *  - `undefined`: 경쟁자 모드를 요청하지 않았다(이전 채점 그대로)
   *  - `null`: 요청했는데 경쟁자 결과를 못 얻었다(옛 서버 · 인식 폴백). 호출한 쪽이 채점 불가로 다룬다
   *  - 객체: 서버가 돌려준 경쟁자 점수
   *
   * `undefined`와 `null`을 가르는 이유: 이웃 비교를 **요청한 시도**는 실패해도 그 채점기의 시도로
   * 기록돼야 한다(`scorer_version`). 요청하지 않은 시도와 섞으면 버전 표시가 거짓이 된다.
   */
  competitors?: CompetitorInfo | null;
}

/** 녹음 시작 옵션. */
export interface SpeechCaptureStartOptions {
  /**
   * 이웃 비교 채점에 쓸 이웃 단어(목표와 소리가 가까운 앱 단어). 비어 있지 않으면 경쟁자 모드다 —
   * 같은 녹음을 이 단어들과 후보 없이 인식한 결과로도 채점하도록 서버에 요청한다.
   * 없거나 비면 예전과 같은 요청이다.
   */
  neighbors?: readonly string[];
}

/** 발화 캡처 서비스 공통 인터페이스. */
export interface ISpeechCaptureService {
  /** 녹음 시작. referenceText는 정답(목표) 텍스트 — 발음 평가 기준 + phrase hint. */
  start(referenceText: string, options?: SpeechCaptureStartOptions): void;
  /** 녹음 종료 → 평가/인식 실행. */
  stop(): void;
  /** 취소 — 업로드/평가 없이 마이크를 해제하고 진행 중 요청을 중단한다.
   *  문항 이탈/언마운트 시 호출해, 환자 음성이 화면을 떠난 뒤 서버로 올라가지
   *  않게 한다(불필요한 업로드·비용 방지). stop()과 달리 결과를 만들지 않는다. */
  cancel(): void;
  onResult: ((result: SpeechCaptureResult) => void) | null;
  onError: ((error: string) => void) | null;
}

/** 서버 응답 대기 상한(ms). 초과 시 abort하고 폴백/안내한다. */
const FETCH_TIMEOUT_MS = 12000;

/** /pronunciation 응답(점수 부분)의 원시 형태. */
interface RawPronunciation {
  recognized_text?: string;
  accuracy_score?: number;
  fluency_score?: number;
  completeness_score?: number;
  pronunciation_score?: number;
  prosody_score?: number | null;
  // 경쟁자 모드에서만 온다(ai-service response_model_exclude_unset)
  competitor_scores?: {
    text: string;
    source: 'neighbor' | 'stt';
    accuracy_score: number;
    recognized_text: string;
    status: 'ok' | 'no_match' | 'error';
  }[];
  stt_transcript?: string | null;
  stt_status?: 'ok' | 'empty' | 'error' | null;
  competitors_skipped?: 'target_below_pass' | 'no_match' | null;
}

/**
 * 경쟁자 모드 응답을 정리한다. 경쟁자 모드에서는 서버가 `stt_status`를 **항상** 싣는다 —
 * 없으면 서버가 경쟁자 모드를 모르는 것(옛 서버)이라 null이다.
 */
export function parseCompetitorInfo(data: RawPronunciation): CompetitorInfo | null {
  if (!('stt_status' in data)) return null;
  const scores: CompetitorScore[] | null = data.competitor_scores
    ? data.competitor_scores.map((c) => ({
        text: c.text,
        source: c.source,
        accuracyScore: c.accuracy_score,
        recognizedText: c.recognized_text,
        status: c.status,
      }))
    : null;
  return {
    scores,
    sttTranscript: data.stt_transcript ?? null,
    sttStatus: data.stt_status ?? null,
    skipped: data.competitors_skipped ?? null,
  };
}

/**
 * 서버 발음 평가 캡처 서비스.
 * 한 번 녹음해 /ai/pronunciation → (실패 시) /ai/stt 순으로 시도한다.
 */
export class ServerPronunciationService implements ISpeechCaptureService {
  onResult: ((result: SpeechCaptureResult) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  // 퀴즈 답변용이라 상한(30초)에서 스스로 끊는다.
  private readonly recorder = new WavRecorder({
    maxDurationMs: QUIZ_RECORDING_LIMIT_MS,
    onLimitReached: () => {
      if (!this.isRecording) return;
      this.stop();
    },
  });
  private readonly lang: string;
  private referenceText = '';
  private neighbors: readonly string[] = [];
  private isRecording = false;
  private startPromise: Promise<void> | null = null;
  private startFailed = false;
  // 취소 여부 + 진행 중 fetch 핸들. cancel()이 이 둘로 업로드를 막고 중단한다.
  private cancelled = false;
  private inflight: AbortController | null = null;

  constructor(lang: string = DEFAULT_LOCALE) {
    this.lang = lang;
  }

  start(referenceText: string, options?: SpeechCaptureStartOptions): void {
    if (this.isRecording) return;
    this.referenceText = referenceText ?? '';
    this.neighbors = options?.neighbors ?? [];
    this.isRecording = true;
    this.startFailed = false;
    this.cancelled = false;
    this.startPromise = this.recorder.start().catch(() => {
      this.isRecording = false;
      this.startFailed = true;
      this.onError?.(i18n.t('sttError.micStartFailed', { ns: 'quiz' }));
    });
  }

  stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;
    void this.evaluate();
  }

  cancel(): void {
    this.cancelled = true;
    const wasRecording = this.isRecording;
    this.isRecording = false;
    // 진행 중인 업로드가 있으면 중단한다.
    this.inflight?.abort();
    // 녹음 중이었다면 마이크만 해제(업로드하지 않음). stop()이 이미 처리 중이면
    // (isRecording=false) 이중 정지하지 않는다.
    if (wasRecording) {
      void this.recorder.stop().catch(() => {});
    }
  }

  private async evaluate(): Promise<void> {
    await this.startPromise;
    if (this.startFailed || this.cancelled) return;

    let wav: Blob;
    try {
      wav = await this.recorder.stop();
    } catch {
      this.onError?.(i18n.t('sttError.recordingFailed', { ns: 'quiz' }));
      return;
    }
    // 녹음을 처리하는 사이 취소됐으면 업로드하지 않는다.
    if (this.cancelled) return;

    const token = localStorage.getItem(ML_TOKEN_KEY);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    // 1차: 발음 평가(음소 점수 포함)
    const assessed = await this.tryAssess(wav, authHeaders);
    if (this.cancelled) return;
    if (assessed) {
      this.onResult?.(assessed);
      return;
    }
    // 2차: 같은 녹음을 STT로(전사만, azure=null) — 최소 문자열 채점은 유지
    const recognized = await this.tryStt(wav, authHeaders);
    if (this.cancelled) return;
    if (recognized) {
      // 이웃 비교를 요청했다면 그 시도는 경쟁자 결과 없이 끝난 것이다(null) — 요청 안 한 시도(undefined)와 다르다.
      this.onResult?.({
        ...recognized,
        azure: null,
        ...(this.neighbors.length > 0 ? { competitors: null } : {}),
      });
      return;
    }
    this.onError?.(i18n.t('sttError.pronunciationServerConnectFailed', { ns: 'quiz' }));
  }

  /** /ai/pronunciation 호출. 성공 시 점수 포함 결과, 실패 시 null. */
  private async tryAssess(
    wav: Blob,
    authHeaders: Record<string, string> | undefined,
  ): Promise<SpeechCaptureResult | null> {
    const controller = new AbortController();
    this.inflight = controller; // cancel()이 이 요청을 중단할 수 있게 등록
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append('audio', wav, 'speech.wav');
      form.append('lang', this.lang);
      form.append('reference_text', this.referenceText);
      // 이웃 비교 채점: 이웃과 함께 후보 없는 인식 결과도 경쟁자로 채점해 달라고 요청한다.
      // 이웃이 없으면 아무것도 안 싣는다 — 서버가 받는 폼이 예전과 같다.
      if (this.neighbors.length > 0) {
        form.append('competitors', JSON.stringify(this.neighbors));
        form.append('stt_competitor', 'true');
      }

      const res = await fetch(`${API_BASE_URL}/ai/pronunciation`, {
        method: 'POST',
        body: form,
        headers: authHeaders,
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as RawPronunciation;
      return {
        transcript: (data.recognized_text ?? '').trim(),
        confidence: 0,
        azure: {
          accuracyScore: data.accuracy_score ?? 0,
          fluencyScore: data.fluency_score ?? 0,
          completenessScore: data.completeness_score ?? 0,
          pronunciationScore: data.pronunciation_score ?? 0,
          prosodyScore: data.prosody_score ?? null,
        },
        ...(this.neighbors.length > 0
          ? { competitors: parseCompetitorInfo(data) }
          : {}),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.inflight = null;
    }
  }

  /** /ai/stt 폴백. 성공 시 전사 결과, 실패 시 null. */
  private async tryStt(
    wav: Blob,
    authHeaders: Record<string, string> | undefined,
  ): Promise<SttResult | null> {
    const controller = new AbortController();
    this.inflight = controller; // cancel()이 이 요청을 중단할 수 있게 등록
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append('audio', wav, 'speech.wav');
      form.append('lang', this.lang);
      if (this.referenceText.length > 0) {
        form.append('candidates', this.referenceText);
      }
      const res = await fetch(`${API_BASE_URL}/ai/stt`, {
        method: 'POST',
        body: form,
        headers: authHeaders,
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        transcript?: string;
        confidence?: number;
      };
      const transcript = (data.transcript ?? '').trim();
      if (transcript.length === 0) return null;
      return { transcript, confidence: data.confidence ?? 0 };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.inflight = null;
    }
  }
}

/**
 * WebSpeech 어댑터 — 서버 녹음이 불가능한 환경에서 브라우저 인식으로 폴백.
 * 음소 점수는 낼 수 없으므로 azure=null(상위는 문자열 채점으로 폴백).
 */
export class WebSpeechCaptureAdapter implements ISpeechCaptureService {
  onResult: ((result: SpeechCaptureResult) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  private readonly stt = new WebSpeechSttService();

  constructor() {
    this.stt.onResult = (r: SttResult) => {
      this.onResult?.({
        transcript: r.transcript,
        confidence: r.confidence,
        azure: null,
      });
    };
    this.stt.onError = (msg: string) => this.onError?.(msg);
  }

  // 인터페이스의 두 번째 인자(options — 이웃 비교 경쟁자 모드)는 받지 않는다. 경쟁자 채점은 서버 녹음이
  // 필요해서 브라우저 인식에서는 쓸 수 없다. 결과에 competitors 키가 없으니 호출한 쪽은 이전 채점으로 간다.
  start(referenceText: string): void {
    // WebSpeech는 phrase hint 미지원 — referenceText를 후보로만 넘긴다(무시됨).
    this.stt.start(referenceText.length > 0 ? [referenceText] : undefined);
  }

  stop(): void {
    this.stt.stop();
  }

  cancel(): void {
    // 브라우저 인식은 서버 업로드가 없다. 인식만 중단하면 된다.
    this.stt.stop();
  }
}

function canUseServerCapture(): boolean {
  if (import.meta.env.VITE_USE_SERVER_STT === 'false') return false;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  const hasMic = typeof navigator.mediaDevices?.getUserMedia === 'function';
  const hasAudioCtx =
    typeof window.AudioContext === 'function' ||
    typeof (window as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext === 'function';
  return hasMic && hasAudioCtx;
}

/**
 * 발화 캡처 서비스를 생성한다.
 * 서버 녹음 가능 → 발음 평가(음소 점수), 아니면 → WebSpeech(전사만).
 */
export function createSpeechCaptureService(
  lang: string = DEFAULT_LOCALE,
): ISpeechCaptureService {
  return canUseServerCapture()
    ? new ServerPronunciationService(lang)
    : new WebSpeechCaptureAdapter();
}
