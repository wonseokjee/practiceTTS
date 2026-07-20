/**
 * LOC 단일 시도(Trial) 수행 유스케이스
 *
 * 책임:
 * 1. TTS를 통해 지시문을 재생한다.
 * 2. 터치 좌표가 버튼 영역 내에 있는지 검증한다.
 * 3. LocTrial 값 객체를 생성한다.
 * 4. LocTrialResponseDTO를 반환한다.
 *
 * 비즈니스 로직(채점)은 도메인 서비스(LocScorer)에 위임한다.
 */

import { createLocTrial } from '../domain/LocTrial.js';
import type { LocTrial } from '../domain/LocTrial.js';
import type { ITtsService } from '../../../shared/domain/ITtsService.js';
import {
  LocAssessmentError,
  LocAssessmentErrorCode,
} from './LocAssessmentError.js';
import type { LocTrialRequestDTO, LocTrialResponseDTO } from './dto/LocTrialDTO.js';
import { getLocScoreLabel } from '../domain/LocScorer.js';

/** LOC 검사 지시문 — 모든 시도에 동일한 지시문 사용 (순수 반응시간 측정) */
const LOC_INSTRUCTION = '화면을 눌러주세요.';

/** 터치 좌표가 버튼 경계 영역 내에 있는지 확인한다 */
function isInsideBounds(
  touchX: number,
  touchY: number,
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    touchX >= bounds.x &&
    touchX <= bounds.x + bounds.width &&
    touchY >= bounds.y &&
    touchY <= bounds.y + bounds.height
  );
}

export class ConductLocTrialUseCase {
  private readonly ttsService: ITtsService;

  constructor(ttsService: ITtsService) {
    this.ttsService = ttsService;
  }

  /**
   * 시도 지시문을 TTS로 재생하고 결과를 반환한다.
   *
   * @param dto - 시도 요청 데이터 (터치 좌표, 시간 정보 포함)
   * @param accumulatedTrials - 이전까지 완료된 시도 목록 (isComplete 판단용)
   * @returns LocTrialResponseDTO
   */
  async execute(
    dto: LocTrialRequestDTO,
    accumulatedTrials: readonly LocTrial[],
  ): Promise<{ trial: LocTrial; responseDTO: LocTrialResponseDTO }> {
    const { trialNumber, audioEndTime, touchTime, touchX, touchY, buttonBounds } = dto;

    // 입력 검증
    if (trialNumber < 1 || trialNumber > 3) {
      throw new LocAssessmentError(
        LocAssessmentErrorCode.INVALID_TRIAL_NUMBER,
        `유효하지 않은 시도 번호: ${trialNumber}. 1~3 사이여야 합니다.`,
      );
    }

    // 터치 영역 검증
    const touchInBounds =
      touchTime !== null
        ? isInsideBounds(touchX, touchY, buttonBounds)
        : false;

    // 도메인 값 객체 생성
    let trial: LocTrial;
    try {
      trial = createLocTrial({
        trialNumber,
        audioEndTime,
        touchTime,
        touchInBounds,
      });
    } catch (err) {
      throw new LocAssessmentError(
        LocAssessmentErrorCode.INVALID_TRIAL_NUMBER,
        err instanceof Error ? err.message : '시도 데이터가 유효하지 않습니다.',
        err,
      );
    }

    // isComplete: 3회 완료 또는 최고점 달성 시 조기 종료
    const totalTrialCount = accumulatedTrials.length + 1;
    const hasMaxScore = trial.score === 3;
    const isComplete = totalTrialCount >= 3 || hasMaxScore;

    const responseDTO: LocTrialResponseDTO = {
      trialNumber: trial.trialNumber,
      latencyMs: trial.latency,
      touchInBounds: trial.touchInBounds,
      score: trial.score,
      scoreLabel: getLocScoreLabel(trial.score, trial),
      isComplete,
    };

    return { trial, responseDTO };
  }

  /**
   * 지정된 시도 번호에 해당하는 TTS 지시문을 재생한다.
   * 재생 완료 후 audioEndTime을 반환한다.
   */
  async playInstruction(_trialNumber: 1 | 2 | 3): Promise<number> {
    const text = LOC_INSTRUCTION;

    try {
      const playbackResult = await this.ttsService.speak(text);
      // audioEndTime: utterance.onend에서 기록된 performance.now() 값
      return playbackResult.endTime;
    } catch (err) {
      throw new LocAssessmentError(
        LocAssessmentErrorCode.TTS_PLAYBACK_FAILED,
        '음성 안내 재생에 실패했습니다.',
        err,
      );
    }
  }

  /**
   * 재생 중인 지시문을 즉시 중단한다.
   *
   * 탭 전환처럼 환자가 화면을 떠난 순간에 쓴다. 안내를 듣지 못한 채 흘러가면
   * 반응 시간이 무의미해지므로, 소리를 끊고 시도를 중단시킨다.
   */
  cancelInstruction(): void {
    this.ttsService.cancel();
  }
}
