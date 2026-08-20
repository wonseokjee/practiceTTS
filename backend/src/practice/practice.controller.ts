import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import { PracticeService } from './practice.service';
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
}
