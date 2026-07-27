import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OnboardingGuard } from './onboarding.guard';
import type { User } from './entities/user.entity';

function ctxWith(user: Partial<User> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('OnboardingGuard', () => {
  const guard = new OnboardingGuard();

  it('온보딩 전 보호자(patient_id=null)는 403으로 막는다', () => {
    expect(() =>
      guard.canActivate(ctxWith({ role: 'caregiver', patientId: null })),
    ).toThrow(ForbiddenException);
  });

  it('온보딩 완료 보호자(patient_id 있음)는 통과', () => {
    expect(
      guard.canActivate(ctxWith({ role: 'caregiver', patientId: 'p1' })),
    ).toBe(true);
  });

  it('환자 역할은 통과(하위호환 직접 로그인)', () => {
    expect(guard.canActivate(ctxWith({ role: 'patient', patientId: null }))).toBe(
      true,
    );
  });

  it('user가 없으면(인증 단계 문제) 판단하지 않고 통과', () => {
    expect(guard.canActivate(ctxWith(undefined))).toBe(true);
  });
});
