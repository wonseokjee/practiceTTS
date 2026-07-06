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
      await this.audioPlayer.load(url);
      const startTime = performance.now();
      const endTime = await this.audioPlayer.play();
      return Object.freeze<TtsPlaybackResult>({
        startTime,
        endTime,
        durationMs: endTime - startTime,
      });
    } catch {
      // 서버/네트워크/합성 실패 → 브라우저 음성으로 폴백.
      return this.fallback.speak(text);
    }
  }

  cancel(): void {
    this.audioPlayer.stop();
    this.fallback.cancel();
  }
}
