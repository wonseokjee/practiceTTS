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
import type { IAssessmentResultSubmitter } from '../../shared/infrastructure/AssessmentResultSubmitter.js';
import {
  createAssessmentSessionToken,
  toQabResults,
} from '../../shared/infrastructure/AssessmentResultSubmitter.js';

export class FinishLocAssessmentUseCase {
  private readonly resultRepository: ILocResultRepository;
  private readonly resultSubmitter: IAssessmentResultSubmitter | null;

  /**
   * @param resultSubmitter 서버 저장. 없으면 로컬에만 남긴다(기존 동작).
   *   로컬 저장은 기기·브라우저에 묶여 있어 캐시를 지우면 사라지고 보호자도
   *   볼 수 없다. 임상 기록이므로 서버에 남기는 쪽이 기본이다.
   */
  constructor(
    resultRepository: ILocResultRepository,
    resultSubmitter: IAssessmentResultSubmitter | null = null,
  ) {
    this.resultRepository = resultRepository;
    this.resultSubmitter = resultSubmitter;
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

    // 서버 저장 — 보호자의 회복 추이에 반영된다.
    //
    // 시도마다 한 행씩 남긴다. isCorrect는 '반응이 있었는가'로,
    // score는 그 시도의 0~3점으로 매핑한다(집계상 반응률·평균점수가 된다).
    // 실패해도 던지지 않는다 — 검사는 이미 끝났고, 여기서 오류를 올리면
    // 환자가 마친 뒤 오류 화면을 본다.
    if (this.resultSubmitter !== null) {
      await this.resultSubmitter.submit({
        sessionToken: createAssessmentSessionToken(),
        results: toQabResults(
          'loc',
          result.trials.map((trial) => ({
            itemRef: `trial-${trial.trialNumber}`,
            isCorrect: trial.latency !== null,
            score: trial.score,
          })),
        ),
      });
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
