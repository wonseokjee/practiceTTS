/**
 * 단어 이해 (WordComp) 검사 - 도메인 전용 오디오 플레이어 인터페이스
 *
 * shared/domain/IAudioPlayer 와는 다른 WordComp 검사 도메인 전용 계약이다.
 * 콜백 기반으로 ended 이벤트를 수신하며,
 * audioEndTimestamp는 performance.now() 기준으로 캡처된다.
 *
 * 설계 원칙:
 * - play(audioUrl): URL을 받아 즉시 재생 (load 단계 없음)
 * - onEnded: 재생 완료 시 performance.now() timestamp를 전달하는 콜백 등록
 * - offEnded: 콜백 해제 (언마운트 시 호출)
 */

export interface IAudioPlayer {
  /**
   * 오디오 URL을 재생한다.
   * 이미 재생 중인 오디오가 있으면 먼저 정지한 후 새 오디오를 재생한다.
   */
  play(audioUrl: string): Promise<void>;

  /**
   * 재생을 즉시 중단하고 위치를 초기화한다.
   */
  stop(): void;

  /**
   * 재생 완료 시 호출될 콜백을 등록한다.
   * endTimestamp는 performance.now() 기준 재생 종료 시각(ms)이다.
   *
   * @param callback - 재생 종료 시 호출되는 함수
   */
  onEnded(callback: (endTimestamp: number) => void): void;

  /**
   * 등록된 ended 콜백을 해제한다.
   * 컴포넌트 언마운트 시 반드시 호출해야 한다.
   */
  offEnded(): void;

  /** 현재 재생 중 여부 */
  readonly isPlaying: boolean;
}
