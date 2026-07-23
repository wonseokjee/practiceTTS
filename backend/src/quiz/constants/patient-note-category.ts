/**
 * 환자 답변(PatientMemoryNote)의 카테고리
 * - activity: 환자분과 함께한 활동
 * - moment: 인상 깊은 순간
 * - context: 사람·장소·음식 등 맥락
 *
 * Memory 모듈과 Quiz 모듈 모두에서 공유한다.
 */
export const PATIENT_NOTE_CATEGORIES = [
  'activity',
  'moment',
  'context',
] as const;

export type PatientNoteCategory = (typeof PATIENT_NOTE_CATEGORIES)[number];
