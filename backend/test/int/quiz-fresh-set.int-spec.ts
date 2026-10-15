import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { MemoryEntry } from '../../src/memory/entities/memory-entry.entity';
import { QuizQuestion } from '../../src/quiz/entities/quiz-question.entity';
import { QuizSet } from '../../src/quiz/entities/quiz-set.entity';
import { QuizService } from '../../src/quiz/quiz.service';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

/**
 * '오늘 연습'에 붙일 기억 세트 — 창(환자 타임존 어제 0시)·상태·안 푼 것·환자
 * 조건은 SQL에만 있어 mock으로 증명할 수 없다.
 *
 * 경계는 서울이 아닌 타임존으로 잰다. 서버 기본값(Asia/Seoul)이나 UTC로
 * 잘못 계산해도 서울 환자로는 통과해 버릴 수 있다.
 */
describe('QuizService.getFreshSetId (DB)', () => {
  const TZ = 'America/New_York';
  /** 환자 타임존 '오늘 0시'에서 offset만큼 옮긴 시각(SQL 식). */
  const local = (offset: string): string =>
    `((date_trunc('day', now() AT TIME ZONE '${TZ}') + interval '${offset}') AT TIME ZONE '${TZ}')`;

  let ds: DataSource;
  let fresh: (patientId: string) => Promise<string | null>;

  const user = async (role: 'patient' | 'caregiver'): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, timezone) VALUES ($1, $2, 'u', $3)`,
      [id, role, TZ],
    );
    return id;
  };

  const set = async (
    patientId: string,
    caregiverId: string,
    status: string,
    createdAt: string,
  ): Promise<string> => {
    const [{ id: entryId }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO memory_entries (caregiver_id, patient_id) VALUES ($1, $2) RETURNING id`,
      [caregiverId, patientId],
    );
    const [{ id: setId }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO quiz_sets (memory_entry_id, patient_id, caregiver_id, generation_status, created_at)
       VALUES ($1, $2, $3, $4, ${createdAt}) RETURNING id`,
      [entryId, patientId, caregiverId, status],
    );
    return setId;
  };

  const answer = async (setId: string, patientId: string): Promise<void> => {
    const [{ id: questionId }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO quiz_questions (quiz_set_id, order_index, type, prompt, correct_answer)
       VALUES ($1, 0, 'multiple_choice', 'q', 'a') RETURNING id`,
      [setId],
    );
    await ds.query(
      `INSERT INTO quiz_attempts (quiz_set_id, question_id, patient_id, session_token, user_answer, is_correct)
       VALUES ($1, $2, $3, $4, 'a', true)`,
      [setId, questionId, patientId, randomUUID()],
    );
  };

  beforeAll(async () => {
    assertTestDatabaseName(TEST_DATABASE);
    ds = await new DataSource({
      ...connectionOptions(TEST_DATABASE),
      entities: [User, MemoryEntry, QuizSet, QuizQuestion],
    }).initialize();
    // 생성자 의존성이 많아 필요한 필드만 채운다 — 보려는 것은 SQL 하나다.
    const service = Object.assign(Object.create(QuizService.prototype), {
      quizSetRepository: ds.getRepository(QuizSet),
      userRepository: ds.getRepository(User),
    }) as { getFreshSetId: typeof fresh };
    fresh = (patientId) => service.getFreshSetId(patientId);
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('환자 타임존 어제 0시가 경계다 — 직후는 붙고 직전은 안 붙는다', async () => {
    const p = await user('patient');
    const c = await user('caregiver');
    await set(p, c, 'ready', local('-1 day -1 minute'));
    expect(await fresh(p)).toBeNull();

    const justInside = await set(p, c, 'ready', local('-1 day +1 minute'));
    expect(await fresh(p)).toBe(justInside);
  });

  it('여럿이면 최신, 이 환자가 푼 세트는 건너뛴다', async () => {
    const p = await user('patient');
    const c = await user('caregiver');
    const older = await set(p, c, 'ready', local('-1 day +2 hours'));
    const newer = await set(p, c, 'ready', local('+1 minute'));
    expect(await fresh(p)).toBe(newer);

    await answer(newer, p);
    expect(await fresh(p)).toBe(older);

    await answer(older, p);
    expect(await fresh(p)).toBeNull();
  });

  it('생성 중·실패 세트와 다른 환자 세트는 안 붙는다', async () => {
    const p = await user('patient');
    const other = await user('patient');
    const c = await user('caregiver');
    await set(p, c, 'pending', local('+1 minute'));
    await set(p, c, 'failed', local('+1 minute'));
    await set(other, c, 'ready', local('+1 minute'));
    expect(await fresh(p)).toBeNull();
  });

  it('다른 환자가 푼 기록은 이 환자의 풀이로 치지 않는다', async () => {
    const p = await user('patient');
    const other = await user('patient');
    const c = await user('caregiver');
    const s = await set(p, c, 'ready', local('+1 minute'));
    await answer(s, other);
    expect(await fresh(p)).toBe(s);
  });
});
