import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import { PracticeService, type PracticeSummary } from './practice.service';
import { SubmitPracticeResultsDto } from './dto/submit-practice-results.dto';

interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 연습 모드 API.
 *
 * 검사(`/quiz/qab-results`)와 경로를 나눈 것은 표기 이상의 의미가 있다. 두
 * 경로가 서로 다른 테이블에만 쓰므로, 연습 코드가 실수로 검사 지표를 건드릴
 * 방법이 없다.
 */
@Controller('practice')
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

  @Post('results')
  @HttpCode(HttpStatus.OK)
  async submitResults(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitPracticeResultsDto,
  ): Promise<{ saved: number }> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    return await this.practiceService.saveResults(effectivePatientId, dto);
  }

  /**
   * GET /practice/summary?days=7
   * 보호자용 연습 요약 — 양과 첫 시도 정답률. 검사 지표와 합치지 않는다
   * (PracticeService.getSummary 주석 참고).
   */
  @Get('summary')
  async getSummary(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
  ): Promise<PracticeSummary> {
    const effectivePatientId = resolveEffectivePatientId(req.user);
    const parsed = Number(days);
    const safeDays =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 90 ? parsed : 7;
    return await this.practiceService.getSummary(effectivePatientId, safeDays);
  }
}
