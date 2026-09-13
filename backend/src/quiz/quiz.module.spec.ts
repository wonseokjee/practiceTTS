import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import { PracticeResult } from '../practice/entities/practice-result.entity';
import { PracticeService } from '../practice/practice.service';
import { GenerationUsageService } from '../usage/generation-usage.service';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QabResult } from './entities/qab-result.entity';
import { QabSessionCompletion } from './entities/qab-session-completion.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { SkillLevel } from './entities/skill-level.entity';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { WISH_CONVERSION_CLIENT } from './interfaces/IWishConversionClient';
import { QuizController } from './quiz.controller';
import { QuizModule } from './quiz.module';
import { QuizService } from './quiz.service';
import { QuizGenerationListener } from './services/quiz-generation.listener';

/**
 * Quiz Phase 3 와이어링 스모크 테스트
 *
 * - QuizModule 전체를 부트스트랩하면 AuthModule/TypeOrmModule.forRoot 등
 *   런타임 인프라가 필요해 단위 테스트에서 부적합하므로,
 *   Phase 3에서는 Quiz 핵심 provider(QuizService/Controller/Listener)의
 *   주입 그래프만 mock으로 구성해 검증한다.
 * - Phase 1 exports 빈 상태 검증은 메타데이터로 유지한다.
 */
describe('Quiz Phase 3 와이어링', () => {
  let moduleRef: TestingModule;

  function buildRepoMock() {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [QuizController],
      providers: [
        QuizService,
        QuizGenerationListener,
        // 컨트롤러가 활동 일자(스트릭)를 합칠 때만 쓴다. QuizService는 이걸
        // 주입받지 않는다 — 연습 데이터가 레벨링·추세로 새지 않게 하는 경계다.
        PracticeService,
        {
          provide: getRepositoryToken(PracticeResult),
          useValue: buildRepoMock(),
        },
        { provide: getRepositoryToken(QuizSet), useValue: buildRepoMock() },
        {
          provide: getRepositoryToken(QuizQuestion),
          useValue: buildRepoMock(),
        },
        { provide: getRepositoryToken(QuizAttempt), useValue: buildRepoMock() },
        {
          provide: getRepositoryToken(QuizBestScore),
          useValue: buildRepoMock(),
        },
        { provide: getRepositoryToken(MemoryEntry), useValue: buildRepoMock() },
        {
          provide: getRepositoryToken(PatientMemoryNote),
          useValue: buildRepoMock(),
        },
        { provide: getRepositoryToken(QabResult), useValue: buildRepoMock() },
        { provide: getRepositoryToken(User), useValue: buildRepoMock() },
        { provide: getRepositoryToken(SkillLevel), useValue: buildRepoMock() },
        {
          provide: getRepositoryToken(QabSessionCompletion),
          useValue: buildRepoMock(),
        },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
        { provide: QUIZ_GENERATION_CLIENT, useValue: { generate: jest.fn() } },
        {
          provide: QUIZ_SCORER,
          useValue: { isCorrect: jest.fn(), toScore: jest.fn() },
        },
        {
          provide: WISH_CONVERSION_CLIENT,
          useValue: { convert: jest.fn() },
        },
        {
          provide: PersonaContextService,
          useValue: {
            buildTokenMap: jest.fn(() => Promise.resolve({})),
            tokenizeWithMap: jest.fn((text: string) => text),
            restorePersonaText: jest.fn((text: string) => text),
          },
        },
        {
          provide: FastApiClientService,
          useValue: {
            mask: jest.fn((text: string) =>
              Promise.resolve({ maskedText: text }),
            ),
          },
        },
        // 수동 생성 라우트의 DailyCapGuard가 이걸 주입받는다(UsageModule).
        { provide: GenerationUsageService, useValue: { consume: jest.fn() } },
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('Quiz 핵심 provider 그래프가 예외 없이 컴파일된다', () => {
    expect(moduleRef).toBeDefined();
  });

  it('QuizService / QuizController / QuizGenerationListener가 주입된다', () => {
    expect(moduleRef.get(QuizService)).toBeDefined();
    expect(moduleRef.get(QuizController)).toBeDefined();
    expect(moduleRef.get(QuizGenerationListener)).toBeDefined();
  });

  it('QuizModule은 외부 exports가 없다', () => {
    const metadata = Reflect.getMetadata('exports', QuizModule) as
      | unknown[]
      | undefined;
    expect(metadata === undefined || metadata.length === 0).toBe(true);
  });
});
