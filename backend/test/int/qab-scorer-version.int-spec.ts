import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { QabResult } from '../../src/quiz/entities/qab-result.entity';
import { QuizService } from '../../src/quiz/quiz.service';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

/**
 * 채점기 버전·채점 불가 이유(M33)를 실제 Postgres에서.
 *
 * 요약 SQL의 `ARRAY_AGG(DISTINCT COALESCE(...))`, `MIN(...) FILTER (...)`, 조건부 SUM은
 * mock으로는 문법도 결과도 증명되지 않는다. 그리고 이 값이 보호자 화면의 "채점 방식이
 * 바뀌었어요"를 정하므로, 틀리면 진전 그래프가 조용히 거짓말한다.
 */
describe('QAB 채점기 버전 (DB)', () => {
  let ds: DataSource;
  let summaryOf: (
    patientId: string,
  ) => ReturnType<QuizService['getQabSummary']>;

  const T = (day: number) =>
    new Date(`2026-09-${String(day).padStart(2, '0')}T03:00:00Z`);

  const patient = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name) VALUES ($1, 'patient', 'p')`,
      [id],
    );
    return id;
  };

  let seq = 0;
  const addRow = async (
    patientId: string,
    row: Partial<{
      subtest: string;
      isCorrect: boolean;
      unscored: boolean;
      unscoredReason: string | null;
      scorerVersion: string | null;
      ambiguousRetries: number | null;
      answeredAt: Date;
    }>,
  ): Promise<void> => {
    await ds.getRepository(QabResult).insert({
      patientId,
      sessionToken: randomUUID(),
      subtest: (row.subtest ?? 'naming') as QabResult['subtest'],
      itemRef: `item_${(seq += 1)}`,
      isCorrect: row.isCorrect ?? true,
      unscored: row.unscored ?? false,
      unscoredReason: (row.unscoredReason ??
        null) as QabResult['unscoredReason'],
      scorerVersion: (row.scorerVersion ?? null) as QabResult['scorerVersion'],
      ambiguousRetries: row.ambiguousRetries ?? null,
      answeredAt: row.answeredAt ?? T(1),
    });
  };

  beforeAll(async () => {
    assertTestDatabaseName(TEST_DATABASE);
    ds = await new DataSource({
      ...connectionOptions(TEST_DATABASE),
      entities: [User, QabResult],
    }).initialize();
    // getQabSummary는 qabResultRepository 하나만 쓴다. 나머지 열 개 남짓한 의존성을 다 만들 이유가
    // 없어 프로토타입에 그 하나만 붙인다 — 필드 이름이 바뀌면 getQabSummary가 여기서 깨진다.
    const svc = Object.create(QuizService.prototype) as QuizService;
    (svc as unknown as { qabResultRepository: unknown }).qabResultRepository =
      ds.getRepository(QabResult);
    summaryOf = (id) => svc.getQabSummary(id);
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('두 컬럼이 널 허용·기본값 없음으로 있다 — 소급해서 채우지 않는다', async () => {
    const cols: {
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
    }[] = await ds.query(
      `SELECT column_name, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns
        WHERE table_name = 'qab_results'
          AND column_name IN ('scorer_version', 'unscored_reason', 'ambiguous_retries')
        ORDER BY column_name`,
    );
    expect(cols).toEqual([
      {
        column_name: 'ambiguous_retries',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: null,
      },
      {
        column_name: 'scorer_version',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: 24,
      },
      {
        column_name: 'unscored_reason',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: 16,
      },
    ]);
  });

  it('컬럼 이전의 행(NULL)만 있으면 버전은 azure-pa-v1 하나이고 전환은 없다', async () => {
    const p = await patient();
    await addRow(p, { answeredAt: T(1) });
    await addRow(p, { answeredAt: T(2) });

    const [item] = (await summaryOf(p)).items;
    expect(item.scorerVersions).toEqual(['azure-pa-v1']);
    expect(item.scorerChangedAt).toBeNull();
    expect(item.unscoredAmbiguous).toBe(0);
  });

  it('새 채점기가 처음 쓰인 시각이 전환 시각이다 — 옛 채점기 행은 그 앞에 있다', async () => {
    const p = await patient();
    await addRow(p, { answeredAt: T(1) }); // NULL = v1
    await addRow(p, { scorerVersion: 'azure-pa-v1', answeredAt: T(2) });
    await addRow(p, { scorerVersion: 'azure-pa-nbr-v1', answeredAt: T(5) });
    await addRow(p, { scorerVersion: 'azure-pa-nbr-v1', answeredAt: T(4) }); // 더 이른 새 채점기 행

    const [item] = (await summaryOf(p)).items;
    expect(item.scorerVersions).toEqual(['azure-pa-nbr-v1', 'azure-pa-v1']);
    expect(item.scorerChangedAt).toBe(T(4).toISOString());
  });

  it('모호로 못 가른 문항만 unscoredAmbiguous로 세고, 정확도 분모에서는 다른 채점 불가와 같이 빠진다', async () => {
    const p = await patient();
    await addRow(p, { isCorrect: true, scorerVersion: 'azure-pa-nbr-v1' });
    await addRow(p, { isCorrect: false, scorerVersion: 'azure-pa-nbr-v1' });
    await addRow(p, {
      isCorrect: false,
      unscored: true,
      unscoredReason: 'ambiguous',
      scorerVersion: 'azure-pa-nbr-v1',
    });
    await addRow(p, {
      isCorrect: false,
      unscored: true,
      unscoredReason: 'ambiguous',
      scorerVersion: 'azure-pa-nbr-v1',
    });
    await addRow(p, {
      isCorrect: false,
      unscored: true,
      unscoredReason: 'no_score',
      scorerVersion: 'azure-pa-nbr-v1',
    });
    await addRow(p, { isCorrect: false, unscored: true }); // 이유를 모르는 옛 채점 불가
    // 채점됐는데 이유가 남은 행 — 서버가 저장 전에 지우지만, 집계가 DB 수준에서도 세면 안 된다
    await addRow(p, {
      isCorrect: true,
      unscored: false,
      unscoredReason: 'ambiguous',
      scorerVersion: 'azure-pa-nbr-v1',
    });

    const [item] = (await summaryOf(p)).items;
    expect(item.unscored).toBe(4);
    expect(item.unscoredAmbiguous).toBe(2); // unscored의 부분집합
    expect(item.total).toBe(3); // 채점 불가 4개는 분모 밖
    expect(item.correct).toBe(2);
    expect(item.accuracy).toBe(67);
  });

  it('검사별·환자별로 갈린다 — 다른 검사·다른 환자의 채점기가 새지 않는다', async () => {
    const p = await patient();
    const other = await patient();
    await addRow(p, {
      subtest: 'naming',
      scorerVersion: 'azure-pa-nbr-v1',
      answeredAt: T(3),
    });
    await addRow(p, { subtest: 'repeat', answeredAt: T(3) });
    await addRow(other, {
      subtest: 'naming',
      scorerVersion: 'azure-pa-nbr-v1',
      answeredAt: T(3),
    });

    const items = (await summaryOf(p)).items;
    const by = Object.fromEntries(items.map((i) => [i.subtest, i]));
    expect(by.naming.scorerVersions).toEqual(['azure-pa-nbr-v1']);
    expect(by.repeat.scorerVersions).toEqual(['azure-pa-v1']);
    expect(by.repeat.scorerChangedAt).toBeNull();
  });

  it('1차 모호율의 분자·분모 — NULL(이웃 비교를 안 거침)은 분모에 안 들어간다', async () => {
    const p = await patient();
    // 이웃 비교를 거치지 않은 행 둘(이전 채점기)
    await addRow(p, {});
    await addRow(p, { scorerVersion: 'azure-pa-v1' });
    // 거친 행: 안 시킴 3, 다시 시킴 2(그중 하나는 재시도 후에도 못 가려 채점 불가)
    for (let i = 0; i < 3; i += 1) {
      await addRow(p, {
        scorerVersion: 'azure-pa-nbr-v1',
        ambiguousRetries: 0,
      });
    }
    await addRow(p, { scorerVersion: 'azure-pa-nbr-v1', ambiguousRetries: 1 });
    await addRow(p, {
      isCorrect: false,
      unscored: true,
      unscoredReason: 'ambiguous',
      scorerVersion: 'azure-pa-nbr-v1',
      ambiguousRetries: 1,
    });

    const [item] = (await summaryOf(p)).items;
    expect(item.neighborAttempts).toBe(5); // NULL 둘은 빠진다 — 0으로 셌다면 7
    expect(item.neighborRetried).toBe(2);
    expect(item.unscoredAmbiguous).toBe(1); // 재시도 후에도 못 가른 것은 그중 하나
  });

  it('다른 검사·다른 환자의 재시도가 새지 않는다', async () => {
    const p = await patient();
    const other = await patient();
    await addRow(p, {
      subtest: 'naming',
      scorerVersion: 'azure-pa-nbr-v1',
      ambiguousRetries: 1,
    });
    await addRow(p, { subtest: 'repeat' });
    await addRow(other, {
      subtest: 'naming',
      scorerVersion: 'azure-pa-nbr-v1',
      ambiguousRetries: 1,
    });

    const by = Object.fromEntries(
      (await summaryOf(p)).items.map((i) => [i.subtest, i]),
    );
    expect(by.naming.neighborAttempts).toBe(1);
    expect(by.repeat.neighborAttempts).toBe(0);
    expect(by.repeat.neighborRetried).toBe(0);
  });
});
