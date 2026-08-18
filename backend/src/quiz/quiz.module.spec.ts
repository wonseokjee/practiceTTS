import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
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
            buildTokenMap: jest.fn(async () => ({})),
            tokenizeWithMap: jest.fn((text: string) => text),
            restorePersonaText: jest.fn((text: string) => text),
          },
        },
        {
          provide: FastApiClientService,
          useValue: {
            mask: jest.fn(async (text: string) => ({ maskedText: text })),
          },
        },
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
