/**
 * 페르소나 컨텍스트 서비스 인터페이스.
 *
 * 핵심 책임: 외부 LLM에는 실명을 노출하지 않으면서(관계/장소 토큰만 전달),
 * 환자에게 보여줄 때는 실명으로 복원(역치환)할 수 있게 한다.
 *
 * 매핑은 프로필을 source of truth로 결정적으로 생성되므로,
 * 치환 시점(create)과 역치환 시점(training 표시)에 독립적으로 재생성해도 일치한다.
 */
export interface PersonaContextResult {
  /** LLM 전달용 — 실명이 토큰으로 치환된 컨텍스트 */
  tokenizedContext: string;
  /** token -> realName 매핑. 호출자만 보유하며 외부 전송/영속 금지. */
  tokenMap: Record<string, string>;
}

export interface IPersonaContextService {
  /**
   * baseContext 내 실명·지명을 토큰으로 치환하고 프로필 배경을 부가한다.
   * - 프로필 미등록 시 baseContext를 그대로 반환(개인화 생략, 무중단).
   */
  buildPersonaContext(
    patientId: string,
    baseContext: string,
  ): Promise<PersonaContextResult>;

  /**
   * 프로필로부터 token -> realName 매핑만 결정적으로 재생성한다 (역치환용).
   * - 프로필 미등록 시 빈 객체 반환.
   */
  buildTokenMap(patientId: string): Promise<Record<string, string>>;

  /**
   * LLM 산출물의 토큰을 실명으로 역치환한다.
   * - 매핑에 없는 토큰은 관계/장소 라벨로 폴백하여 토큰이 환자에게 노출되지 않게 한다.
   */
  restorePersonaText(
    tokenizedText: string,
    tokenMap: Record<string, string>,
  ): string;
}
