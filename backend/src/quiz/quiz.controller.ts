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
import { OnboardingGuard } from '../auth/onboarding.guard';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import { PracticeService } from '../practice/practice.service';
import { DailyCap, DailyCapGuard } from '../usage/daily-cap.guard';
import { GlobalCap, GlobalCapGuard } from '../usage/global-cap.guard';
import { TrackView } from '../events/track-view.decorator';
import { QAB_SUBTESTS, type QabSubtest } from './constants/qab-subtest';
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
  SessionStatsResult,
  SkillLevelsResult,
  SubmitAttemptsResult,
  QuizService,
  RecentItemResult,
  WeekReviewItemResult,
} from './quiz.service';
import type { WishConversionResult } from './interfaces/IWishConversionClient';

/** 쿼리로 들어온 문자열이 유효한 검사 종류인지 좁힌다. */
function isQabSubtest(value: unknown): value is QabSubtest {
  return (
    typeof value === 'string' &&
    (QAB_SUBTESTS as readonly string[]).includes(value)
  );
}

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
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class QuizController {
  constructor(
    private readonly quizService: QuizService,
    private readonly practiceService: PracticeService,
  ) {}

  /**
   * POST /quiz/generate/:memoryEntryId
   * 보호자의 수동 퀴즈 생성/재생성 트리거 (R1=(c)).
   */
  @Post('quiz/generate/:memoryEntryId')
  @UseGuards(DailyCapGuard, GlobalCapGuard)
  @DailyCap('quiz')
  @GlobalCap('quiz')
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
  @TrackView('qab_trend_viewed')
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
  @TrackView('qab_summary_viewed')
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
   * GET /quiz/skill-levels
   * 환자 스킬별 현재 난이도 레벨(1~5, 콜드스타트 2 채움) + 매니페스트 버전.
   * 프론트가 문항 선택 난이도를 정하는 데 쓴다. 레벨은 환자에게 노출하지 않는다.
   */
  @Get('quiz/skill-levels')
  async getSkillLevels(
    @Req() req: AuthenticatedRequest,
  ): Promise<SkillLevelsResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    try {
      return await this.quizService.getSkillLevels(effectivePatientId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/activity-days
   * 환자가 검사 또는 연습을 한 날짜(최근 N일, YYYY-MM-DD) — 솔로 홈 스트릭용.
   *
   * **두 출처를 여기서 합치는 이유.**
   *
   * QuizService에 PracticeService를 주입하면 한 줄로 끝난다. 그렇게 하지 않는다.
   * QuizService는 레벨을 재계산하고(`recomputeSkillLevel`) 보호자 추세를
   * 집계하는 클래스다. 거기에 연습 데이터로 가는 통로가 한 번 뚫리면, 나중에
   * 누군가 "이왕 있으니" 정답률에도 섞는 것을 막을 방법이 없다 — 그리고 그건
   * 조용히 틀린다. 연습을 별도 테이블로 낸 이유가 정확히 그것이다.
   *
   * 라우트에서 합치면 QuizService는 연습을 **볼 수 없는 채로** 남는다. 합치는
   * 것이 "했다/안 했다" 하나뿐이라는 사실도 이 자리에서 한눈에 보인다.
   *
   * 참여 기록은 측정이 아니다. 어르신이 하루 세 번 연습했는데 캘린더가 비어
   * 있으면 보호자에게는 "오늘 아무것도 안 했네"로 읽힌다(TODO-111).
   */
  @Get('quiz/activity-days')
  async getActivityDays(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
  ): Promise<{ days: string[] }> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    const parsed = Number(days);
    const safeDays =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 60 ? parsed : 14;
    try {
      const [quizDays, practiceDays] = await Promise.all([
        this.quizService.getActivityDays(effectivePatientId, safeDays),
        this.practiceService.getActivityDays(effectivePatientId, safeDays),
      ]);
      // 양쪽 다 날짜 문자열(YYYY-MM-DD)이라 사전순 내림차순 = 최신순이다.
      const merged = [...new Set([...quizDays, ...practiceDays])].sort((a, b) =>
        b.localeCompare(a),
      );
      return { days: merged };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/week-review
   * 최근 N일 동안 환자가 **실제로 푼** 기억들 — 환자용 돌아보기 화면.
   *
   * **점수를 안 내려보낸다.** 환자 화면은 정답률을 보여주지 않는 것이 이 앱의
   * 원칙이고, 돌아보기의 목적은 평가가 아니라 회상이다. API가 아예 안 주면
   * 나중에 화면에서 "이왕 있으니" 붙는 일이 생기지 않는다.
   */
  @Get('quiz/week-review')
  async getWeekReview(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
  ): Promise<{ items: WeekReviewItemResult[] }> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    const parsed = Number(days);
    const safeDays =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 7;
    try {
      const items = await this.quizService.getWeekReview(
        effectivePatientId,
        safeDays,
      );
      return { items };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/session-stats
   * 최근 N일 세션 완료율(보호자용) — 시작한 세션 중 끝까지 마친 비율.
   */
  @Get('quiz/session-stats')
  @TrackView('session_stats_viewed')
  async getSessionStats(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
  ): Promise<SessionStatsResult> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    const parsed = Number(days);
    const safeDays =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 180 ? parsed : 30;
    try {
      return await this.quizService.getSessionStats(
        effectivePatientId,
        safeDays,
      );
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * GET /quiz/recent-items?subtest=spell
   * 최근 N일 문항별 성적 (문항 재출제용). 정렬이 곧 계약이다 — (틀린 것 먼저,
   * 그 안에서 마지막 출제가 오래된 것 먼저). 프론트는 이 순서를 **재정렬 없이**
   * 우선순위로 쓰므로, 그 순서 자체가 간격 반복이 된다.
   */
  @Get('quiz/recent-items')
  async getRecentItems(
    @Req() req: AuthenticatedRequest,
    @Query('subtest') subtest?: string,
    @Query('days') days?: string,
  ): Promise<{ items: RecentItemResult[] }> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    if (!isQabSubtest(subtest)) {
      throw new UnprocessableEntityException('알 수 없는 검사 종류입니다.');
    }
    const parsed = Number(days);
    const safeDays =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 180 ? parsed : 30;
    try {
      const items = await this.quizService.getRecentItems(
        effectivePatientId,
        subtest,
        safeDays,
      );
      return { items };
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
