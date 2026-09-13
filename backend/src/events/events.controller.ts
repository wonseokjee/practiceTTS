import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsService } from './events.service';

interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * POST /events — 프론트가 직접 보내는 이벤트(장래 배처, T10)를 받는다.
 *
 * 서버가 스스로 기록하는 열람 이벤트(`@TrackView`)와 달리, 이 경로는 클라이언트
 * 입력이라 `EventsService.recordRequested`가 등록 안 된 이름·필드를 거부한다.
 */
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateEventDto,
  ): Promise<void> {
    await this.eventsService.recordRequested(
      req.user.id,
      dto.eventName,
      dto.payload,
    );
  }
}
