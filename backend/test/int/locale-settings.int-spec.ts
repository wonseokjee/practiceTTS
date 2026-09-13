import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { LocaleSettingsService } from '../../src/settings/locale-settings.service';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

/**
 * 로케일 쓰기 경로(계획서 0-5c)를 실제 `users` 행에 대고 — mock은 `In()`·
 * 트랜잭션·컬럼 이름이 맞는지까지는 증명하지 못한다.
 */
describe('LocaleSettingsService (DB)', () => {
  let ds: DataSource;
  let service: LocaleSettingsService;

  const insertUser = async (
    role: string,
    patientId: string | null = null,
  ): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, patient_id) VALUES ($1, $2, 'u', $3)`,
      [id, role, patientId],
    );
    return id;
  };
  const localeOf = async (id: string): Promise<string> => {
    const rows: { locale: string }[] = await ds.query(
      'SELECT locale FROM users WHERE id = $1',
      [id],
    );
    return rows[0].locale;
  };

  beforeAll(async () => {
    assertTestDatabaseName(TEST_DATABASE);
    // 이 테스트만 User 엔티티 메타데이터가 필요하다(레포지토리를 쓰므로).
    ds = await new DataSource({
      ...connectionOptions(TEST_DATABASE),
      entities: [User],
    }).initialize();
    service = new LocaleSettingsService(ds.getRepository(User));
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('보호자가 쓰면 환자 행과 보호자 행에 각각 들어가고, read가 같은 값을 돌려준다', async () => {
    const patientId = await insertUser('patient');
    const caregiverId = await insertUser('caregiver', patientId);
    const actor = { id: caregiverId, role: 'caregiver', patientId } as User;

    const res = await service.update(actor, {
      patientLocale: 'ko-KR',
      caregiverLocale: 'ko-KR',
    });

    expect(res).toEqual({ patientLocale: 'ko-KR', caregiverLocale: 'ko-KR' });
    expect(await localeOf(patientId)).toBe('ko-KR');
    expect(await localeOf(caregiverId)).toBe('ko-KR');
  });

  it('미지원 로케일은 거부되고 저장된 값이 그대로다 — 문이 닫혀 있다', async () => {
    const patientId = await insertUser('patient');
    const caregiverId = await insertUser('caregiver', patientId);
    const actor = { id: caregiverId, role: 'caregiver', patientId } as User;

    await expect(
      service.update(actor, {
        patientLocale: 'ko-KR',
        caregiverLocale: 'en-US',
      }),
    ).rejects.toThrow('지원하지 않는');

    expect(await localeOf(patientId)).toBe('ko-KR');
    expect(await localeOf(caregiverId)).toBe('ko-KR');
  });
});
