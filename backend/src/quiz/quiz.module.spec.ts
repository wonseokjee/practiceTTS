import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizModule } from './quiz.module';

/**
 * QuizModule 스모크 테스트 (Phase 1 §10-6)
 *
 * - TypeOrmModule.forFeature 등록만 검증.
 * - DB 연결 없이 4개 엔티티 토큰이 정상 주입되는지 확인.
 */
describe('QuizModule (Phase 1 골격)', () => {
  let moduleRef: TestingModule;

  // 각 엔티티 토큰을 빈 Repository mock으로 대체하여 forFeature 의존을 끊는다
  function buildRepoMock() {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [QuizModule],
    })
      .overrideProvider(getRepositoryToken(QuizSet))
      .useValue(buildRepoMock())
      .overrideProvider(getRepositoryToken(QuizQuestion))
      .useValue(buildRepoMock())
      .overrideProvider(getRepositoryToken(QuizAttempt))
      .useValue(buildRepoMock())
      .overrideProvider(getRepositoryToken(QuizBestScore))
      .useValue(buildRepoMock())
      .compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('QuizModule이 예외 없이 컴파일된다', () => {
    expect(moduleRef).toBeDefined();
  });

  it('4개 엔티티의 Repository 토큰을 모두 주입할 수 있다', () => {
    expect(moduleRef.get(getRepositoryToken(QuizSet))).toBeDefined();
    expect(moduleRef.get(getRepositoryToken(QuizQuestion))).toBeDefined();
    expect(moduleRef.get(getRepositoryToken(QuizAttempt))).toBeDefined();
    expect(moduleRef.get(getRepositoryToken(QuizBestScore))).toBeDefined();
  });

  it('QuizModule은 외부 exports가 없다 (Phase 1 골격)', () => {
    // exports 빈 상태를 메타데이터로 직접 검증
    const metadata = Reflect.getMetadata('exports', QuizModule) as
      | unknown[]
      | undefined;
    // @Module({ exports: [] })의 메타데이터는 빈 배열 또는 undefined
    expect(metadata === undefined || metadata.length === 0).toBe(true);
  });
});
