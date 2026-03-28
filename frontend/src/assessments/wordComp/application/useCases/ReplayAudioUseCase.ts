/**
 * 단어 이해 (WordComp) 검사 - 오디오 재청취 유스케이스
 *
 * 책임:
 * 1. IAudioPlayer로 지정된 URL의 오디오를 재생한다.
 * 2. 재생 완료 시 audioEndTimestamp(performance.now() 기준)를 반환한다.
 * 3. 재생 실패 시 AUDIO_PLAY_FAILED 에러로 래핑하여 전파한다.
 */

import type { IAudioPlayer } from '../../../../shared/domain/IAudioPlayer.js';
import {
  WordComprehensionAppError,
  WcAppErrorCode,
} from '../errors/WordComprehensionAppError.js';

export class ReplayAudioUseCase {
  constructor(private readonly audioPlayer: IAudioPlayer) {}

  async execute(audioUrl: string): Promise<number> {
    try {
      await this.audioPlayer.load(audioUrl);
      return await this.audioPlayer.play();
    } catch {
      throw new WordComprehensionAppError(
        WcAppErrorCode.AUDIO_PLAY_FAILED,
        '오디오 재생에 실패했습니다. 파일을 확인해주세요.',
      );
    }
  }
}
