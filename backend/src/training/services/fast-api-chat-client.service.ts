import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { TrainingError, TrainingErrorCode } from '../errors/training.errors';
import type {
  ChatRequest,
  ChatResponse,
  IFastApiChatClient,
} from '../interfaces/IFastApiChatClient';

/** FastAPI /chat 응답 원시 타입 */
interface RawChatResponse {
  session_id: string;
  ai_message: string;
  hint_triggered: boolean;
  hint_level: number;
}

/**
 * FastAPI /chat 엔드포인트 클라이언트 구현체
 * - @nestjs/axios HttpService 사용
 * - 30초 타임아웃 (LLM 응답 지연 대응)
 */
@Injectable()
export class FastApiChatClientService implements IFastApiChatClient {
  private readonly baseUrl: string;

  /** 대화 응답 타임아웃: 30초 */
  private static readonly CHAT_TIMEOUT_MS = 30_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'FASTAPI_URL',
      'http://localhost:8000',
    );
  }

  /**
   * FastAPI /chat 엔드포인트 호출
   * - hint_level은 0 | 1 | 2로 제한
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<RawChatResponse>(
          `${this.baseUrl}/chat`,
          {
            session_id: request.session_id,
            user_message: request.user_message,
            hint_level: request.hint_level,
            memory_entry_id: request.memory_entry_id,
          },
          { timeout: FastApiChatClientService.CHAT_TIMEOUT_MS },
        ),
      );

      return {
        session_id: response.data.session_id,
        ai_message: response.data.ai_message,
        hint_triggered: response.data.hint_triggered,
        hint_level: response.data.hint_level,
      };
    } catch (error) {
      throw new TrainingError(
        TrainingErrorCode.AI_SERVICE_UNAVAILABLE,
        `AI 대화 서비스 호출 실패: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /** 에러 메시지 안전 추출 */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return '알 수 없는 오류';
  }
}
