import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PracticeResult } from './entities/practice-result.entity';
import { PracticeService } from './practice.service';
import type { SubmitPracticeResultsDto } from './dto/submit-practice-results.dto';

/**
 * PracticeService 단위 테스트.
 *
 * 검증의 초점은 "무엇을 저장하는가"가 아니라 **"검사 지표를 건드리지 않는가"**다.
 * 연습은 한 세션 40문항으로 검사(13문항)를 3:1로 압도하므로, 한 줄이라도
 * qab_results 쪽으로 새면 연습 성적이 곧 환자의 측정값이 된다.
 */
describe('PracticeService', () => {
  const PATIENT_ID = 'patient-uuid';
  const SESSION_TOKEN = '00000000-0000-4000-8000-000000000001';

  let service: PracticeService;
  /** INSERT에 넘어간 행들 */
  let insertedValues: unknown[];
  /** into()에 넘어간 엔티티 — 저장 대상 테이블 확인용 */
  let insertTargets: unknown[];
  /** orIgnore() 호출 여부 — 멱등이 DB 수준(ON CONFLICT)인지 확인 */
  let orIgnoreCalls: number;

  beforeEach(async () => {
    insertedValues = [];
    insertTargets = [];
    orIgnoreCalls = 0;

    // 체이닝 목: 각 단계가 자기 자신을 돌려주도록 명시 타입을 붙인다
    // (mockReturnThis/암묵 반환은 any로 새어 no-unsafe-return에 걸린다).
    interface QueryBuilderMock {
      insert: () => QueryBuilderMock;
      into: (target: unknown) => QueryBuilderMock;
      values: (rows: unknown[]) => QueryBuilderMock;
      orIgnore: () => QueryBuilderMock;
      execute: () => Promise<{ identifiers: unknown[] }>;
    }

    const queryBuilder: QueryBuilderMock = {
      insert: jest.fn((): QueryBuilderMock => queryBuilder),
      into: jest.fn((target: unknown): QueryBuilderMock => {
        insertTargets.push(target);
        return queryBuilder;
      }),
      values: jest.fn((rows: unknown[]): QueryBuilderMock => {
        insertedValues.push(...rows);
        return queryBuilder;
      }),
      orIgnore: jest.fn((): QueryBuilderMock => {
        orIgnoreCalls += 1;
        return queryBuilder;
      }),
      execute: jest.fn(() => Promise.resolve({ identifiers: [] })),
    };

    const repoMock = {
      create: jest.fn((row: unknown) => row),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeService,
        { provide: getRepositoryToken(PracticeResult), useValue: repoMock },
      ],
    }).compile();

    service = module.get<PracticeService>(PracticeService);
  });

  const dto = (
    results: SubmitPracticeResultsDto['results'],
  ): SubmitPracticeResultsDto => ({ sessionToken: SESSION_TOKEN, results });

  describe('오염 격리', () => {
    it('연습 결과는 practice_results에만 쓴다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          {
            itemKind: 'imageChoice',
            itemRef: 'apple',
            tier: 0,
            isCorrect: true,
          },
        ]),
      );

      expect(insertTargets).toEqual([PracticeResult]);
    });

    it('레벨 재계산·추세·완료 마커에 해당하는 부수효과가 없다', () => {
      // 검사 경로(QuizService.saveQabResults)는 저장 후 recomputeSkillLevel과
      // 완료 마커 upsert를 실행한다. 연습에는 그에 대응하는 것이 없어야 한다.
      // 서비스가 주입받은 의존성이 practice_results 리포지토리 하나뿐이라는 사실이
      // 곧 그 보증이다 — 다른 테이블에 닿을 손이 없다.
      const injected = Reflect.ownKeys(service).filter(
        (k) => typeof k === 'string',
      );
      expect(injected).toEqual(['practiceResultRepository']);
    });
  });

  describe('attempt — 단서 전/후를 둘 다 남긴다', () => {
    it('같은 문항의 2차 시도가 1차를 덮어쓰지 않는다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          { itemKind: 'naming', itemRef: 'apple', tier: 1, attempt: 1 },
          { itemKind: 'naming', itemRef: 'apple', tier: 1, attempt: 2 },
        ]),
      );

      expect(insertedValues).toHaveLength(2);
      expect(insertedValues).toEqual([
        expect.objectContaining({ itemRef: 'apple', attempt: 1 }),
        expect.objectContaining({ itemRef: 'apple', attempt: 2 }),
      ]);
    });

    it('attempt를 생략하면 1이다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          { itemKind: 'spell', itemRef: 'apple', tier: 0, isCorrect: false },
        ]),
      );

      expect(insertedValues[0]).toEqual(
        expect.objectContaining({ attempt: 1 }),
      );
    });
  });

  describe('isCorrect — 판정 없음과 오답은 다르다', () => {
    it('Tier 1(채점 안 함)의 생략은 null로 저장된다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([{ itemKind: 'naming', itemRef: 'apple', tier: 1 }]),
      );

      // ?? false로 접으면 채점하지 않은 발화가 전부 실패로 기록된다.
      expect(insertedValues[0]).toEqual(
        expect.objectContaining({ isCorrect: null }),
      );
    });

    it('false는 false로 보존된다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          {
            itemKind: 'imageChoice',
            itemRef: 'apple',
            tier: 0,
            isCorrect: false,
          },
        ]),
      );

      expect(insertedValues[0]).toEqual(
        expect.objectContaining({ isCorrect: false }),
      );
    });
  });

  describe('멱등·경계', () => {
    it('INSERT는 orIgnore(ON CONFLICT DO NOTHING)로 나간다', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          {
            itemKind: 'imageChoice',
            itemRef: 'apple',
            tier: 0,
            isCorrect: true,
          },
        ]),
      );

      expect(orIgnoreCalls).toBe(1);
    });

    it('빈 tail은 INSERT 없이 no-op이다', async () => {
      const res = await service.saveResults(PATIENT_ID, dto([]));

      expect(res).toEqual({ saved: 0 });
      expect(insertedValues).toHaveLength(0);
    });

    it('patientId는 서버가 정한 값을 쓴다(DTO에 없다)', async () => {
      await service.saveResults(
        PATIENT_ID,
        dto([
          {
            itemKind: 'imageChoice',
            itemRef: 'apple',
            tier: 0,
            isCorrect: true,
          },
        ]),
      );

      expect(insertedValues[0]).toEqual(
        expect.objectContaining({ patientId: PATIENT_ID }),
      );
    });
  });
});
