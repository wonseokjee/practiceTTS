import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { User } from '../auth/entities/user.entity';
import { LocaleSettingsService } from './locale-settings.service';

const CAREGIVER = {
  id: 'caregiver-1',
  role: 'caregiver',
  patientId: 'patient-1',
} as User;
const PATIENT = { id: 'patient-9', role: 'patient', patientId: null } as User;
const THERAPIST = { id: 't-1', role: 'therapist', patientId: null } as User;

function build(stored: Record<string, string> = {}) {
  const txUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  // `In(ids)`는 FindOperator다 — 공개 getter `value`로 ids를 읽는다.
  const find = jest.fn(({ where }: { where: { id: { value: string[] } } }) =>
    Promise.resolve(
      where.id.value
        .filter((id) => stored[id] !== undefined)
        .map((id) => ({ id, locale: stored[id] })),
    ),
  );
  const transaction = jest.fn(
    (fn: (m: { getRepository: () => { update: jest.Mock } }) => unknown) =>
      fn({ getRepository: () => ({ update: txUpdate }) }),
  );
  const repo = {
    find,
    manager: { transaction },
  } as unknown as Repository<User>;
  return { service: new LocaleSettingsService(repo), txUpdate, transaction };
}

describe('LocaleSettingsService', () => {
  it('지원 목록은 서버가 내려준다 — 지금은 ko-KR만', () => {
    expect(build().service.getSupported()).toEqual({
      patient: ['ko-KR'],
      caregiver: ['ko-KR'],
    });
  });

  describe('update — 게이트(0-5c)', () => {
    it('미지원 로케일은 400이고 아무것도 쓰지 않는다', async () => {
      const { service, transaction } = build();

      await expect(
        service.update(CAREGIVER, { patientLocale: 'en-US' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('둘 중 하나만 미지원이어도 둘 다 안 쓴다 — 반쯤 바뀐 상태를 만들지 않는다', async () => {
      const { service, transaction } = build();

      await expect(
        service.update(CAREGIVER, {
          patientLocale: 'ko-KR',
          caregiverLocale: 'en-US',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('바꿀 값이 없으면 400', async () => {
      await expect(
        build().service.update(CAREGIVER, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update — 누구의 행을 쓰나', () => {
    it('보호자: 환자 로케일은 연결된 환자 행에, 보호자 로케일은 본인 행에 — 한 트랜잭션', async () => {
      const { service, txUpdate, transaction } = build({
        'patient-1': 'ko-KR',
        'caregiver-1': 'ko-KR',
      });

      const res = await service.update(CAREGIVER, {
        patientLocale: 'ko-KR',
        caregiverLocale: 'ko-KR',
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledWith(
        { id: 'patient-1' },
        { locale: 'ko-KR' },
      );
      expect(txUpdate).toHaveBeenCalledWith(
        { id: 'caregiver-1' },
        { locale: 'ko-KR' },
      );
      expect(res).toEqual({ patientLocale: 'ko-KR', caregiverLocale: 'ko-KR' });
    });

    it('환자 직접 로그인: 환자 로케일은 본인 행, 보호자 로케일은 403', async () => {
      const { service, txUpdate } = build({ 'patient-9': 'ko-KR' });

      const res = await service.update(PATIENT, { patientLocale: 'ko-KR' });
      expect(txUpdate).toHaveBeenCalledWith(
        { id: 'patient-9' },
        { locale: 'ko-KR' },
      );
      expect(res).toEqual({ patientLocale: 'ko-KR', caregiverLocale: null });

      await expect(
        service.update(PATIENT, { caregiverLocale: 'ko-KR' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('치료사 등 다른 역할은 403 — 환자 데이터에 쓸 수 없다', async () => {
      await expect(
        build().service.update(THERAPIST, { patientLocale: 'ko-KR' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('read: 행이 없으면 기본 로케일로 읽는다', async () => {
    const res = await build().service.read(CAREGIVER);
    expect(res).toEqual({ patientLocale: 'ko-KR', caregiverLocale: 'ko-KR' });
  });
});
