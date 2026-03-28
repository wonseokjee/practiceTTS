/**
 * 오디오 재생기 인터페이스
 *
 * Domain/Application 레이어에서 참조하는 추상 인터페이스.
 * 구현체는 Infrastructure 레이어(HtmlAudioPlayer 등)에서 제공.
 *
 * 타이밍 측정 원칙:
 * - play() 반환값은 performance.now() 기준 재생 완료 시각
 * - Date.now() 사용 금지
 */

export interface IAudioPlayer {
  /**
   * 오디오 파일을 로드한다.
   * canplaythrough 이벤트까지 대기 후 resolve.
   * 로드 실패 시 reject.
   */
  load(url: string): Promise<void>;

  /**
   * 현재 로드된 오디오를 재생한다.
   * 재생 완료(ended 이벤트) 시 performance.now() 기준 종료 timestamp를 resolve.
   * 재생 실패 시 reject.
   */
  play(): Promise<number>;

  /** 재생을 즉시 중단하고 위치를 초기화한다 */
  stop(): void;

  /** 현재 재생 중 여부 */
  readonly isPlaying: boolean;

  /** 오디오가 로드 완료된 상태인지 여부 */
  readonly isLoaded: boolean;
}
