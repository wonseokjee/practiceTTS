import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { EffectivePatientId } from '../auth/decorators/effective-patient-id.decorator';
import { DailyCap, DailyCapGuard } from '../usage/daily-cap.guard';
import { CreateSessionDto } from './dto/create-session.dto';
import type { MessageResponseDto } from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { SessionResponseDto } from './dto/session-response.dto';
import type { AvailableEntryDto } from './interfaces/ITrainingService';
import { TrainingService } from './training.service';

/** 세션 완료 요청 DTO */
class CompleteSessionDto {
  @IsBoolean()
  success: boolean;
}

/**
 * 훈련 세션 컨트롤러
 * - 모든 엔드포인트에 JwtAuthGuard 적용
 * - 비즈니스 로직 없음 (TrainingService 위임)
 * - 환자 식별: @EffectivePatientId()가 토큰 기준으로 도출
 *   (보호자 단일 계정 모델: caregiver → user.patientId, patient → user.id).
 *   서비스 레이어에서 세션 소유권을 effective patientId로 추가 검증.
 */
@Controller('training')
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  /**
   * GET /training/entries
   * 환자 대시보드: 훈련 가능한 메모리 엔트리 목록 조회
   */
  @Get('entries')
  async getAvailableEntries(
    @EffectivePatientId() patientId: string,
  ): Promise<AvailableEntryDto[]> {
    return this.trainingService.findAvailableEntries(patientId);
  }

  /**
   * POST /training/sessions
   * 훈련 세션 생성 (AI 오프닝 질문 포함)
   */
  @Post('sessions')
  async createSession(
    @EffectivePatientId() patientId: string,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionResponseDto> {
    return this.trainingService.createSession(patientId, dto);
  }

  /**
   * GET /training/sessions/:id
   * 세션 단건 조회 (소유권 검증 포함)
   */
  @Get('sessions/:id')
  async getSession(
    @EffectivePatientId() patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionResponseDto> {
    return this.trainingService.getSession(id, patientId);
  }

  /**
   * POST /training/sessions/:id/message
   * 환자 발화 전송 → FastAPI /chat 프록시 → AI 응답 반환
   */
  @Post('sessions/:id/message')
  // AI를 부르는 건 이 경로뿐이다 — 세션 생성·힌트는 LLM 호출이 없다.
  @UseGuards(DailyCapGuard)
  @DailyCap('conversation')
  async sendMessage(
    @EffectivePatientId() patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    return this.trainingService.sendMessage(id, patientId, dto);
  }

  /**
   * POST /training/sessions/:id/hint
   * 힌트 레벨 1 증가 (최대 2)
   */
  @Post('sessions/:id/hint')
  async incrementHint(
    @EffectivePatientId() patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ hintLevel: number }> {
    return this.trainingService.incrementHint(id, patientId);
  }

  /**
   * PATCH /training/sessions/:id/complete
   * 세션 완료 처리 (success 기록, duration_ms 자동 계산)
   */
  @Patch('sessions/:id/complete')
  async completeSession(
    @EffectivePatientId() patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSessionDto,
  ): Promise<SessionResponseDto> {
    return this.trainingService.completeSession(id, patientId, dto.success);
  }
}
