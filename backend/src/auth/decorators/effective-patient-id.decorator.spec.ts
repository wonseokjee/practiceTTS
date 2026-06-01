import type { ExecutionContext } from '@nestjs/common';
import type { User } from '../entities/user.entity';
import { effectivePatientIdFactory } from './effective-patient-id.decorator';

/** req.user를 주입하는 가짜 ExecutionContext */
function ctxWithUser(user: Partial<User>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('effectivePatientIdFactory (training 컨트롤러 주입 경로)', () => {
  it('[회귀] legacy patient 토큰 → 본인 id 반환', () => {
    const ctx = ctxWithUser({ id: 'p1', role: 'patient', patientId: null });
    expect(effectivePatientIdFactory(undefined, ctx)).toBe('p1');
  });

  it('caregiver 토큰 → 연결된 환자 id 반환', () => {
    const ctx = ctxWithUser({
      id: 'cg1',
      role: 'caregiver',
      patientId: 'p-linked',
    });
    expect(effectivePatientIdFactory(undefined, ctx)).toBe('p-linked');
  });
});
