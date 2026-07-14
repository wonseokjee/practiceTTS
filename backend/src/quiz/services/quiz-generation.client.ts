import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { retryTransient } from '../../common/retry.util';
import { QuizQuestionType } from '../constants/quiz-question-type';
import { QuizError, QuizErrorCode } from '../errors/quiz.errors';
import type {
  GeneratedQuizQuestion,
  IQuizGenerationClient,
  QuizGenerationResult,
} from '../interfaces/IQuizGenerationClient';
import type { IQuizGenerationPayload } from '../interfaces/IQuizGenerationPayload';

/** FastAPI `/quiz/generate` 응답의 단일 문제 (snake_case 원시 타입) */
interface RawQuizQuestion {
  type: QuizQuestionType;
  prompt: string;
  choices?: string[] | null;
  correct_answer: string;
  hint_first_char?: string | null;
}

/** FastAPI `/quiz/generate` 응답 원시 타입 */
interface RawQuizGenerateResponse {
  questions: RawQuizQuestion[];
  model: string;
  elapsed_ms: number;
  fallback_used: boolean;
}

/**
 * 퀴즈 생성 클라이언트 (FastAPI `/quiz/generate` 어댑터).
 *
 * 보안 핵심: payload 객체를 그대로 스프레드하지 않고, **명시적 화이트리스트 필드만**
 * 직렬화하여 LLM 호출 경로로 보낸다. 보호자 사적 데이터(mood/reflection/wish)는
 * IQuizGenerationPayload 타입 단계에서 이미 차단되지만, 여기서 한 번 더 명시적
 * 필드 매핑으로 누출을 방지한다.
 */
@Injectable()
export class QuizGenerationClient implements IQuizGenerationClient {
  private readonly logger = new Logger(QuizGenerationClient.name);
  private readonly baseUrl: string;

  /** 퀴즈 생성 타임아웃: 25초 (§7-2 LLM_TIMEOUT 기준) */
  private static readonly GENERATE_TIMEOUT_MS = 25_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'FASTAPI_URL',
      'http://localhost:8000',
    );
  }

  async generate(
    payload: IQuizGenerationPayload,
  ): Promise<QuizGenerationResult> {
    // 화이트리스트 직렬화 — 명시적 필드만 body에 담는다 (보호자 데이터 누출 방지)
    const body = {
      patient_notes: payload.patientNotes.map((note) => ({
        category: note.category,
        answer_text: note.answerText,
      })),
      ...(payload.photoTags
        ? {
            photo_tags: {
              location: payload.photoTags.location,
              objects: [...payload.photoTags.objects],
            },
          }
        : {}),
      ...(payload.targetWords
        ? { target_words: [...payload.targetWords] }
        : {}),
      ...(payload.distribution ? { distribution: payload.distribution } : {}),
    };

    try {
      // 일시적 업스트림 오류(429/502/타임아웃 등)는 백오프 재시도로 흡수한다.
      // 재시도가 없으면 Gemini 레이트리밋 한 번에 퀴즈가 영구 failed로 굳는다.
      const response = await retryTransient(
        () =>
          firstValueFrom(
            this.httpService.post<RawQuizGenerateResponse>(
              `${this.baseUrl}/quiz/generate`,
              body,
              { timeout: QuizGenerationClient.GENERATE_TIMEOUT_MS },
            ),
          ),
        {},
        (attempt, delayMs) =>
          this.logger.warn(
            `퀴즈 생성 일시 실패 — ${delayMs}ms 후 재시도 (${attempt}번째)`,
          ),
      );

      const data = response.data;
      const questions: GeneratedQuizQuestion[] = data.questions.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        choices: q.choices ?? null,
        correctAnswer: q.correct_answer,
        hintFirstChar: q.hint_first_char ?? null,
      }));

      // 원문 미저장 — 개수/모델만 로깅
      this.logger.log(
        `퀴즈 생성 완료 (questions=${questions.length}, model=${data.model}, fallback=${data.fallback_used})`,
      );

      return {
        questions,
        model: data.model,
        fallbackUsed: data.fallback_used,
      };
    } catch (error) {
      const { quizError, logMessage } = this.mapGenerationError(error);
      this.logger.error(`퀴즈 생성 실패: ${logMessage}`);
      throw quizError;
    }
  }

  /**
   * FastAPI 응답 HTTP status를 도메인 에러 코드 + 사용자친화 메시지로 매핑한다.
   * - 422 → LLM_INVALID_NOTES (영구): 메모가 부적합. 재시도 무의미.
   * - 504 → LLM_TIMEOUT (일시): 응답 지연. 재시도 가치 있음.
   * - 502 → LLM_UPSTREAM (일시): 업스트림 오류.
   * - 그 외/네트워크(응답 없음) → LLM_GENERATION_FAILED (일시, 제네릭).
   *
   * 사용자 메시지는 그대로 generationError에 저장되어 보호자 화면에 노출된다(S1).
   */
  private mapGenerationError(error: unknown): {
    quizError: QuizError;
    logMessage: string;
  } {
    const rawMessage =
      error instanceof Error ? error.message : '알 수 없는 오류';
    const status = this.extractHttpStatus(error);

    switch (status) {
      case 422:
        return {
          quizError: new QuizError(
            QuizErrorCode.LLM_INVALID_NOTES,
            '메모 내용이 너무 짧아 문제를 만들 수 없어요. 환자분의 하루를 조금 더 적어주세요.',
          ),
          logMessage: `422 INVALID_NOTES: ${rawMessage}`,
        };
      case 504:
        return {
          quizError: new QuizError(
            QuizErrorCode.LLM_TIMEOUT,
            'AI 응답이 지연되어 문제 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
          ),
          logMessage: `504 TIMEOUT: ${rawMessage}`,
        };
      case 502:
        return {
          quizError: new QuizError(
            QuizErrorCode.LLM_UPSTREAM,
            'AI 서비스에 일시적인 문제가 있어요. 잠시 후 다시 시도해주세요.',
          ),
          logMessage: `502 UPSTREAM: ${rawMessage}`,
        };
      default:
        return {
          quizError: new QuizError(
            QuizErrorCode.LLM_GENERATION_FAILED,
            '문제 생성 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
          ),
          logMessage: rawMessage,
        };
    }
  }

  /** axios 에러에서 HTTP status를 추출한다 (응답이 없으면 undefined). */
  private extractHttpStatus(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null) {
      const response = (error as { response?: { status?: unknown } }).response;
      if (response && typeof response.status === 'number') {
        return response.status;
      }
    }
    return undefined;
  }
}
