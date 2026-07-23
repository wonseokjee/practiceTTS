// 서버 TTS 구현 (ITtsService) — 백엔드 /ai/tts의 Azure 뉴럴 음성 MP3를 재생한다.
//
// speak(text): GET /ai/tts?text=... 를 fetch로 받아 Blob URL로 재생한다.
//   서버/네트워크 실패 시 브라우저 Web Speech로 폴백한다(로봇이지만 무음보다 낫다).
// 엔진 선택(서버 vs Web Speech)은 ttsFactory가 조립 시점에 담당한다.

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';
import { API_BASE_URL, ML_TOKEN_KEY } from '../../memory-link/shared/MemoryLinkApi.js';

// ai-service를 브라우저가 직접 부르지 않는다 — 그 경로만 인증을 걸 수 없어
// 누구나 Azure 음성 할당량을 태울 수 있다. 백엔드 프록시를 거쳐 JWT로 막는다.

/** 기본 음성 (따뜻한 여성, ai-service 기본과 동일). */
const DEFAULT_VOICE = 'ko-KR-SunHiNeural';

/**
 * 서버 응답(오디오 로드) 대기 상한(ms). 초과 시 재생을 멈추고 Web Speech로 폴백한다.
 * 재생(play) 자체는 실제 음성 길이만큼 걸리므로 타임아웃하지 않고 load만 제한한다.
 */
const LOAD_TIMEOUT_MS = 10000;

/** Azure 서버 TTS 서비스 (뉴럴 음성 MP3 재생 + Web Speech 폴백). */
export class AzureTtsService implements ITtsService {
  private readonly audioPlayer: IAudioPlayer;
  private readonly fallback: ITtsService;
  private readonly baseUrl: string;
  private readonly voice: string;

  constructor(
    audioPlayer: IAudioPlayer,
    fallback: ITtsService,
    baseUrl: string = API_BASE_URL,
    voice: string = DEFAULT_VOICE,
  ) {
    this.audioPlayer = audioPlayer;
    this.fallback = fallback;
    this.baseUrl = baseUrl;
    this.voice = voice;
  }

  async speak(text: string): Promise<TtsPlaybackResult> {
    // URL을 <audio src>에 바로 넣지 않고 fetch로 받아 Blob URL로 재생한다.
    // <audio>는 헤더를 못 붙여서 인증 토큰을 URL에 실어야 하는데, URL은 로그·기록에
    // 남는다. fetch로 받으면 Authorization 헤더를 쓸 수 있다.
    let objectUrl: string | null = null;
    try {
      objectUrl = await this.withTimeout(this.fetchAudio(text), LOAD_TIMEOUT_MS);
      await this.withTimeout(this.audioPlayer.load(objectUrl), LOAD_TIMEOUT_MS);
      const startTime = performance.now();
      const endTime = await this.audioPlayer.play();
      return Object.freeze<TtsPlaybackResult>({
        startTime,
        endTime,
        durationMs: endTime - startTime,
      });
    } catch {
      // 서버/네트워크/합성/타임아웃 실패 → 브라우저 음성으로 폴백.
      return this.fallback.speak(text);
    } finally {
      // 재생이 끝났든 실패했든 Blob은 반드시 해제한다(안 하면 메모리에 쌓인다).
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    }
  }

  /** 백엔드 프록시에서 오디오를 받아 재생 가능한 Blob URL을 만든다. */
  private async fetchAudio(text: string): Promise<string> {
    const token = localStorage.getItem(ML_TOKEN_KEY);
    const url =
      `${this.baseUrl}/ai/tts` +
      `?text=${encodeURIComponent(text)}` +
      `&voice=${encodeURIComponent(this.voice)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }

  cancel(): void {
    this.audioPlayer.stop();
    this.fallback.cancel();
  }

  /** 받기·로드가 ms 내 끝나지 않으면 재생기를 멈추고 거부한다(폴백 유도). */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.audioPlayer.stop();
        reject(new Error('TTS 서버 응답이 지연됩니다.'));
      }, ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}
