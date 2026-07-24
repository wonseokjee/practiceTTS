import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import { GenerateQuizDto } from './dto/generate-quiz.dto';
import { QuizSetSummaryDto } from './dto/quiz-set-summary.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitQabResultsDto } from './dto/submit-qab-results.dto';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import {
  BestScoreResult,
  QabSummaryResult,
  QabTrendResult,
  QuizSetDetail,
  RequestGenerationResult,
  SaveQabResultsResult,
  SubmitAttemptsResult,
  QuizService,
} from './quiz.service';
import type { WishConversionResult } from './interfaces/IWishConversionClient';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 퀴즈 컨트롤러
 * - 모든 엔드포인트에 JwtAuthGuard 적용.
 * - 비즈니스 로직 없음 (QuizService 위임). QuizError → HttpException 매핑만 담당.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  /**
   * POST /quiz/generate/:memoryEntryId
   * 보호자의 수동 퀴즈 생성/재생성 트리거 (R1=(c)).
   */
  @Post('quiz/generate/:memoryEntryId')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @Req() req: AuthenticatedRequest,
    @Param('memoryEntryId', ParseUUIDPipe) memoryEntryId: string,
    @Body() dto: GenerateQuizDto,
  ): Promise<RequestGenerationResult> {
    try {
      return await this.quizService.requestGeneration(
        memoryEntryId,
        req.user.id,
        dto.force ?? false,
      );
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/sets
   * 풀 수 있는 QuizSet 목록 (유효 환자 ID 기준).
   */
  @Get('quiz/sets')
  async listSets(
    @Req() req: AuthenticatedRequest,
    @Query('memoryEntryId') memoryEntryId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: QuizSetSummaryDto[]; nextCursor: null }> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      const items = await this.quizService.listSets(effectivePatientId, {
        memoryEntryId,
        status,
        limit: limit ? Number(limit) : undefined,
      });
      return { items, nextCursor: null };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/sets/:id
   * 풀이용 5문제 조회 (정답 은닉).
   */
  @Get('quiz/sets/:id')
  async getSetDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuizSetDetail> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.getSetDetail(id, effectivePatientId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * POST /quiz/sets/:id/attempts
   * 답안 제출 + 즉시 채점.
   */
  @Post('quiz/sets/:id/attempts')
  async submitAttempts(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptsResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.submitAttempts(id, effectivePatientId, dto);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/sets/:id/best-score
   * 최고 점수 조회.
   */
  @Get('quiz/sets/:id/best-score')
  async getBestScore(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BestScoreResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.getBestScore(id, effectivePatientId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * POST /quiz/qab-results
   * QAB 질문형 검사 결과 일괄 저장 (세션 완료 시 1회). 환자/보호자 모두 호출 가능.
   */
  @Post('quiz/qab-results')
  @HttpCode(HttpStatus.CREATED)
  async submitQabResults(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitQabResultsDto,
  ): Promise<SaveQabResultsResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.saveQabResults(effectivePatientId, dto);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/qab-trend
   * 검사별 주차 추이. 보호자가 회복 방향(나아지는지)을 본다.
   */
  @Get('quiz/qab-trend')
  async getQabTrend(
    @Req() req: AuthenticatedRequest,
    @Query('weeks') weeks?: string,
  ): Promise<QabTrendResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    // 진료 리포트는 12주(약 3개월)를 보고 싶어 한다. 대시보드 카드는 8주면
    // 충분하다. 범위를 벗어난 값은 기본값으로 떨어뜨린다 — 사용자 입력으로
    // 무제한 기간을 스캔하게 두지 않는다.
    const parsed = Number(weeks);
    const safeWeeks =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 52 ? parsed : 8;
    try {
      return await this.quizService.getQabTrend(effectivePatientId, safeWeeks);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/qab-summary
   * QAB 검사별 회복 추적 요약 (보호자 가시성). 유효 환자 ID 기준 집계.
   */
  @Get('quiz/qab-summary')
  async getQabSummary(
    @Req() req: AuthenticatedRequest,
  ): Promise<QabSummaryResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.getQabSummary(effectivePatientId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * POST /quiz/sets/:id/wish-practice
   * 보호자 한마디 → 환자 발화 연습(따라말하기 + 빈칸) 변환 (Pattern 1, on-demand).
   */
  @Post('quiz/sets/:id/wish-practice')
  @HttpCode(HttpStatus.OK)
  async getWishPractice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WishConversionResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.getWishPractice(id, effectivePatientId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * QuizError → NestJS HttpException 매핑.
   * - QuizError가 아니면 원본 예외를 그대로 전파한다.
   */
  private mapError(error: unknown): unknown {
    if (!(error instanceof QuizError)) {
      return error;
    }
    switch (error.code) {
      case QuizErrorCode.MEMORY_ENTRY_NOT_FOUND:
      case QuizErrorCode.QUIZ_SET_NOT_FOUND:
        return new NotFoundException(error.message);
      case QuizErrorCode.NOT_OWNER:
      case QuizErrorCode.FORBIDDEN:
        return new ForbiddenException(error.message);
      case QuizErrorCode.QUIZ_SET_ALREADY_EXISTS:
      case QuizErrorCode.QUIZ_NOT_READY:
        return new ConflictException(error.message);
      case QuizErrorCode.SESSION_EXPIRED:
        return new GoneException(error.message);
      case QuizErrorCode.NO_WISH_MESSAGE:
        return new NotFoundException(error.message);
      case QuizErrorCode.INVALID_ANSWER_FORMAT:
      case QuizErrorCode.NO_PATIENT_NOTES:
      case QuizErrorCode.LLM_INVALID_NOTES:
        return new UnprocessableEntityException(error.message);
      case QuizErrorCode.LLM_GENERATION_FAILED:
      case QuizErrorCode.LLM_TIMEOUT:
      case QuizErrorCode.LLM_UPSTREAM:
        return new BadGatewayException(error.message);
      default:
        return error;
    }
  }
}
