import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMemoryEntryDto } from './create-memory-entry.dto';

/**
 * CreateMemoryEntryDto 검증 단위 테스트 (Phase 1 §10-2, 5 케이스)
 *
 * - DTO 레벨은 `patientAnswers >= 0` 허용 (P1-N5=(b))
 * - "patientAnswers OR photo" OR 검증은 서비스 레이어 책임 → 본 spec은 다루지 않음
 */
describe('CreateMemoryEntryDto', () => {
  const VALID_UUID = '11111111-1111-4111-8111-111111111111';
  const VALID_QUESTION_UUID = '22222222-2222-4222-8222-222222222222';

  function buildBaseDto(
    overrides: Partial<Record<keyof CreateMemoryEntryDto, unknown>> = {},
  ): unknown {
    return {
      patientId: VALID_UUID,
      mood: { level: 4 },
      patientAnswers: [
        {
          questionId: VALID_QUESTION_UUID,
          category: 'activity',
          answerText: '공원에서 산책했어요',
        },
      ],
      ...overrides,
    };
  }

  it('케이스 1: patientAnswers + 필수만 채워진 정상 입력은 검증을 통과한다', async () => {
    // Given
    const dto = plainToInstance(CreateMemoryEntryDto, buildBaseDto());

    // When
    const errors = await validate(dto);

    // Then
    expect(errors).toHaveLength(0);
  });

  it('케이스 2: patientAnswers=[] (빈 배열)도 DTO 레벨에서는 통과한다 (P1-N5=(b))', async () => {
    // Given — 서비스 레이어가 OR 검증을 담당하므로 DTO는 빈 배열 허용
    const dto = plainToInstance(
      CreateMemoryEntryDto,
      buildBaseDto({ patientAnswers: [] }),
    );

    // When
    const errors = await validate(dto);

    // Then
    expect(errors).toHaveLength(0);
  });

  it('케이스 3: 모든 옵션 필드(caregiverAnswer + caregiverWishMessage)가 채워진 정상 입력은 통과한다', async () => {
    // Given
    const dto = plainToInstance(
      CreateMemoryEntryDto,
      buildBaseDto({
        caregiverAnswer: {
          questionId: VALID_QUESTION_UUID,
          answerText: '오늘은 힘들었다',
        },
        caregiverWishMessage: '사랑해요',
      }),
    );

    // When
    const errors = await validate(dto);

    // Then
    expect(errors).toHaveLength(0);
  });

  it('케이스 4: patientAnswers[0].answerText가 300자 초과면 검증 실패한다', async () => {
    // Given
    const longText = 'a'.repeat(301);
    const dto = plainToInstance(
      CreateMemoryEntryDto,
      buildBaseDto({
        patientAnswers: [
          {
            questionId: VALID_QUESTION_UUID,
            category: 'activity',
            answerText: longText,
          },
        ],
      }),
    );

    // When
    const errors = await validate(dto);

    // Then — nested 검증이라 errors[0].children에 위반이 들어있음
    expect(errors.length).toBeGreaterThan(0);
    const flattened = JSON.stringify(errors);
    expect(flattened).toContain('1~300자');
  });

  it('케이스 5: caregiverWishMessage가 120자 초과면 검증 실패한다', async () => {
    // Given
    const dto = plainToInstance(
      CreateMemoryEntryDto,
      buildBaseDto({ caregiverWishMessage: 'a'.repeat(121) }),
    );

    // When
    const errors = await validate(dto);

    // Then
    expect(errors.length).toBeGreaterThan(0);
    const flattened = JSON.stringify(errors);
    expect(flattened).toContain('1~120자');
  });

  it('케이스 6 (보강): mood.level이 0이면 검증 실패한다 (1..5 범위 강제)', async () => {
    // Given
    const dto = plainToInstance(
      CreateMemoryEntryDto,
      buildBaseDto({ mood: { level: 0 } }),
    );

    // When
    const errors = await validate(dto);

    // Then
    expect(errors.length).toBeGreaterThan(0);
  });

  it('케이스 7 (보강): multipart JSON 문자열로 전달된 mood/patientAnswers도 정상 파싱된다 (P1-N1=(a))', async () => {
    // Given — 컨트롤러에서 multipart로 전달된 JSON 문자열을 시뮬레이션
    const dto = plainToInstance(CreateMemoryEntryDto, {
      patientId: VALID_UUID,
      mood: JSON.stringify({ level: 3 }),
      patientAnswers: JSON.stringify([
        {
          questionId: VALID_QUESTION_UUID,
          category: 'moment',
          answerText: '웃었어요',
        },
      ]),
    });

    // When
    const errors = await validate(dto);

    // Then — @Transform이 JSON 문자열을 nested instance까지 변환한 후 nested 검증 통과
    expect(dto.mood.level).toBe(3);
    expect(dto.patientAnswers).toHaveLength(1);
    expect(dto.patientAnswers[0].category).toBe('moment');
    expect(errors).toHaveLength(0);
  });
});
