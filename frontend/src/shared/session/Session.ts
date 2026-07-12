/**
 * 검사 세션 값 객체
 *
 * sessionId: 검사 세션 식별자 (새 검사 시작 시 생성)
 * patientId: 환자 식별자 (저장·조회 키)
 * patientName: 화면 표시용 환자 이름 (없으면 patientId로 폴백)
 */

export interface Session {
  readonly sessionId: string;
  readonly patientId: string;
  readonly patientName?: string;
}

/** crypto.randomUUID()를 활용한 세션 ID 생성 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
