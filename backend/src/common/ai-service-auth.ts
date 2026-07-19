import { ConfigService } from '@nestjs/config';

/** ai-service가 검사하는 서비스 간 인증 헤더 이름. */
export const AI_SERVICE_TOKEN_HEADER = 'X-Service-Token';

/**
 * ai-service 호출에 붙일 인증 헤더를 만든다.
 *
 * ai-service는 Gemini와 Azure를 호출하므로, 인증이 없으면 포트에 닿는 누구나
 * 남의 API 할당량을 태우고 /mask에 임의 텍스트를 넣어 외부 LLM으로 흘려보낼 수
 * 있다. 백엔드만 부르는 엔드포인트는 공유 토큰으로 막혀 있다.
 *
 * 토큰 값은 로그에 남기지 않는다 — 호출자는 헤더 객체만 받아 그대로 쓴다.
 */
export function aiServiceHeaders(
  configService: ConfigService,
): Record<string, string> {
  const token = configService.get<string>('AI_SERVICE_TOKEN', '');
  return token ? { [AI_SERVICE_TOKEN_HEADER]: token } : {};
}
