import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { MemoryEntry } from '../../src/memory/entities/memory-entry.entity';
import { QuizQuestion } from '../../src/quiz/entities/quiz-question.entity';
import { QuizSet } from '../../src/quiz/entities/quiz-set.entity';
import type { IQuizGenerationPayload } from '../../src/quiz/interfaces/IQuizGenerationPayload';
import { QuizService } from '../../src/quiz/quiz.service';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

type Variety = Pick<IQuizGenerationPayload, 'recentQuestions' | 'focus'>;

/**
 * 퀴즈 반복 피하기 — 최근 문제 조회 SQL(조인·창·상태·정렬)은 mock으로 증명할 수 없다.
 *
 * 지키는 규칙: 이 환자의 ready 세트만, 3일 안만, 지금 만드는 세트는 빼고,
 * 최근 세트부터. 조회는 best-effort라 SQL이 틀리면 조용히 {}가 된다 —
 * 그래서 여기서 결과가 비어 있지 않은지를 꼭 본다.
 */
describe('QuizService 최근 문제 조회 (DB)', () => {
  let ds: DataSource;
  let load: (
    patientId: string,
    currentSetId: string,
    tokenMap: Record<string, string>,
  ) => Promise<Variety>;

  const user = async (role: 'patient' | 'caregiver'): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name) VALUES ($1, $2, 'u')`,
      [id, role],
    );
    return id;
  };

  const set = async (
    patientId: string,
    caregiverId: string,
    status: string,
    createdAt: string,
    questions: Array<[string, string, string]>,
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
    for (const [i, [type, prompt, answer]] of questions.entries()) {
      await ds.query(
        `INSERT INTO quiz_questions (quiz_set_id, order_index, type, prompt, correct_answer)
         VALUES ($1, $2, $3, $4, $5)`,
        [setId, i, type, prompt, answer],
      );
    }
    return setId;
  };

  beforeAll(async () => {
    assertTestDatabaseName(TEST_DATABASE);
    ds = await new DataSource({
      ...connectionOptions(TEST_DATABASE),
      entities: [User, MemoryEntry, QuizSet, QuizQuestion],
    }).initialize();
    // 생성자 의존성이 많아 필요한 필드만 채운다 — 보려는 것은 SQL 하나다.
    const service = Object.assign(Object.create(QuizService.prototype), {
      quizQuestionRepository: ds.getRepository(QuizQuestion),
      quizSetRepository: ds.getRepository(QuizSet),
      personaContext: {
        tokenizeWithMap: (text: string, map: Record<string, string>) =>
          Object.entries(map).reduce(
            (acc, [name, token]) => acc.split(name).join(token),
            text,
          ),
      },
      logger: { warn: (msg: string) => console.warn(msg) },
    }) as {
      loadVarietyBestEffort: typeof load;
    };
    load = (...args) => service.loadVarietyBestEffort(...args);
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('이 환자의 3일 안 ready 세트 문제를 최근 것부터 돌려주고, 지금 세트는 뺀다', async () => {
    const p = await user('patient');
    const other = await user('patient');
    const c = await user('caregiver');
    await set(p, c, 'ready', `now() - interval '2 days'`, [
      ['multiple_choice', '어디서 산책했나요?', '공원'],
      ['speech', '다음 단어를 듣고 따라 말해보세요', '산책'],
    ]);
    await set(p, c, 'ready', `now() - interval '1 day'`, [
      ['multiple_choice', '무엇을 드셨나요?', '호박죽'],
    ]);
    await set(p, c, 'ready', `now() - interval '4 days'`, [
      ['multiple_choice', '창 밖', '오래됨'],
    ]);
    await set(p, c, 'failed', `now() - interval '1 day'`, [
      ['multiple_choice', '실패 세트', '버림'],
    ]);
    await set(other, c, 'ready', `now()`, [
      ['multiple_choice', '다른 환자', '남'],
    ]);
    const current = await set(p, c, 'pending', 'now()', [
      ['multiple_choice', '지금 세트', '지금'],
    ]);

    const variety = await load(p, current, {});

    expect(variety.recentQuestions).toEqual([
      { prompt: '무엇을 드셨나요?', correctAnswer: '호박죽' },
      { prompt: '어디서 산책했나요?', correctAnswer: '공원' },
      { prompt: null, correctAnswer: '산책' },
    ]);
    // 세트 5개(ready 3·failed 1·pending 1) → 지금 세트는 5번째(순번 4) → 첫 축
    expect(variety.focus).toBe('activity');
  });

  it('최근 문제의 실명은 다시 토큰으로 바꾼다', async () => {
    const p = await user('patient');
    const c = await user('caregiver');
    await set(p, c, 'ready', `now() - interval '1 day'`, [
      ['multiple_choice', '민준이와 어디 갔나요?', '공원'],
    ]);
    const current = await set(p, c, 'pending', 'now()', []);

    const variety = await load(p, current, { 민준: '[손자1]' });

    expect(variety.recentQuestions).toEqual([
      { prompt: '[손자1]이와 어디 갔나요?', correctAnswer: '공원' },
    ]);
    expect(variety.focus).toBe('place');
  });
});
