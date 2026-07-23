import { DataSource, Repository } from 'typeorm';
import { DiaryQuestion } from '../entities/diary-question.entity';
import {
  DIARY_QUESTIONS_SEED,
  seedDiaryQuestionsIfMissing,
} from './diary-questions.seed';

/**
 * 시드 멱등성 테스트 (Phase 1 §10-5)
 *
 * 외부 DB 없이 인메모리 fake repository로 멱등성을 검증한다.
 */
describe('seedDiaryQuestionsIfMissing — 멱등성', () => {
  /**
   * 인메모리 fake DiaryQuestion 저장소.
   * - (scope, text) 조합으로 unique 보장.
   * - save 시 새 객체에 id를 부여한다.
   */
  function createFakeDataSource(initial: DiaryQuestion[] = []): DataSource {
    const store: DiaryQuestion[] = [...initial];
    let nextId = 1;

    const repoFake: Partial<Repository<DiaryQuestion>> = {
      findOne: ((options: { where: Partial<DiaryQuestion> }) => {
        const { where } = options;
        return Promise.resolve(
          store.find((q) => q.scope === where.scope && q.text === where.text) ??
            null,
        );
      }) as Repository<DiaryQuestion>['findOne'],
      create: ((input: Partial<DiaryQuestion>) => ({
        ...input,
      })) as Repository<DiaryQuestion>['create'],
      save: ((input: Partial<DiaryQuestion>) => {
        const saved = {
          id: `gen-${nextId++}`,
          createdAt: new Date(),
          ...input,
        } as DiaryQuestion;
        store.push(saved);
        return Promise.resolve(saved);
      }) as Repository<DiaryQuestion>['save'],
    };

    return {
      getRepository: ((entityClass: unknown) => {
        if (entityClass !== DiaryQuestion) {
          throw new Error('Unexpected entity class in fake DataSource');
        }
        return repoFake as Repository<DiaryQuestion>;
      }) as DataSource['getRepository'],
    } as DataSource;
  }

  it('빈 테이블에서 1차 실행 시 14개 모두 INSERT, 2차 실행 시 모두 SKIP', async () => {
    // Given
    const ds = createFakeDataSource();

    // When — 1차 실행
    const first = await seedDiaryQuestionsIfMissing(ds);

    // Then
    expect(first.inserted).toBe(DIARY_QUESTIONS_SEED.length);
    expect(first.skipped).toBe(0);

    // When — 2차 실행 (멱등)
    const second = await seedDiaryQuestionsIfMissing(ds);

    // Then
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(DIARY_QUESTIONS_SEED.length);
  });

  it('1개 시드 텍스트가 미리 존재하면 나머지 13개만 INSERT', async () => {
    // Given — 시드 1개 미리 적용
    const preExisting: DiaryQuestion = {
      id: 'pre',
      scope: DIARY_QUESTIONS_SEED[0].scope,
      category: DIARY_QUESTIONS_SEED[0].category,
      text: DIARY_QUESTIONS_SEED[0].text,
      isActive: true,
      orderHint: 0,
      createdAt: new Date(),
    } as DiaryQuestion;
    const ds = createFakeDataSource([preExisting]);

    // When
    const result = await seedDiaryQuestionsIfMissing(ds);

    // Then
    expect(result.inserted).toBe(DIARY_QUESTIONS_SEED.length - 1);
    expect(result.skipped).toBe(1);
  });

  it('시드 데이터에 보호자 5개 + 환자 9개(activity 3, moment 3, context 3) 정확히 포함된다', () => {
    // Given / When
    const caregiverCount = DIARY_QUESTIONS_SEED.filter(
      (q) => q.scope === 'caregiver',
    ).length;
    const patientActivity = DIARY_QUESTIONS_SEED.filter(
      (q) => q.scope === 'patient' && q.category === 'activity',
    ).length;
    const patientMoment = DIARY_QUESTIONS_SEED.filter(
      (q) => q.scope === 'patient' && q.category === 'moment',
    ).length;
    const patientContext = DIARY_QUESTIONS_SEED.filter(
      (q) => q.scope === 'patient' && q.category === 'context',
    ).length;

    // Then
    expect(caregiverCount).toBe(5);
    expect(patientActivity).toBe(3);
    expect(patientMoment).toBe(3);
    expect(patientContext).toBe(3);
    expect(DIARY_QUESTIONS_SEED).toHaveLength(14);
  });
});
