/**
 * 퀴즈 셋 생성 상태
 * - pending: 생성 요청만 등록되고 아직 결과 없음 (Phase 3 FastAPI 호출 직후)
 * - ready: LLM 응답 수신 및 QuizQuestion 영속화 완료
 * - failed: 생성 실패 — generation_error에 사유 저장
 *
 * DB CHECK 제약은 적용하지 않는다 (애플리케이션 레벨 검증만 — 운영 유연성 확보).
 */
export const QUIZ_GENERATION_STATUSES = ['pending', 'ready', 'failed'] as const;

export type QuizGenerationStatus = (typeof QUIZ_GENERATION_STATUSES)[number];
