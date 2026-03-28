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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { User } from '../auth/entities/user.entity';
import { MAX_PHOTO_SIZE_BYTES } from './constants/memory-entry.constants';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import type { MemoryEntryResponseDto } from './dto/memory-entry-response.dto';
import type { TriggerScenarioResponseDto } from './dto/trigger-scenario-response.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { MemoryEntryService } from './memory.service';
import { FileStorageService } from './services/file-storage.service';

/** JWT 인증 후 req.user에 주입되는 사용자 타입 */
interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * 메모리 엔트리 컨트롤러
 * - 모든 엔드포인트에 JwtAuthGuard 적용
 * - 비즈니스 로직 없음 (MemoryEntryService 위임)
 */
@Controller('memory-entries')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(
    private readonly memoryEntryService: MemoryEntryService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * POST /memory-entries
   * 메모리 엔트리 생성 (사진 + emotionTag + targetWords)
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          // FileStorageService의 uploadDir을 직접 참조할 수 없으므로
          // 환경변수 기본값과 동일한 경로 사용
          const uploadDir =
            process.env['UPLOAD_DIR'] ?? 'tts-cache/memory-images';
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          // UUID 랜덤 파일명으로 저장 (예측 불가능한 URL 보안 확보)
          const uniqueName = `${uuidv4()}${extname(file.originalname).toLowerCase()}`;
          cb(null, uniqueName);
        },
      }),
    }),
  )
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMemoryEntryDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_SIZE_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
        errorHttpStatusCode: 400,
      }),
    )
    photo: Express.Multer.File,
  ): Promise<MemoryEntryResponseDto> {
    return this.memoryEntryService.create(req.user.id, dto, photo, {
      patientId: req.user.patientId,
    });
  }

  /**
   * GET /memory-entries
   * 보호자 본인이 등록한 메모리 엔트리 목록 조회 (최신순)
   */
  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
  ): Promise<MemoryEntryResponseDto[]> {
    return this.memoryEntryService.findAll(req.user.id);
  }

  /**
   * GET /memory-entries/:id
   * 메모리 엔트리 단건 조회 (소유권 검증 포함)
   */
  @Get(':id')
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemoryEntryResponseDto> {
    return this.memoryEntryService.findOne(id, req.user.id);
  }

  /**
   * PATCH /memory-entries/:id
   * emotionTag, targetWords 수정 (사진 수정 불가)
   */
  @Patch(':id')
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
  @Post(':id/scenario')
  async triggerScenario(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TriggerScenarioResponseDto> {
    return this.memoryEntryService.triggerScenario(id, req.user.id);
  }

  /**
   * DELETE /memory-entries/:id
   * 소프트 삭제 (isActive=false 설정)
   */
  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.memoryEntryService.softDelete(id, req.user.id);
  }
}
