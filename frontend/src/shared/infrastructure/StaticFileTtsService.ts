/**
 * 정적 오디오 파일 기반 TTS 서비스 구현체
 *
 * ITtsService 계약을 구현하며, 텍스트→URL 매핑(manifest)을 통해
 * 사전 생성된 MP3 파일을 재생한다. 매핑이 없는 텍스트는 fallback
 * TTS 서비스에 위임한다.
 *
 * 설계 원칙:
 * - 생성자 주입: manifest, audioPlayer, fallback 모두 외부 주입
 *   (테스트 시 Mock으로 교체 가능)
 * - 의존성 역전: IAudioPlayer 인터페이스에만 의존
 *   (HtmlAudioPlayer 구체 클래스를 직접 참조하지 않음)
 * - 개방-폐쇄: manifest에 항목 추가만으로 새 음성 지원 가능
 *   (이 클래스 코드 수정 불필요)
 *
 * speak() 동작:
 *   1. manifest[text] 조회
 *   2. URL 존재 → audioPlayer.load(url) → audioPlayer.play() → TtsPlaybackResult 반환
 *   3. URL 없음 → fallback.speak(text) 위임
 *
 * cancel() 동작:
 *   audioPlayer.stop() + fallback.cancel() 동시 호출
 *   (현재 어떤 경로로 재생 중인지와 무관하게 두 곳 모두 정지)
 */

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';
import type { StaticTtsManifest } from '../../assets/data/staticTtsManifest.js';

export class StaticFileTtsService implements ITtsService {
  private readonly manifest: StaticTtsManifest;
  private readonly audioPlayer: IAudioPlayer;
  private readonly fallback: ITtsService;

  constructor(
    manifest: StaticTtsManifest,
    audioPlayer: IAudioPlayer,
    fallback: ITtsService,
  ) {
    this.manifest = manifest;
    this.audioPlayer = audioPlayer;
    this.fallback = fallback;
  }

  /**
   * 텍스트를 음성으로 재생한다.
   *
   * manifest에 매핑이 존재하면 정적 파일로 재생하고,
   * 없으면 fallback TTS 서비스로 위임한다.
   *
   * @param text - 재생할 텍스트 (매니페스트 키와 정확히 일치해야 함)
   * @returns TtsPlaybackResult (startTime, endTime, durationMs)
   * @throws 파일 로드 실패 또는 fallback 재생 실패 시 에러
   */
  async speak(text: string): Promise<TtsPlaybackResult> {
    const url = this.manifest[text];

    // URL 없음: fallback TTS에 위임
    if (url === undefined) {
      return this.fallback.speak(text);
    }

    // URL 있음: 정적 파일 재생
    // startTime은 load() 완료 후, play() 호출 직전에 기록한다.
    // load 시간은 측정 범위에서 제외하며, 브라우저 HTTP 캐시가 이후 호출을 처리한다.
    await this.audioPlayer.load(url);
    const startTime = performance.now();
    const endTime = await this.audioPlayer.play();

    return Object.freeze<TtsPlaybackResult>({
      startTime,
      endTime,
      durationMs: endTime - startTime,
    });
  }

  /**
   * 현재 재생 중인 오디오를 즉시 중단한다.
   *
   * audioPlayer.stop()과 fallback.cancel()을 모두 호출한다.
   * HtmlAudioPlayer.stop()은 audio가 null이어도 안전하며,
   * WebSpeechTtsService.cancel()도 재생 중이 아니면 no-op이다.
   */
  cancel(): void {
    this.audioPlayer.stop();
    this.fallback.cancel();
  }
}
