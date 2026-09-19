import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingGuard } from '../auth/onboarding.guard';
import { DailyCap, DailyCapGuard } from '../usage/daily-cap.guard';
import type { User } from '../auth/entities/user.entity';
import { MAX_PHOTO_SIZE_BYTES } from './constants/memory-entry.constants';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import { DiaryQuestionQueryDto } from './dto/diary-question-query.dto';
import {
  DiaryQuestionResponseDto,
  toDiaryQuestionResponseDto,
} from './dto/diary-question.dto';
import type { MemoryEntryResponseDto } from './dto/memory-entry-response.dto';
import type { TriggerScenarioResponseDto } from './dto/trigger-scenario-response.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { MemoryEntryService } from './memory.service';
import { DiaryQuestionService } from './services/diary-question.service';
import { FileStorageService } from './services/file-storage.service';
import { HealingMessageService } from './services/healing-message.service';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 메모리 엔트리 컨트롤러
 * - 모든 엔드포인트에 JwtAuthGuard 적용
 * - 비즈니스 로직 없음 (MemoryEntryService 위임)
 */
@Controller()
@UseGuards(JwtAuthGuard, OnboardingGuard)
export class MemoryController {
  constructor(
    private readonly memoryEntryService: MemoryEntryService,
    private readonly diaryQuestionService: DiaryQuestionService,
    // 미사용이지만 기존 모듈 와이어링 호환을 위해 주입 유지
    private readonly fileStorageService: FileStorageService,
    private readonly healingMessageService: HealingMessageService,
  ) {}

  /**
   * POST /memory-entries
   * 3-step 라이프로그 생성 (사진 optional, photo 또는 patientAnswers>=1 필요)
   */
  @Post('memory-entries')
  // 가드라 multer보다 먼저 돈다 — 상한을 넘으면 사진을 받기 전에 거절한다.
  @UseGuards(DailyCapGuard)
  @DailyCap('memory')
  @UseInterceptors(
    FileInterceptor('photo', {
      // 버퍼로만 받는다 — 실제 영속화(로컬 디스크 또는 R2)는
      // MemoryEntryService가 FileStorageService.save()로 명시적으로 한다.
      // (PHOTO_STORAGE_DRIVER에 따라 저장 위치가 갈리므로, multer 단계에서
      // 디스크에 직접 쓰면 R2 드라이버일 때 업로드가 두 곳에 남는다.)
      storage: memoryStorage(),
    }),
  )
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMemoryEntryDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_SIZE_BYTES }),
          // NestJS v11 FileTypeValidator는 기본으로 file.buffer의 매직넘버를 검사한다.
          // 매직넘버 검사는 건너뛰고 mimetype 문자열로만 검증한다(기존 동작 유지).
          new FileTypeValidator({
            fileType: /^image\/(jpeg|png|webp)$/,
            skipMagicNumbersValidation: true,
          }),
        ],
        errorHttpStatusCode: 400,
        // photo는 선택 — 없는 경우 ParseFilePipe가 통과시키도록 fileIsRequired=false
        fileIsRequired: false,
      }),
    )
    photo: Express.Multer.File | undefined,
  ): Promise<MemoryEntryResponseDto> {
    return this.memoryEntryService.create(req.user.id, dto, photo, {
      patientId: req.user.patientId,
    });
  }

  /**
   * GET /memory-entries
   * 보호자 본인이 등록한 메모리 엔트리 목록 (최신순, isActive=true만)
   */
  @Get('memory-entries')
  async findAll(
    @Req() req: AuthenticatedRequest,
  ): Promise<MemoryEntryResponseDto[]> {
    return this.memoryEntryService.findAll(req.user.id);
  }

  /**
   * GET /memory-entries/:id
   * 메모리 엔트리 단건 조회 (소유권 검증 포함)
   */
  @Get('memory-entries/:id')
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemoryEntryResponseDto> {
    return this.memoryEntryService.findOne(id, req.user.id);
  }

  /**
   * PATCH /memory-entries/:id
   * emotionTag, targetWords 수정 (deprecated 호환, 사진 수정 불가)
   */
  @Patch('memory-entries/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryResponseDto> {
    return this.memoryEntryService.update(id, req.user.id, dto);
  }

  /**
   * POST /memory-entries/:id/scenario
   * 시나리오 생성 트리거 (maskedContext 기반 FastAPI /scenario 호출)
   */
  @Post('memory-entries/:id/scenario')
  @UseGuards(DailyCapGuard)
  @DailyCap('scenario')
  async triggerScenario(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TriggerScenarioResponseDto> {
    return this.memoryEntryService.triggerScenario(id, req.user.id);
  }

  /**
   * DELETE /memory-entries/:id
   * 소프트 삭제 (isActive=false)
   */
  @Delete('memory-entries/:id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.memoryEntryService.softDelete(id, req.user.id);
  }

  /**
   * GET /diary-questions/today
   * 오늘의 질문 1개 (scope/category 기반)
   *  - 클라이언트가 Step2/Step3 진입 시 prefetch
   */
  @Get('diary-questions/today')
  async getTodayQuestion(
    @Query() query: DiaryQuestionQueryDto,
  ): Promise<DiaryQuestionResponseDto> {
    const question = await this.diaryQuestionService.getTodayQuestion(
      query.scope,
      query.category,
    );
    return toDiaryQuestionResponseDto(question);
  }

  /**
   * GET /healing-messages/today
   * 오늘의 치유 메시지 1개 (Pattern 2). 환자·보호자 공통, 날짜 기반 결정적 회전.
   */
  @Get('healing-messages/today')
  async getTodayHealingMessage(): Promise<{ id: string; text: string }> {
    return this.healingMessageService.getTodayMessage();
  }
}
