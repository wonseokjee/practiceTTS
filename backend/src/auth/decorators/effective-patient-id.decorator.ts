import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../entities/user.entity';
import { resolveEffectivePatientId } from '../effective-patient-id.util';

/**
 * 핸들러 파라미터로 "유효 환자 ID"를 주입한다.
 *
 * JwtAuthGuard 이후에만 사용 가능(req.user 필요). role에 따른 도출 규칙은
 * resolveEffectivePatientId(순수 함수)에 위임한다.
 *
 *   @Get('entries')
 *   getEntries(@EffectivePatientId() patientId: string) { ... }
 */
/** 데코레이터 팩토리 (단위 테스트용으로 분리) */
export function effectivePatientIdFactory(
  _data: unknown,
  ctx: ExecutionContext,
): string {
  const req = ctx.switchToHttp().getRequest<{ user: User }>();
  return resolveEffectivePatientId(req.user);
}

export const EffectivePatientId = createParamDecorator(
  effectivePatientIdFactory,
);
