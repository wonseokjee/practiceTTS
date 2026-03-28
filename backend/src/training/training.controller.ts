import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { User } from '../auth/entities/user.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import type { MessageResponseDto } from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { SessionResponseDto } from './dto/session-response.dto';
import type { AvailableEntryDto } from './interfaces/ITrainingService';
import { TrainingService } from './training.service';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/** 세션 완료 요청 DTO */
class CompleteSessionDto {
  @IsBoolean()
  success: boolean;
}

/**
 * 훈련 세션 컨트롤러
 * - 모든 엔드포인트에 JwtAuthGuard 적용
 * - 비즈니스 로직 없음 (TrainingService 위임)
 * - 환자는 자신의 세션만 접근 가능 (서비스 레이어에서 소유권 검증)
 */
@Controller('training')
@UseGuards(JwtAuthGuard)
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  /**
   * GET /training/entries
   * 환자 대시보드: 훈련 가능한 메모리 엔트리 목록 조회
   * - 로그인한 환자의 ID로 연결된 엔트리 반환
   */
  @Get('entries')
  async getAvailableEntries(
    @Req() req: AuthenticatedRequest,
  ): Promise<AvailableEntryDto[]> {
    return this.trainingService.findAvailableEntries(req.user.id);
  }

  /**
   * POST /training/sessions
   * 훈련 세션 생성 (AI 오프닝 질문 포함)
   */
  @Post('sessions')
  async createSession(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionResponseDto> {
    return this.trainingService.createSession(req.user.id, dto);
  }

  /**
   * GET /training/sessions/:id
   * 세션 단건 조회 (소유권 검증 포함)
   */
  @Get('sessions/:id')
  async getSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionResponseDto> {
    return this.trainingService.getSession(id, req.user.id);
  }

  /**
   * POST /training/sessions/:id/message
   * 환자 발화 전송 → FastAPI /chat 프록시 → AI 응답 반환
   */
  @Post('sessions/:id/message')
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    return this.trainingService.sendMessage(id, req.user.id, dto);
  }

  /**
   * POST /training/sessions/:id/hint
   * 힌트 레벨 1 증가 (최대 2)
   */
  @Post('sessions/:id/hint')
  async incrementHint(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ hintLevel: number }> {
    return this.trainingService.incrementHint(id, req.user.id);
  }

  /**
   * PATCH /training/sessions/:id/complete
   * 세션 완료 처리 (success 기록, duration_ms 자동 계산)
   */
  @Patch('sessions/:id/complete')
  async completeSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSessionDto,
  ): Promise<SessionResponseDto> {
    return this.trainingService.completeSession(id, req.user.id, dto.success);
  }
}
