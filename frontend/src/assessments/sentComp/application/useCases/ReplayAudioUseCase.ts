/**
 * 문장 이해 (SentComp) 검사 - 오디오 재청취 유스케이스
 *
 * 책임:
 * 1. IAudioPlayer.play()를 호출하여 오디오를 재생한다.
 * 2. 재생 완료 시 audioEndTimestamp(performance.now() 기준)를 반환한다.
 * 3. 재생 실패 시 AUDIO_LOAD_FAILED 에러로 래핑하여 전파한다.
 *
 * 주의: 이 유스케이스는 load()를 담당하지 않는다.
 * 오디오 로딩은 ViewModel(useSentCompViewModel)에서 LOADING 단계에서 수행한다.
 */

import type { IAudioPlayer } from '../../../../shared/domain/IAudioPlayer.js';
import { SentCompError, SentCompErrorCode } from '../errors.js';

export class ReplayAudioUseCase {
  private readonly audioPlayer: IAudioPlayer;

  constructor(audioPlayer: IAudioPlayer) {
    this.audioPlayer = audioPlayer;
  }

  /**
   * 오디오를 재생하고 종료 timestamp를 반환한다.
   *
   * @returns 재생 완료 시각 (performance.now() 기준, ms)
   * @throws SentCompError(AUDIO_LOAD_FAILED) 재생 실패 시
   */
  async execute(): Promise<number> {
    try {
      const endTimestamp = await this.audioPlayer.play();
      return endTimestamp;
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.AUDIO_LOAD_FAILED,
        '오디오 재생에 실패했습니다. 파일을 확인해주세요.',
        err,
      );
    }
  }
}
