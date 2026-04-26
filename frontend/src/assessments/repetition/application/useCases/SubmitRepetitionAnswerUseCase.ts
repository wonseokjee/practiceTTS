import type { IRepetitionResultRepository, RepetitionResult } from '../../domain/RepetitionTypes';
import { calculateWER, scoreRepetitionResult } from '../../domain/werCalculator';
import { RepetitionError, RepetitionErrorCode } from '../errors';

interface SubmitRequest {
  itemId: string;
  stimulusText: string;
  sttOutput: string;
  reactionTimeMs: number;
  recordDurationMs: number;
}

/**
 * 따라말하기 결과를 채점하고 지속 저장소에 기록하는 유스케이스입니다.
 */
export class SubmitRepetitionAnswerUseCase {
  constructor(
    private readonly resultRepository: IRepetitionResultRepository,
    private readonly sessionId: string
  ) {}

  async execute(request: SubmitRequest): Promise<RepetitionResult> {
    try {
      const finalStt = request.sttOutput.trim();
      
      // 도메인 서비스를 통한 WER 계산
      const wer = calculateWER(request.stimulusText, finalStt);
      const score = scoreRepetitionResult(wer);
      
      const result: RepetitionResult = {
        itemId: request.itemId,
        stimulusText: request.stimulusText,
        sttOutput: finalStt, // 빈 문자열인 경우 오답/무반응(0점) 처리됨 (wer=1)
        wer,
        isCorrect: score > 0,
        score,
        reactionTimeMs: request.reactionTimeMs,
        recordDurationMs: request.recordDurationMs
      };
      
      // 저장소로 결과 전송
      await this.resultRepository.saveResult(this.sessionId, result);
      
      return result;
    } catch (error) {
      if (error instanceof RepetitionError) throw error;
      throw new RepetitionError(
        RepetitionErrorCode.SAVE_FAILED,
        '채점 결과를 저장하는 과정에서 오류가 발생했습니다.'
      );
    }
  }
}
