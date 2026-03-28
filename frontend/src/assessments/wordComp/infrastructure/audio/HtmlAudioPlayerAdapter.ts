/**
 * 단어 이해 (WordComp) 검사 - HTMLAudioElement 기반 오디오 플레이어 어댑터
 *
 * WordComp 도메인 전용 IAudioPlayer 인터페이스를 HTMLAudioElement로 구현한다.
 * shared/HtmlAudioPlayer 와는 달리 load 단계가 없으며, play(url)로 즉시 재생한다.
 *
 * 핵심 설계:
 * - ended 이벤트 핸들러 첫 줄에서 performance.now()를 즉시 캡처 (정밀한 반응 시간 측정)
 * - 이미 재생 중인 오디오가 있으면 stop() 후 새 Audio 객체를 생성
 * - onEnded/offEnded로 콜백 수명 주기를 명시적으로 관리
 */

import type { IAudioPlayer } from '../../domain/services/IAudioPlayer.js';

export class HtmlAudioPlayerAdapter implements IAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private _isPlaying: boolean = false;
  private endedCallback: ((endTimestamp: number) => void) | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * 오디오 URL을 재생한다.
   * 기존 오디오가 있으면 먼저 정지 후 새 Audio 객체를 생성한다.
   * ended 이벤트 발생 시 performance.now() 를 첫 줄에서 즉시 캡처하여 콜백에 전달한다.
   */
  async play(audioUrl: string): Promise<void> {
    this.stop();

    const audio = new Audio(audioUrl);
    this.audio = audio;

    audio.addEventListener(
      'ended',
      () => {
        // performance.now()를 이벤트 핸들러 첫 줄에서 즉시 캡처 (반응 시간 정밀도 보장)
        const endTimestamp = performance.now();
        this._isPlaying = false;
        this.endedCallback?.(endTimestamp);
      },
      { once: true },
    );

    this._isPlaying = true;
    await audio.play();
  }

  /**
   * 재생을 즉시 중단하고 위치를 초기화한다.
   * 이미 정지 상태인 경우 아무 동작도 하지 않는다.
   */
  stop(): void {
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this._isPlaying = false;
  }

  /**
   * 재생 완료 시 호출될 콜백을 등록한다.
   * 새 콜백을 등록하면 기존 콜백이 대체된다.
   *
   * @param callback - 재생 종료 시 호출되는 함수 (endTimestamp: performance.now() 기준 ms)
   */
  onEnded(callback: (endTimestamp: number) => void): void {
    this.endedCallback = callback;
  }

  /**
   * 등록된 ended 콜백을 해제한다.
   * 컴포넌트 언마운트 시 반드시 호출해야 메모리 누수를 방지할 수 있다.
   */
  offEnded(): void {
    this.endedCallback = null;
  }
}
