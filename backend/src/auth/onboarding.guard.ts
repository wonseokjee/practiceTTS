import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { User } from './entities/user.entity';

/**
 * 온보딩 완료 게이트.
 *
 * 소셜 최초 로그인 보호자는 patient_id=null(needsOnboarding) 상태로 정상 JWT를
 * 받는다. 이 "반쯤 초기화된" 토큰으로 환자 스코프 엔드포인트를 직접 호출하면
 * (SPA 가드를 우회) 안 되므로, 백엔드에서도 막는다(defense-in-depth).
 *
 * 적용: 데이터 컨트롤러(quiz/training/memory/profile/ai-proxy)에 JwtAuthGuard
 * 다음에 건다 — `@UseGuards(JwtAuthGuard, OnboardingGuard)`. JwtAuthGuard가 먼저
 * req.user를 채운 뒤 이 가드가 판단한다. auth 컨트롤러(/auth/me,
 * /auth/complete-onboarding)에는 걸지 않아, 온보딩 완료 경로는 열려 있다.
 *
 * 참고: 환자 데이터 접근은 resolveEffectivePatientId도 patient_id 없으면 막지만,
 * 그건 그 함수를 거치는 엔드포인트에 한정되고 400을 낸다. 이 가드는 컨트롤러
 * 전체를 403으로 일관되게 막아 사각지대를 없앤다.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: User }>();
    const user = req.user;

    // user가 없으면 인증 단계 문제(JwtAuthGuard가 처리). 여기서 판단하지 않는다.
    if (user && user.role === 'caregiver' && user.patientId === null) {
      throw new ForbiddenException(
        '온보딩을 먼저 완료해주세요(어르신 정보 입력).',
      );
    }
    return true;
  }
}
