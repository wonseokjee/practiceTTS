/**
 * 문장 이해 (SentComp) 검사 - 애플리케이션 계층 DTO
 *
 * UseCase 입력/출력 타입을 정의한다.
 * Domain Entity를 Presentation 레이어에 직접 노출하지 않기 위해 DTO로 변환한다.
 */

/** 답변 제출 요청 DTO */
export interface SubmitAnswerRequestDTO {
  readonly itemId: string;
  /** 선택한 이미지 인덱스 (0 또는 1) */
  readonly selectedImageIndex: 0 | 1;
  /** 오디오 재생 완료 시각 (performance.now() 기준, ms) */
  readonly audioEndTimestamp: number;
  /** 이미지 선택 시각 (performance.now() 기준, ms) */
  readonly selectionTimestamp: number;
  /** 재청취 횟수 */
  readonly replayCount: number;
}

/** 답변 제출 응답 DTO */
export interface SubmitAnswerResponseDTO {
  readonly isCorrect: boolean;
  readonly reactionTimeMs: number;
  /** 현재 제출이 마지막 문항인지 여부 */
  readonly isLastItem: boolean;
}

/** 채점 결과 DTO */
export interface ScoreDTO {
  readonly totalScore: number;
  readonly correctCount: number;
  readonly totalItems: number;
  readonly byType: Record<
    string,
    { total: number; correct: number; rate: number | null }
  >;
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}
