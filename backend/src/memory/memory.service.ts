import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import {
  MemoryEntryResponseDto,
  toMemoryEntryResponseDto,
} from './dto/memory-entry-response.dto';
import { TriggerScenarioResponseDto } from './dto/trigger-scenario-response.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { MemoryEntry } from './entities/memory-entry.entity';
import {
  MemoryEntryError,
  MemoryEntryErrorCode,
} from './errors/memory-entry.errors';
import type { CaregiverInfo, IMemoryEntryService } from './interfaces/IMemoryEntryService';
import { CryptoService } from './services/crypto.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';

@Injectable()
export class MemoryEntryService implements IMemoryEntryService {
  constructor(
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    private readonly fastApiClient: FastApiClientService,
    private readonly cryptoService: CryptoService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * UC-1: 메모리 엔트리 생성
   * - 보호자-환자 소유권 검증
   * - DB 저장 후 AI 태깅/마스킹 (실패 시 부분 성공 허용)
   */
  async create(
    caregiverId: string,
    dto: CreateMemoryEntryDto,
    photo: Express.Multer.File,
    caregiver: { patientId: string | null },
  ): Promise<MemoryEntryResponseDto> {
    // 소유권 검증: 보호자가 연결된 환자의 ID와 dto.patientId가 일치해야 함
    if (caregiver.patientId !== dto.patientId) {
      throw new ForbiddenException('해당 환자에 대한 접근 권한이 없습니다.');
    }

    // 공개 URL 생성 (UUID 파일명으로 저장됨)
    const photoUrl = this.fileStorageService.getPublicUrl(photo.filename);

    // DB 초기 저장
    const entry = this.memoryEntryRepository.create({
      caregiverId,
      patientId: dto.patientId,
      photoUrl,
      emotionTag: dto.emotionTag,
      targetWords: dto.targetWords ?? [],
    });
    const saved = await this.memoryEntryRepository.save(entry);

    // AI 태깅 및 마스킹: 실패 시 부분 성공 허용
    const [tagResult, maskResult] = await Promise.allSettled([
      this.fastApiClient.tag(photoUrl),
      Promise.resolve(null), // 마스킹은 태깅 결과가 필요하므로 아래에서 처리
    ]);

    let locationTag: string | null = null;
    let objectTags: string[] | null = null;

    if (tagResult.status === 'fulfilled' && tagResult.value !== null) {
      locationTag = tagResult.value.locationTag;
      objectTags = tagResult.value.objectTags;
    }

    // 마스킹 처리: 태깅 결과로 컨텍스트 구성 후 호출
    let maskedContext: string | null = null;
    if (locationTag !== null && objectTags !== null) {
      const context = this.buildContext(locationTag, objectTags);
      try {
        const maskResponse = await this.fastApiClient.mask(context);
        maskedContext = this.cryptoService.encrypt(maskResponse.maskedText);
      } catch {
        // FastAPI /mask 호출 실패 시 부분 성공 허용 - maskedContext=null 유지
      }
    }

    // DB 업데이트 (태깅/마스킹 결과 저장)
    await this.memoryEntryRepository.update(saved.id, {
      locationTag: locationTag ?? undefined,
      objectTags: objectTags ?? undefined,
      maskedContext: maskedContext ?? undefined,
    });

    // 최신 상태 조회 후 DTO 반환
    const updated = await this.memoryEntryRepository.findOne({
      where: { id: saved.id },
    });
    if (!updated) {
      throw new NotFoundException('저장된 메모리 엔트리를 찾을 수 없습니다.');
    }
    return toMemoryEntryResponseDto(updated);
  }

  /**
   * UC-2: 보호자 메모리 엔트리 목록 조회
   * - isActive=true인 항목만 반환
   * - 최신순 정렬
   */
  async findAll(caregiverId: string): Promise<MemoryEntryResponseDto[]> {
    const entries = await this.memoryEntryRepository.find({
      where: { caregiverId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    return entries.map(toMemoryEntryResponseDto);
  }

  /**
   * UC-3: 메모리 엔트리 단건 조회
   * - 소유권 검증 포함
   */
  async findOne(id: string, caregiverId: string): Promise<MemoryEntryResponseDto> {
    const entry = await this.findAndVerifyOwnership(id, caregiverId);
    return toMemoryEntryResponseDto(entry);
  }

  /**
   * UC-4: 메모리 엔트리 수정
   * - emotionTag, targetWords만 수정 가능 (사진 수정 불가)
   * - targetWords 변경 시 scenarioCache 무효화
   */
  async update(
    id: string,
    caregiverId: string,
    dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryResponseDto> {
    const entry = await this.findAndVerifyOwnership(id, caregiverId);

    const updateData: Partial<MemoryEntry> = {};

    if (dto.emotionTag !== undefined) {
      updateData.emotionTag = dto.emotionTag;
    }

    if (dto.targetWords !== undefined) {
      updateData.targetWords = dto.targetWords;
      // targetWords 변경 시 시나리오 캐시 무효화
      const targetWordsChanged =
        JSON.stringify(entry.targetWords) !== JSON.stringify(dto.targetWords);
      if (targetWordsChanged) {
        updateData.scenarioCache = null as unknown as string;
      }
    }

    await this.memoryEntryRepository.update(id, updateData);

    const updated = await this.memoryEntryRepository.findOne({
      where: { id },
    });
    if (!updated) {
      throw new NotFoundException('메모리 엔트리를 찾을 수 없습니다.');
    }
    return toMemoryEntryResponseDto(updated);
  }

  /**
   * UC-5: 시나리오 생성 트리거
   * - maskedContext 복호화 후 FastAPI /scenario 호출
   * - 결과를 암호화하여 scenarioCache 저장
   */
  async triggerScenario(
    id: string,
    caregiverId: string,
  ): Promise<TriggerScenarioResponseDto> {
    const entry = await this.findAndVerifyOwnership(id, caregiverId);

    // 사전 조건 검증
    if (!entry.maskedContext) {
      throw new UnprocessableEntityException(
        'AI 태깅/마스킹이 완료되지 않았습니다.',
      );
    }

    if (!entry.targetWords || entry.targetWords.length === 0) {
      throw new UnprocessableEntityException(
        '목표 단어를 1개 이상 등록해야 합니다.',
      );
    }

    // maskedContext 복호화 후 FastAPI /scenario 호출
    let decryptedMaskedContext: string;
    try {
      decryptedMaskedContext = this.cryptoService.decrypt(entry.maskedContext);
    } catch {
      throw new UnprocessableEntityException(
        '마스킹 컨텍스트 복호화에 실패했습니다.',
      );
    }

    let scenarioData;
    try {
      scenarioData = await this.fastApiClient.generateScenario(
        decryptedMaskedContext,
        entry.targetWords,
        0,
      );
    } catch (error) {
      if (error instanceof MemoryEntryError) {
        throw new BadGatewayException(
          'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
        );
      }
      throw new BadGatewayException(
        'AI 서비스 호출에 실패했습니다.',
      );
    }

    // 시나리오 결과 암호화 후 저장
    const encryptedScenario = this.cryptoService.encrypt(
      JSON.stringify(scenarioData),
    );
    await this.memoryEntryRepository.update(id, {
      scenarioCache: encryptedScenario,
    });

    return { status: 'triggered', memoryEntryId: id };
  }

  /**
   * 소프트 삭제 (isActive=false 설정)
   */
  async softDelete(id: string, caregiverId: string): Promise<void> {
    await this.findAndVerifyOwnership(id, caregiverId);
    await this.memoryEntryRepository.update(id, { isActive: false });
  }

  // ─── Private 헬퍼 메서드 ────────────────────────────────────────────────

  /**
   * 엔트리 조회 및 소유권 검증
   * - 미존재 또는 isActive=false: NotFoundException
   * - 소유권 불일치: ForbiddenException
   */
  private async findAndVerifyOwnership(
    id: string,
    caregiverId: string,
  ): Promise<MemoryEntry> {
    const entry = await this.memoryEntryRepository.findOne({
      where: { id, isActive: true },
    });

    if (!entry) {
      throw new NotFoundException(`메모리 엔트리를 찾을 수 없습니다: ${id}`);
    }

    if (entry.caregiverId !== caregiverId) {
      throw new ForbiddenException('해당 메모리 엔트리에 대한 접근 권한이 없습니다.');
    }

    return entry;
  }

  /**
   * locationTag + objectTags를 조합하여 마스킹용 컨텍스트 텍스트 구성
   */
  private buildContext(locationTag: string, objectTags: string[]): string {
    const objectPart =
      objectTags.length > 0 ? `사물: ${objectTags.join(', ')}` : '';
    return [`장소: ${locationTag}`, objectPart].filter(Boolean).join(', ');
  }
}

// CaregiverInfo 타입은 IMemoryEntryService에서 re-export됨
export type { CaregiverInfo };
