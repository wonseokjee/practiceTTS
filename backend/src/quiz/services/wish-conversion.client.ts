import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { QuizError, QuizErrorCode } from '../errors/quiz.errors';
import type {
  IWishConversionClient,
  WishConversionResult,
} from '../interfaces/IWishConversionClient';
import { aiServiceHeaders } from '../../common/ai-service-auth';

/** FastAPI `/wish/to-practice` 응답 원시 타입 (snake_case) */
interface RawWishResponse {
  echo_sentence: string;
  fill_blank: {
    prompt: string;
    answer: string;
    hint_first_char: string;
  };
  model: string;
  fallback_used: boolean;
}

/**
 * 한마디→발화연습 변환 클라이언트 (FastAPI `/wish/to-practice` 어댑터).
 *
 * QuizGenerationClient와 동일한 에러 매핑 정책을 따른다:
 *  - 422 → LLM_INVALID_NOTES(영구, 금칙어/부적합 한마디)
 *  - 503 → LLM_GENERATION_FAILED(미구성) / 그 외 → 일시 실패
 */
@Injectable()
export class WishConversionClient implements IWishConversionClient {
  private readonly logger = new Logger(WishConversionClient.name);
  private readonly baseUrl: string;

  /** 변환 타임아웃: 20초 */
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'FASTAPI_URL',
      'http://localhost:8000',
    );
  }

  async convert(wishMessage: string): Promise<WishConversionResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<RawWishResponse>(
          `${this.baseUrl}/wish/to-practice`,
          { wish_message: wishMessage },
          {
            timeout: WishConversionClient.TIMEOUT_MS,
            headers: aiServiceHeaders(this.configService),
          },
        ),
      );
      const data = response.data;
      this.logger.log(
        `한마디 변환 완료 (model=${data.model}, fallback=${data.fallback_used})`,
      );
      return {
        echoSentence: data.echo_sentence,
        fillBlank: {
          prompt: data.fill_blank.prompt,
          answer: data.fill_blank.answer,
          hintFirstChar: data.fill_blank.hint_first_char,
        },
        model: data.model,
        fallbackUsed: data.fallback_used,
      };
    } catch (error) {
      const status = this.extractHttpStatus(error);
      const rawMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      if (status === 422) {
        this.logger.warn(`한마디 변환 거부(422): ${rawMessage}`);
        throw new QuizError(
          QuizErrorCode.LLM_INVALID_NOTES,
          '이 한마디로는 연습 문장을 만들 수 없어요.',
        );
      }
      this.logger.error(`한마디 변환 실패: ${rawMessage}`);
      throw new QuizError(
        QuizErrorCode.LLM_GENERATION_FAILED,
        '연습 문장 생성 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      );
    }
  }

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
