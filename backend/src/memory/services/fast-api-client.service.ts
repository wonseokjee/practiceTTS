import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { retryTransient } from '../../common/retry.util';
import {
  MemoryEntryError,
  MemoryEntryErrorCode,
} from '../errors/memory-entry.errors';
import type { IFastApiClient } from '../interfaces/IFastApiClient';
import type {
  AiMaskResult,
  AiTagResult,
  ScenarioCacheData,
} from '../types/memory-entry.types';
import { aiServiceHeaders } from '../../common/ai-service-auth';

/** FastAPI /tag 응답 원시 타입 */
interface RawTagResponse {
  location_tag: string;
  object_tags: string[];
}

/** FastAPI /mask 응답 원시 타입 (entity_map 포함하지만 즉시 폐기) */
interface RawMaskResponse {
  masked_text: string;
  entity_map?: unknown; // 수신하더라도 절대 외부로 전달하지 않음
  /**
   * ai-service의 3계층(Gemini 이름 탐지)이 실패했는가.
   *
   * true면 masked_text에 실명이 남아 있을 수 있다. 이걸 무시하고 저장하면
   * 미마스킹 텍스트가 "마스킹 완료"로 DB에 영구 기록되고, 이후 퀴즈·시나리오
   * 생성이 그 텍스트를 다시 외부 LLM으로 보낸다.
   */
  degraded?: boolean;
}

/** FastAPI /scenario 응답 원시 타입 */
interface RawScenarioResponse {
  opening_question: string;
}

/**
 * FastAPI AI 서비스 클라이언트 구현체
 * - @nestjs/axios HttpService 사용
 * - 30초 타임아웃 동기 호출
 * - entity_map은 응답 수신 즉시 폐기, 절대 외부 노출 금지
 */
@Injectable()
export class FastApiClientService implements IFastApiClient {
  private readonly logger = new Logger(FastApiClientService.name);
  private readonly baseUrl: string;

  /** 시나리오 생성 타임아웃: 30초 */
  private static readonly SCENARIO_TIMEOUT_MS = 30_000;

  /** 태깅/마스킹 타임아웃: 15초 */
  private static readonly DEFAULT_TIMEOUT_MS = 15_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Base64 이미지로 AI 자동 태깅 수행
   * - POST {baseUrl}/tag
   */
  async tag(imageBase64: string, memoryEntryId: string): Promise<AiTagResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<RawTagResponse>(
          `${this.baseUrl}/tag`,
          { image_base64: imageBase64, memory_entry_id: memoryEntryId },
          {
            timeout: FastApiClientService.DEFAULT_TIMEOUT_MS,
            headers: aiServiceHeaders(this.configService),
          },
        ),
      );

      return {
        locationTag: response.data.location_tag,
        objectTags: response.data.object_tags,
      };
    } catch (error) {
      throw new MemoryEntryError(
        MemoryEntryErrorCode.AI_SERVICE_UNAVAILABLE,
        `AI 태깅 서비스 호출 실패: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * 컨텍스트 PII 마스킹 수행
   * - POST {baseUrl}/mask
   * - entity_map은 응답에서 수신하더라도 즉시 폐기 (절대 외부 노출 금지)
   */
  async mask(
    rawText: string,
    memoryEntryId: string,
    lang: string,
  ): Promise<AiMaskResult> {
    try {
      // 퀴즈 경로의 마스킹은 fail-closed다(실패 시 생성 중단). 일시적 업스트림
      // 오류로 퀴즈가 통째로 실패하지 않도록 백오프 재시도로 흡수한다.
      const response = await retryTransient(
        () =>
          firstValueFrom(
            this.httpService.post<RawMaskResponse>(
              `${this.baseUrl}/mask`,
              { raw_text: rawText, memory_entry_id: memoryEntryId, lang },
              {
                timeout: FastApiClientService.DEFAULT_TIMEOUT_MS,
                headers: aiServiceHeaders(this.configService),
              },
            ),
          ),
        {},
        (attempt, delayMs) =>
          this.logger.warn(
            `마스킹 일시 실패 — ${delayMs}ms 후 재시도 (${attempt}번째)`,
          ),
      );

      // 열화된 결과는 성공으로 취급하지 않는다. 이 경로는 이미 fail-closed
      // 정책이라(마스킹 실패 시 진행 중단), 부분 마스킹만 예외로 통과시키면
      // 그 정책에 구멍이 난다.
      if (response.data.degraded === true) {
        throw new MemoryEntryError(
          MemoryEntryErrorCode.AI_SERVICE_UNAVAILABLE,
          'AI 마스킹이 부분적으로만 완료되었습니다(외부 이름 탐지 실패). ' +
            '실명이 남아 있을 수 있어 저장하지 않습니다.',
        );
      }

      // entity_map은 여기서 즉시 무시하고 maskedText만 추출
      return {
        maskedText: response.data.masked_text,
      };
    } catch (error) {
      throw new MemoryEntryError(
        MemoryEntryErrorCode.AI_SERVICE_UNAVAILABLE,
        `AI 마스킹 서비스 호출 실패: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * 훈련 시나리오 생성
   * - POST {baseUrl}/scenario
   * - 30초 타임아웃 동기 호출
   */
  async generateScenario(
    maskedContext: string,
    targetWords: string[],
    emotionTag: string,
    memoryEntryId: string,
  ): Promise<ScenarioCacheData> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<RawScenarioResponse>(
          `${this.baseUrl}/scenario`,
          {
            masked_context: maskedContext,
            target_words: targetWords,
            emotion_tag: emotionTag,
            memory_entry_id: memoryEntryId,
          },
          {
            timeout: FastApiClientService.SCENARIO_TIMEOUT_MS,
            headers: aiServiceHeaders(this.configService),
          },
        ),
      );

      return {
        openingQuestion: response.data.opening_question,
      };
    } catch (error) {
      throw new MemoryEntryError(
        MemoryEntryErrorCode.AI_SERVICE_UNAVAILABLE,
        `시나리오 생성 서비스 호출 실패: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /** 에러 메시지 안전 추출 */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return '알 수 없는 오류';
  }
}
