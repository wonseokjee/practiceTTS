/**
 * LOC 검사 완료 유스케이스
 *
 * 책임:
 * 1. 수집된 시도 결과로 LocAssessmentResult 엔티티를 생성한다.
 * 2. ILocResultRepository를 통해 결과를 저장한다.
 * 3. LocAssessmentResultDTO를 반환한다.
 *
 * STORAGE_FAILED는 비중단 에러: console.error 후 결과 DTO는 반환한다.
 */

import { createLocAssessmentResult } from '../domain/LocAssessmentResult.js';
import type { LocTrial } from '../domain/LocTrial.js';
import type { ILocResultRepository } from '../domain/ILocResultRepository.js';
import {
  LocAssessmentError,
  LocAssessmentErrorCode,
} from './LocAssessmentError.js';
import type {
  LocAssessmentResultDTO,
  LocTrialResponseDTO,
} from './dto/LocTrialDTO.js';
import { getLocScoreLabel } from '../domain/LocScorer.js';

export class FinishLocAssessmentUseCase {
  private readonly resultRepository: ILocResultRepository;

  constructor(resultRepository: ILocResultRepository) {
    this.resultRepository = resultRepository;
  }

  /**
   * 검사를 완료하고 결과를 저장한다.
   *
   * @param params.id - 결과 ID (UUID)
   * @param params.sessionId - 세션 ID
   * @param params.patientId - 환자 ID
   * @param params.trials - 완료된 시도 목록
   * @param params.startTime - 검사 시작 시각 (performance.now() 기준)
   * @returns LocAssessmentResultDTO
   */
  async execute(params: {
    id: string;
    sessionId: string;
    patientId: string;
    trials: LocTrial[];
    startTime: number;
  }): Promise<LocAssessmentResultDTO> {
    const { id, sessionId, patientId, trials, startTime } = params;

    // 도메인 엔티티 생성
    const result = createLocAssessmentResult({
      id,
      sessionId,
      patientId,
      trials,
      startTime,
    });

    // Repository 저장 (STORAGE_FAILED는 비중단 에러)
    try {
      await this.resultRepository.save(result);
    } catch (err) {
      console.error(
        new LocAssessmentError(
          LocAssessmentErrorCode.STORAGE_FAILED,
          '검사 결과 저장에 실패했습니다. 계속 진행합니다.',
          err,
        ),
      );
    }

    // DTO 변환 (도메인 엔티티 직접 노출 금지)
    const trialDTOs: LocTrialResponseDTO[] = result.trials.map(
      (trial, index) => ({
        trialNumber: trial.trialNumber,
        latencyMs: trial.latency,
        touchInBounds: trial.touchInBounds,
        score: trial.score,
        scoreLabel: getLocScoreLabel(trial.score, trial),
        isComplete: index === result.trials.length - 1,
      }),
    );

    const resultDTO: LocAssessmentResultDTO = {
      id: result.id,
      finalScore: result.finalScore,
      trials: trialDTOs,
      totalDurationMs: result.totalDurationMs,
    };

    return resultDTO;
  }
}
