import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { resolveEffectivePatientId } from './effective-patient-id.util';

describe('resolveEffectivePatientId', () => {
  it('role=patient → 본인 id 반환 (하위호환)', () => {
    const result = resolveEffectivePatientId({
      id: 'patient-1',
      role: 'patient',
      patientId: null,
    });
    expect(result).toBe('patient-1');
  });

  it('role=caregiver + patientId → 연결된 환자 id 반환', () => {
    const result = resolveEffectivePatientId({
      id: 'caregiver-1',
      role: 'caregiver',
      patientId: 'patient-x',
    });
    expect(result).toBe('patient-x');
  });

  it('role=caregiver + patientId 없음 → BadRequestException(400)', () => {
    expect(() =>
      resolveEffectivePatientId({
        id: 'caregiver-1',
        role: 'caregiver',
        patientId: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('role=therapist → ForbiddenException(403)', () => {
    expect(() =>
      resolveEffectivePatientId({
        id: 'therapist-1',
        role: 'therapist',
        patientId: null,
      }),
    ).toThrow(ForbiddenException);
  });
});
