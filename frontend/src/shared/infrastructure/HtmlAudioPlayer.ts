/**
 * HTMLAudioElement 기반 오디오 재생기 구현체
 *
 * IAudioPlayer 인터페이스를 구현한다.
 * 실제 오디오 파일이 없을 경우 load()에서 에러를 throw하며,
 * 호출자(Application 레이어)에서 적절한 에러로 래핑해야 한다.
 *
 * 주의사항:
 * - load()를 먼저 호출하지 않고 play() 하면 에러 발생
 * - 동일 인스턴스로 다른 URL을 재생하려면 load()를 다시 호출해야 한다
 */

import type { IAudioPlayer } from '../domain/IAudioPlayer.js';

export class HtmlAudioPlayer implements IAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private _isPlaying: boolean = false;
  private _isLoaded: boolean = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * 오디오 파일을 로드한다.
   * canplaythrough 이벤트를 기다린 후 resolve한다.
   * 파일을 찾을 수 없거나 네트워크 오류 시 reject한다.
   */
  load(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 이전 오디오 정리
      this.cleanupAudio();

      const audio = new Audio(url);
      this.audio = audio;
      this._isLoaded = false;

      const onCanPlayThrough = () => {
        cleanup();
        this._isLoaded = true;
        resolve();
      };

      const onError = () => {
        cleanup();
        this._isLoaded = false;
        this.audio = null;
        reject(new Error(`오디오 파일 로드 실패: ${url}`));
      };

      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onCanPlayThrough);
        audio.removeEventListener('error', onError);
      };

      audio.addEventListener('canplaythrough', onCanPlayThrough);
      audio.addEventListener('error', onError);

      // 로드 시작
      audio.load();
    });
  }

  /**
   * 현재 로드된 오디오를 재생한다.
   * ended 이벤트에서 performance.now() 기준 종료 timestamp를 resolve한다.
   */
  play(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (this.audio === null || !this._isLoaded) {
        reject(new Error('오디오가 로드되지 않았습니다. play() 전에 load()를 호출해야 합니다.'));
        return;
      }

      const audio = this.audio;

      // 처음부터 재생
      audio.currentTime = 0;
      this._isPlaying = true;

      const onEnded = () => {
        cleanup();
        this._isPlaying = false;
        resolve(performance.now());
      };

      const onError = () => {
        cleanup();
        this._isPlaying = false;
        reject(new Error('오디오 재생 중 오류가 발생했습니다.'));
      };

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      audio.play().catch((err: unknown) => {
        cleanup();
        this._isPlaying = false;
        reject(err);
      });
    });
  }

  /** 재생을 즉시 중단하고 위치를 초기화한다 */
  stop(): void {
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this._isPlaying = false;
  }

  /** HTMLAudioElement 이벤트 리스너를 정리한다 */
  private cleanupAudio(): void {
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this._isPlaying = false;
    this._isLoaded = false;
  }
}
