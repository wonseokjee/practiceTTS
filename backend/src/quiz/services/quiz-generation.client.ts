import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
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
      const response = await firstValueFrom(
        this.httpService.post<RawQuizGenerateResponse>(
          `${this.baseUrl}/quiz/generate`,
          body,
          { timeout: QuizGenerationClient.GENERATE_TIMEOUT_MS },
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
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`퀴즈 생성 실패: ${message}`);
      throw new QuizError(
        QuizErrorCode.LLM_GENERATION_FAILED,
        `퀴즈 생성 서비스 호출에 실패했습니다: ${message}`,
      );
    }
  }
}
