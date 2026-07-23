import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { QuizError, QuizErrorCode } from '../errors/quiz.errors';
import type { IQuizGenerationPayload } from '../interfaces/IQuizGenerationPayload';
import { QuizGenerationClient } from './quiz-generation.client';

/**
 * QuizGenerationClient 단위 테스트 (보안 핵심 — 화이트리스트 직렬화).
 *
 * 검증 범위:
 *  - 화이트리스트 직렬화: 사적 필드(mood/wish 등)를 섞어도 post body에 누출 없음
 *  - patient_notes는 snake_case(category, answer_text)로 매핑
 *  - 정상 응답 snake_case → camelCase 매핑(correct_answer→correctAnswer 등)
 *  - HttpService throw 시 QuizError(LLM_GENERATION_FAILED) 변환
 */
describe('QuizGenerationClient', () => {
  let client: QuizGenerationClient;
  let httpServiceMock: { post: jest.Mock };
  let configServiceMock: { get: jest.Mock };

  /** FastAPI 정상 응답 (snake_case 원시 형태) 팩토리 */
  function buildRawResponse() {
    return {
      data: {
        questions: [
          {
            type: 'multiple_choice',
            prompt: '어디에 갔나요?',
            choices: ['공원', '바다', '산', '집'],
            correct_answer: '공원',
            hint_first_char: null,
          },
          {
            type: 'fill_blank',
            prompt: '___에서 산책했어요',
            choices: null,
            correct_answer: '공원',
            hint_first_char: '공',
          },
        ],
        model: 'gpt-test',
        elapsed_ms: 1234,
        fallback_used: false,
      },
    };
  }

  beforeEach(() => {
    httpServiceMock = {
      post: jest.fn(() => of(buildRawResponse())),
    };
    configServiceMock = {
      get: jest.fn(() => 'http://localhost:8000'),
    };
    client = new QuizGenerationClient(
      httpServiceMock as unknown as HttpService,
      configServiceMock as unknown as ConfigService,
    );
  });

  describe('화이트리스트 직렬화 (보호자 데이터 누출 방지)', () => {
    it('payload에 사적 필드(mood/caregiverWishMessage)를 섞어도 post body에 존재하지 않아야 한다', async () => {
      // Given — 타입상 불가능하지만 as any로 사적 필드를 강제 주입
      const payload = {
        patientNotes: [{ category: 'activity', answerText: '공원 산책' }],
        mood: { level: 5 },
        caregiverWishMessage: '사랑해요',
        caregiverReflection: '오늘은 힘들었다',
      } as unknown as IQuizGenerationPayload;

      // When
      await client.generate(payload);

      // Then — post에 전달된 body 검사
      const body = httpServiceMock.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty('mood');
      expect(body).not.toHaveProperty('caregiverWishMessage');
      expect(body).not.toHaveProperty('caregiverReflection');

      // 허용된 키만 존재 (patient_notes만 — 옵션 필드 미지정)
      expect(Object.keys(body).sort()).toEqual(['patient_notes']);
    });

    it('patient_notes는 snake_case(category, answer_text)로 매핑되어야 한다', async () => {
      const payload: IQuizGenerationPayload = {
        patientNotes: [
          { category: 'activity', answerText: '공원 산책' },
          { category: 'moment', answerText: '함께 웃었어요' },
        ],
      };

      await client.generate(payload);

      const body = httpServiceMock.post.mock.calls[0][1] as {
        patient_notes: Array<Record<string, unknown>>;
      };
      expect(body.patient_notes).toEqual([
        { category: 'activity', answer_text: '공원 산책' },
        { category: 'moment', answer_text: '함께 웃었어요' },
      ]);
      // camelCase answerText 키가 새어나가지 않음
      expect(body.patient_notes[0]).not.toHaveProperty('answerText');
    });

    it('photoTags/targetWords/distribution가 있으면 snake_case로 포함하되 그 외 키는 없어야 한다', async () => {
      const payload: IQuizGenerationPayload = {
        patientNotes: [{ category: 'context', answerText: '바다' }],
        photoTags: { location: '해변', objects: ['파도', '모래'] },
        targetWords: ['바다', '여름'],
        distribution: { multiple_choice: 2, yes_no: 2, fill_blank: 1 },
      };

      await client.generate(payload);

      const body = httpServiceMock.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(Object.keys(body).sort()).toEqual([
        'distribution',
        'patient_notes',
        'photo_tags',
        'target_words',
      ]);
      expect(body.photo_tags).toEqual({
        location: '해변',
        objects: ['파도', '모래'],
      });
      expect(body.target_words).toEqual(['바다', '여름']);
    });

    it('옵션 필드(photoTags 등)가 없으면 해당 키는 body에 포함되지 않아야 한다', async () => {
      const payload: IQuizGenerationPayload = {
        patientNotes: [{ category: 'activity', answerText: '산책' }],
      };

      await client.generate(payload);

      const body = httpServiceMock.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty('photo_tags');
      expect(body).not.toHaveProperty('target_words');
      expect(body).not.toHaveProperty('distribution');
    });
  });

  describe('정상 응답 매핑 (snake_case → camelCase)', () => {
    it('correct_answer→correctAnswer, hint_first_char→hintFirstChar로 매핑해야 한다', async () => {
      const payload: IQuizGenerationPayload = {
        patientNotes: [{ category: 'activity', answerText: '산책' }],
      };

      const result = await client.generate(payload);

      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]).toEqual({
        type: 'multiple_choice',
        prompt: '어디에 갔나요?',
        choices: ['공원', '바다', '산', '집'],
        correctAnswer: '공원',
        hintFirstChar: null,
      });
      expect(result.questions[1].hintFirstChar).toBe('공');
      expect(result.model).toBe('gpt-test');
      expect(result.fallbackUsed).toBe(false);
    });

    it('choices가 undefined/null이면 null로 정규화해야 한다', async () => {
      httpServiceMock.post.mockReturnValueOnce(
        of({
          data: {
            questions: [
              {
                type: 'yes_no',
                prompt: '맞나요?',
                correct_answer: 'yes',
              },
            ],
            model: 'm',
            elapsed_ms: 1,
            fallback_used: true,
          },
        }),
      );

      const result = await client.generate({
        patientNotes: [{ category: 'activity', answerText: 'x' }],
      });

      expect(result.questions[0].choices).toBeNull();
      expect(result.questions[0].hintFirstChar).toBeNull();
      expect(result.fallbackUsed).toBe(true);
    });
  });

  describe('에러 처리', () => {
    it('HttpService가 throw하면 QuizError(LLM_GENERATION_FAILED)로 변환해야 한다', async () => {
      // post 호출 시마다 항상 에러 Observable 반환 (단언 2회 모두 적용되도록)
      httpServiceMock.post.mockImplementation(() =>
        throwError(() => new Error('연결 실패')),
      );

      const payload: IQuizGenerationPayload = {
        patientNotes: [{ category: 'activity', answerText: '산책' }],
      };

      await expect(client.generate(payload)).rejects.toMatchObject({
        code: QuizErrorCode.LLM_GENERATION_FAILED,
      });
      await expect(client.generate(payload)).rejects.toBeInstanceOf(QuizError);
    });

    /** FastAPI HTTP status별 도메인 에러 코드 매핑 (S2: 영구/일시 구분) */
    it.each([
      [422, QuizErrorCode.LLM_INVALID_NOTES],
      [504, QuizErrorCode.LLM_TIMEOUT],
      [502, QuizErrorCode.LLM_UPSTREAM],
    ])(
      'FastAPI %i 응답은 %s 코드로 매핑해야 한다',
      async (status, expectedCode) => {
        httpServiceMock.post.mockImplementation(() =>
          throwError(() =>
            Object.assign(new Error('upstream'), { response: { status } }),
          ),
        );

        await expect(
          client.generate({
            patientNotes: [{ category: 'activity', answerText: '산책' }],
          }),
        ).rejects.toMatchObject({ code: expectedCode });
      },
    );

    it('응답 없는 네트워크 오류는 LLM_GENERATION_FAILED(제네릭)로 매핑해야 한다', async () => {
      httpServiceMock.post.mockImplementation(() =>
        throwError(() => new Error('ECONNREFUSED')),
      );

      await expect(
        client.generate({
          patientNotes: [{ category: 'activity', answerText: '산책' }],
        }),
      ).rejects.toMatchObject({ code: QuizErrorCode.LLM_GENERATION_FAILED });
    });
  });
});
