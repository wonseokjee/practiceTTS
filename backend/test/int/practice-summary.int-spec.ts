import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { PracticeResult } from '../../src/practice/entities/practice-result.entity';
import { PracticeService } from '../../src/practice/practice.service';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

/**
 * 보호자용 연습 요약 — 집계 SQL(FILTER·DISTINCT 튜플)은 mock으로 증명할 수 없다.
 *
 * 지키는 규칙: 정답률은 첫 시도만, 판정 없는 발화는 분모에서 뺀다,
 * 창 밖·다른 환자 행은 섞이지 않는다.
 */
describe('PracticeService.getSummary (DB)', () => {
  let ds: DataSource;
  let service: PracticeService;

  const patient = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, timezone) VALUES ($1, 'patient', 'p', 'Asia/Seoul')`,
      [id],
    );
    return id;
  };

  const row = async (
    patientId: string,
    session: string,
    kind: string,
    ref: string,
    attempt: number,
    isCorrect: boolean | null,
    createdAt = 'now()',
  ): Promise<void> => {
    await ds.query(
      `INSERT INTO practice_results
         (patient_id, session_token, item_kind, item_ref, attempt, is_correct, tier, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${createdAt})`,
      [
        patientId,
        session,
        kind,
        ref,
        attempt,
        isCorrect,
        isCorrect === null ? 1 : 0,
      ],
    );
  };

  beforeAll(async () => {
    assertTestDatabaseName(TEST_DATABASE);
    // 레포지토리를 쓰므로 엔티티 메타데이터가 필요하다(locale-settings와 같은 방식).
    ds = await new DataSource({
      ...connectionOptions(TEST_DATABASE),
      entities: [User, PracticeResult],
    }).initialize();
    service = new PracticeService(
      ds.getRepository(PracticeResult),
      ds.getRepository(User),
    );
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('첫 시도만 정답률에 넣고, 재시도해서 맞힌 것은 오답으로 남는다', async () => {
    const p = await patient();
    const s = randomUUID();
    await row(p, s, 'imageChoice', 'img_1', 1, true);
    await row(p, s, 'imageChoice', 'img_2', 1, false);
    await row(p, s, 'imageChoice', 'img_2', 2, true); // 정답 안내 뒤 재시도
    await row(p, s, 'oddOneOut', 'ooo_1', 1, false);

    const sum = await service.getSummary(p, 7);

    expect(sum.items).toBe(3); // img_1 · img_2 · ooo_1 — 재시도는 같은 문항
    expect(sum.firstTry).toEqual({ judged: 3, correct: 1, rate: 1 / 3 });
    expect(sum.byKind).toEqual([
      { kind: 'imageChoice', items: 2, judged: 2, correct: 1 },
      { kind: 'oddOneOut', items: 1, judged: 1, correct: 0 },
    ]);
    expect(sum.sessions).toBe(1);
    expect(sum.lastPracticedAt).not.toBeNull();
  });

  it('판정 없는 발화는 문항 수에는 들어가고 정답률 분모에서는 빠진다', async () => {
    const p = await patient();
    const s = randomUUID();
    await row(p, s, 'repeat', 'rep_1', 1, null);
    await row(p, s, 'repeat', 'rep_2', 1, null);

    const sum = await service.getSummary(p, 7);

    expect(sum.items).toBe(2);
    expect(sum.firstTry).toEqual({ judged: 0, correct: 0, rate: null });
  });

  it('창 밖의 행과 다른 환자의 행은 세지 않는다', async () => {
    const p = await patient();
    const other = await patient();
    await row(
      p,
      randomUUID(),
      'spell',
      'sp_old',
      1,
      true,
      `now() - interval '30 days'`,
    );
    await row(other, randomUUID(), 'spell', 'sp_x', 1, true);
    await row(p, randomUUID(), 'spell', 'sp_new', 1, true);

    const sum = await service.getSummary(p, 7);

    expect(sum.items).toBe(1);
    expect(sum.sessions).toBe(1);
  });

  it('연습 기록이 없으면 0과 null — 0%를 지어내지 않는다', async () => {
    const p = await patient();
    const sum = await service.getSummary(p, 7);
    expect(sum).toEqual({
      days: 7,
      sessions: 0,
      items: 0,
      firstTry: { judged: 0, correct: 0, rate: null },
      byKind: [],
      lastPracticedAt: null,
    });
  });
});
