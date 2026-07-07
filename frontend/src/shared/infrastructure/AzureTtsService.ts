// 서버 TTS 구현 (ITtsService) — ai-service /tts의 Azure 뉴럴 음성 MP3를 재생한다.
//
// speak(text): GET /tts?text=... URL을 <audio>(IAudioPlayer)로 로드·재생한다.
//   서버/네트워크 실패 시 브라우저 Web Speech로 폴백한다(로봇이지만 무음보다 낫다).
// 엔진 선택(서버 vs Web Speech)은 ttsFactory가 조립 시점에 담당한다.

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';

/** ai-service 베이스 URL (기본 로컬 8000). CORS는 ai-service에서 5173 허용됨. */
const AI_SERVICE_URL =
  (import.meta.env.VITE_AI_SERVICE_URL as string | undefined) ??
  'http://localhost:8000';

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
    baseUrl: string = AI_SERVICE_URL,
    voice: string = DEFAULT_VOICE,
  ) {
    this.audioPlayer = audioPlayer;
    this.fallback = fallback;
    this.baseUrl = baseUrl;
    this.voice = voice;
  }

  async speak(text: string): Promise<TtsPlaybackResult> {
    const url =
      `${this.baseUrl}/tts` +
      `?text=${encodeURIComponent(text)}` +
      `&voice=${encodeURIComponent(this.voice)}`;
    try {
      // load만 타임아웃으로 제한(서버 무응답 시 버튼이 영구히 "재생 중"에 갇히지 않게).
      await this.withTimeout(this.audioPlayer.load(url), LOAD_TIMEOUT_MS);
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
    }
  }

  cancel(): void {
    this.audioPlayer.stop();
    this.fallback.cancel();
  }

  /** load가 ms 내 완료되지 않으면 재생기를 멈추고 거부한다(폴백 유도). */
  private withTimeout(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.audioPlayer.stop();
        reject(new Error('TTS 서버 응답이 지연됩니다.'));
      }, ms);
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}
