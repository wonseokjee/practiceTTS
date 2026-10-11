import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  buildQuizRepeatReport,
  formatQuizRepeatReport,
} from '../../scripts/report-quiz-repeat';
import { openTestDataSource } from './test-database';

/**
 * `report:quiz-repeat`를 심은 세트로 돌린다. 창·분모·유형 분리·정규화·로케일·
 * 상태 필터는 SQL이라 mock으로 증명할 수 없다.
 *
 * 환자 A (ko-KR), 기준 D0 = 2026-10-01 10:00Z, 기준 시각 D6
 *   S1 D0  객관식 "어디서 산책했나요?"→공원 · 따라 말하기 산책
 *   S2 D1  객관식 "산책은 어디서 하셨어요?"→"공원 "(말만 바꾼 반복) · "무엇을 드셨나요?"→호박죽
 *          · 따라 말하기 낮잠
 *   F  D4  failed 세트(공원) — 세지 않는다
 *   S3 D5  객관식 "어디서 산책했나요?"→공원(S1과 문장까지 같음, 4~5일 전) · 따라 말하기 산책
 * 환자 B (en-US) — 같은 반복이 있어도 기본(ko-KR)에선 빠진다
 */
describe('report:quiz-repeat (DB)', () => {
  let ds: DataSource;
  const D0 = Date.parse('2026-10-01T10:00:00Z');
  const day = (n: number) => new Date(D0 + n * 24 * 60 * 60 * 1000);
  const NOW = day(6);

  const user = async (role: string, locale = 'ko-KR'): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, locale) VALUES ($1, $2, 'u', $3)`,
      [id, role, locale],
    );
    return id;
  };

  const set = async (
    patient: string,
    caregiver: string,
    at: Date,
    questions: Array<[string, string, string]>,
    status = 'ready',
  ): Promise<void> => {
    const [entry] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO memory_entries (caregiver_id, patient_id) VALUES ($1, $2) RETURNING id`,
      [caregiver, patient],
    );
    const [s] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO quiz_sets (memory_entry_id, patient_id, caregiver_id, generation_status, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [entry.id, patient, caregiver, status, at.toISOString()],
    );
    for (const [i, [type, prompt, answer]] of questions.entries()) {
      await ds.query(
        `INSERT INTO quiz_questions (quiz_set_id, order_index, type, prompt, correct_answer)
         VALUES ($1, $2, $3, $4, $5)`,
        [s.id, i, type, prompt, answer],
      );
    }
  };

  const SPEECH = '다음 단어를 듣고 따라 말해보세요';

  beforeAll(async () => {
    ds = await openTestDataSource();
    await ds.query('TRUNCATE users CASCADE');
    const a = await user('patient');
    const c = await user('caregiver');
    await set(a, c, day(0), [
      ['multiple_choice', '어디서 산책했나요?', '공원'],
      ['speech', SPEECH, '산책'],
    ]);
    await set(a, c, day(1), [
      ['multiple_choice', '산책은 어디서 하셨어요?', '공원 '],
      ['multiple_choice', '무엇을 드셨나요?', '호박죽'],
      ['speech', SPEECH, '낮잠'],
    ]);
    await set(a, c, day(4), [['multiple_choice', '어디?', '공원']], 'failed');
    await set(a, c, day(5), [
      ['multiple_choice', '어디서 산책했나요?', '공원'],
      ['speech', SPEECH, '산책'],
    ]);
    const b = await user('patient', 'en-US');
    await set(b, c, day(0), [['multiple_choice', 'Where?', 'park']]);
    await set(b, c, day(1), [['multiple_choice', 'Where?', 'Park']]);
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('1·3일 창: 바로 다음 날 말만 바꾼 같은 정답을 반복으로 센다', async () => {
    const r = await buildQuizRepeatReport(ds, { now: NOW });

    expect(r.patients).toBe(1);
    expect(r.sets).toBe(3);
    for (const days of [1, 3]) {
      expect(r.windows[days].multiple_choice).toEqual({
        questions: 4,
        eligible: 2, // S2의 둘만 창 안에 이전 세트가 있다(S3는 4일 전이 마지막)
        repeated: 1,
        exactRepeated: 0,
        rate: 0.5,
      });
      expect(r.windows[days].speech).toEqual({
        questions: 3,
        eligible: 1,
        repeated: 0,
        exactRepeated: 0,
        rate: 0,
      });
    }
  });

  it('7일 창: 며칠 뒤 다시 낸 문장까지 같은 문항과 낱말을 잡는다', async () => {
    const r = await buildQuizRepeatReport(ds, { now: NOW });

    expect(r.windows[7].multiple_choice).toEqual({
      questions: 4,
      eligible: 3,
      repeated: 2,
      exactRepeated: 1,
      rate: 2 / 3,
    });
    expect(r.windows[7].speech).toEqual({
      questions: 3,
      eligible: 2,
      repeated: 1,
      exactRepeated: 0,
      rate: 0.5,
    });
  });

  it('--since 뒤 세트만 세되, 그 전 세트는 비교 대상으로 본다', async () => {
    const r = await buildQuizRepeatReport(ds, { now: NOW, since: day(1) });

    expect(r.sets).toBe(2);
    expect(r.windows[1].multiple_choice.repeated).toBe(1); // S2가 S1(since 전)을 반복
    expect(r.windows[1].multiple_choice.questions).toBe(3);
  });

  it('로케일을 전부로 하면 대소문자만 다른 영어 정답도 반복으로 센다', async () => {
    const r = await buildQuizRepeatReport(ds, { now: NOW, locale: null });

    expect(r.patients).toBe(2);
    expect(r.windows[1].multiple_choice.repeated).toBe(2);
  });

  it('분모가 0이면 비율은 null이고 표에는 —로 나온다', async () => {
    const r = await buildQuizRepeatReport(ds, { now: NOW, locale: 'ja-JP' });

    expect(r.windows[3].multiple_choice.rate).toBeNull();
    expect(formatQuizRepeatReport(r)).toContain('—');
  });
});
