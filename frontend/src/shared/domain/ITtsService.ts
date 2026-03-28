/**
 * TTS(Text-to-Speech) 서비스 인터페이스
 *
 * Domain/Application 레이어에서 참조하는 추상 인터페이스.
 * 구현체는 Infrastructure 레이어(WebSpeechTtsService 등)에서 제공.
 *
 * 타이밍 측정 원칙:
 * - startTime, endTime 모두 performance.now() 기준
 * - Date.now() 사용 금지
 */

export interface TtsPlaybackResult {
  /** TTS 재생 시작 시각 (performance.now() 기준, ms) */
  readonly startTime: number;
  /** TTS 재생 종료 시각 (performance.now() 기준, ms) */
  readonly endTime: number;
  /** 재생 소요 시간 (ms) */
  readonly durationMs: number;
}

export interface ITtsService {
  /**
   * 텍스트를 음성으로 재생한다.
   * 재생 완료 후 TtsPlaybackResult를 resolve한다.
   * 재생 실패 시 reject한다.
   */
  speak(text: string): Promise<TtsPlaybackResult>;

  /**
   * 현재 재생 중인 음성을 즉시 중단한다.
   */
  cancel(): void;
}
