import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import {
  MemoryEntryResponseDto,
  toMemoryEntryResponseDto,
} from './dto/memory-entry-response.dto';
import { TriggerScenarioResponseDto } from './dto/trigger-scenario-response.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { CaregiverReflection } from './entities/caregiver-reflection.entity';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MoodEntry } from './entities/mood-entry.entity';
import { PatientMemoryNote } from './entities/patient-memory-note.entity';
import {
  MemoryEntryError,
  MemoryEntryErrorCode,
} from './errors/memory-entry.errors';
import type {
  CaregiverInfo,
  IMemoryEntryService,
} from './interfaces/IMemoryEntryService';
import { CryptoService } from './services/crypto.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';

@Injectable()
export class MemoryEntryService implements IMemoryEntryService {
  constructor(
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    @InjectRepository(PatientMemoryNote)
    private readonly patientMemoryNoteRepository: Repository<PatientMemoryNote>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fastApiClient: FastApiClientService,
    private readonly cryptoService: CryptoService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * UC-1: 3-step 라이프로그 등록
   *
   * 흐름:
   *  (1) 보호자-환자 소유권 검증
   *  (2) R2=(b) 재해석: `patientAnswers >= 1 OR photo` 검증 (P1-N5=(b))
   *  (3) 단일 트랜잭션 내: MemoryEntry → MoodEntry → (옵션)CaregiverReflection → PatientMemoryNote[]
   *  (4) 트랜잭션 실패 시 사진 파일 cleanup (P1-N6=(a))
   *  (5) (사진 있을 때만) FastAPI tag/mask 호출 — best-effort, 트랜잭션 외부
   *
   * 응답은 **Public DTO** (mood/caregiverReflection 부재).
   */
  async create(
    caregiverId: string,
    dto: CreateMemoryEntryDto,
    photo: Express.Multer.File | undefined,
    caregiver: { patientId: string | null },
  ): Promise<MemoryEntryResponseDto> {
    // (1) 소유권 검증
    if (caregiver.patientId !== dto.patientId) {
      throw new ForbiddenException('해당 환자에 대한 접근 권한이 없습니다.');
    }

    // (2) R2=(b) 재해석: patientAnswers 1개 이상 또는 photo 첨부 중 최소 하나
    if (dto.patientAnswers.length === 0 && !photo) {
      throw new BadRequestException(
        'patientAnswers 1개 이상 또는 photo 첨부 중 최소 1개는 필수입니다.',
      );
    }

    const photoUrl = photo
      ? this.fileStorageService.getPublicUrl(photo.filename)
      : null;

    // (3) 단일 트랜잭션 내 5종 row 저장
    let savedEntry: MemoryEntry;
    let savedNotes: PatientMemoryNote[];
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const entry = await this.saveMemoryEntryInTransaction(
          manager,
          caregiverId,
          dto,
          photoUrl,
        );
        await this.saveMoodEntryInTransaction(
          manager,
          entry.id,
          caregiverId,
          dto.mood.level,
        );
        if (dto.caregiverAnswer) {
          await this.saveCaregiverReflectionInTransaction(
            manager,
            entry.id,
            caregiverId,
            dto.caregiverAnswer.questionId,
            dto.caregiverAnswer.answerText,
          );
        }
        const notes = await this.savePatientMemoryNotesInTransaction(
          manager,
          entry.id,
          dto.patientAnswers,
        );
        return { entry, notes };
      });
      savedEntry = result.entry;
      savedNotes = result.notes;
    } catch (error) {
      // (4) 트랜잭션 실패 시 사진 cleanup (P1-N6=(a))
      if (photo) {
        await this.tryDeleteOrphanPhoto(photo.filename);
      }
      throw error;
    }

    // (5) FastAPI tag/mask — best-effort, 트랜잭션 외부
    if (photoUrl) {
      const { locationTag, objectTags, maskedContext } =
        await this.runTagAndMaskBestEffort(photoUrl);

      // 결과를 별도 update로 반영 (실패해도 부분 성공 허용)
      if (
        locationTag !== null ||
        objectTags !== null ||
        maskedContext !== null
      ) {
        await this.memoryEntryRepository.update(savedEntry.id, {
          locationTag: locationTag ?? undefined,
          objectTags: objectTags ?? undefined,
          maskedContext: maskedContext ?? undefined,
        });
        const updated = await this.memoryEntryRepository.findOne({
          where: { id: savedEntry.id },
        });
        if (updated) {
          savedEntry = updated;
        }
      }
    }

    return toMemoryEntryResponseDto(savedEntry, savedNotes);
  }

  /**
   * UC-2: 보호자 메모리 엔트리 목록 조회 (isActive=true, 최신순)
   * - Phase 1: patientNotes는 함께 조회 (목록 컨텍스트 카드 노출용)
   */
  async findAll(caregiverId: string): Promise<MemoryEntryResponseDto[]> {
    const entries = await this.memoryEntryRepository.find({
      where: { caregiverId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (entries.length === 0) {
      return [];
    }
    const entryIds = entries.map((e) => e.id);
    const notes = await this.patientMemoryNoteRepository
      .createQueryBuilder('note')
      .where('note.memory_entry_id IN (:...ids)', { ids: entryIds })
      .orderBy('note.order_index', 'ASC')
      .getMany();
    const notesByEntry = this.groupNotesByEntry(notes);
    return entries.map((e) =>
      toMemoryEntryResponseDto(e, notesByEntry.get(e.id) ?? []),
    );
  }

  /**
   * UC-3: 메모리 엔트리 단건 조회 (소유권 검증 + patientNotes 포함)
   */
  async findOne(
    id: string,
    caregiverId: string,
  ): Promise<MemoryEntryResponseDto> {
    const entry = await this.findAndVerifyOwnership(id, caregiverId);
    const notes = await this.patientMemoryNoteRepository.find({
      where: { memoryEntryId: entry.id },
      order: { orderIndex: 'ASC' },
    });
    return toMemoryEntryResponseDto(entry, notes);
  }

  /**
   * UC-4: 메모리 엔트리 수정 (emotionTag, targetWords만 — deprecated 호환)
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
    const notes = await this.patientMemoryNoteRepository.find({
      where: { memoryEntryId: id },
      order: { orderIndex: 'ASC' },
    });
    return toMemoryEntryResponseDto(updated, notes);
  }

  /**
   * UC-5: 시나리오 생성 트리거 (기존 동작 유지)
   */
  async triggerScenario(
    id: string,
    caregiverId: string,
  ): Promise<TriggerScenarioResponseDto> {
    const entry = await this.findAndVerifyOwnership(id, caregiverId);

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
      throw new BadGatewayException('AI 서비스 호출에 실패했습니다.');
    }

    const encryptedScenario = this.cryptoService.encrypt(
      JSON.stringify(scenarioData),
    );
    await this.memoryEntryRepository.update(id, {
      scenarioCache: encryptedScenario,
    });

    return { status: 'triggered', memoryEntryId: id };
  }

  async softDelete(id: string, caregiverId: string): Promise<void> {
    await this.findAndVerifyOwnership(id, caregiverId);
    await this.memoryEntryRepository.update(id, { isActive: false });
  }

  // ─── 트랜잭션 내부 저장 헬퍼 ─────────────────────────────────────────

  private async saveMemoryEntryInTransaction(
    manager: EntityManager,
    caregiverId: string,
    dto: CreateMemoryEntryDto,
    photoUrl: string | null,
  ): Promise<MemoryEntry> {
    const repo = manager.getRepository(MemoryEntry);
    const entity = repo.create({
      caregiverId,
      patientId: dto.patientId,
      photoUrl: photoUrl ?? undefined,
      caregiverWishMessage: dto.caregiverWishMessage ?? null,
      emotionTag: dto.emotionTag,
      targetWords: dto.targetWords ?? [],
    });
    return repo.save(entity);
  }

  private async saveMoodEntryInTransaction(
    manager: EntityManager,
    memoryEntryId: string,
    caregiverId: string,
    level: number,
  ): Promise<MoodEntry> {
    const repo = manager.getRepository(MoodEntry);
    return repo.save(
      repo.create({
        memoryEntryId,
        caregiverId,
        moodLevel: level,
      }),
    );
  }

  private async saveCaregiverReflectionInTransaction(
    manager: EntityManager,
    memoryEntryId: string,
    caregiverId: string,
    questionId: string,
    answerText: string,
  ): Promise<CaregiverReflection> {
    const repo = manager.getRepository(CaregiverReflection);
    return repo.save(
      repo.create({
        memoryEntryId,
        caregiverId,
        questionId,
        answerText,
        // 보호자 사적 답변은 항상 isPrivate=true로 강제 (외부 입력 무시)
        isPrivate: true,
      }),
    );
  }

  private async savePatientMemoryNotesInTransaction(
    manager: EntityManager,
    memoryEntryId: string,
    answers: ReadonlyArray<{
      questionId: string;
      category: 'activity' | 'moment' | 'context';
      answerText: string;
    }>,
  ): Promise<PatientMemoryNote[]> {
    if (answers.length === 0) {
      return [];
    }
    const repo = manager.getRepository(PatientMemoryNote);
    const entities = answers.map((ans, idx) =>
      repo.create({
        memoryEntryId,
        questionId: ans.questionId,
        category: ans.category,
        orderIndex: idx,
        answerText: ans.answerText,
      }),
    );
    return repo.save(entities);
  }

  // ─── 보조 헬퍼 ─────────────────────────────────────────────────────

  /**
   * 트랜잭션 롤백 시 디스크에 남은 사진 파일 cleanup (P1-N6=(a))
   * - 실패해도 원본 예외 전파를 막지 않는다 (best-effort)
   */
  private async tryDeleteOrphanPhoto(filename: string): Promise<void> {
    try {
      // FileStorageService에 delete 메서드가 없을 수 있어 동적 호출
      const storage = this.fileStorageService as unknown as {
        delete?: (name: string) => Promise<void> | void;
      };
      if (typeof storage.delete === 'function') {
        await storage.delete(filename);
      }
      // delete 메서드가 없으면 cleanup 무시 (로그 출력은 운영 환경 도입 시점에 결정)
    } catch {
      // cleanup 실패는 원본 예외를 가리지 않기 위해 무시
    }
  }

  /**
   * FastAPI tag/mask 호출 — 부분 성공 허용
   */
  private async runTagAndMaskBestEffort(photoUrl: string): Promise<{
    locationTag: string | null;
    objectTags: string[] | null;
    maskedContext: string | null;
  }> {
    let locationTag: string | null = null;
    let objectTags: string[] | null = null;
    let maskedContext: string | null = null;

    try {
      const tagResult = await this.fastApiClient.tag(photoUrl);
      if (tagResult) {
        locationTag = tagResult.locationTag;
        objectTags = tagResult.objectTags;
      }
    } catch {
      // 태그 실패는 부분 성공 허용
    }

    if (locationTag !== null && objectTags !== null) {
      const context = this.buildContext(locationTag, objectTags);
      try {
        const maskResponse = await this.fastApiClient.mask(context);
        maskedContext = this.cryptoService.encrypt(maskResponse.maskedText);
      } catch {
        // 마스킹 실패는 부분 성공 허용
      }
    }

    return { locationTag, objectTags, maskedContext };
  }

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
      throw new ForbiddenException(
        '해당 메모리 엔트리에 대한 접근 권한이 없습니다.',
      );
    }

    return entry;
  }

  private buildContext(locationTag: string, objectTags: string[]): string {
    const objectPart =
      objectTags.length > 0 ? `사물: ${objectTags.join(', ')}` : '';
    return [`장소: ${locationTag}`, objectPart].filter(Boolean).join(', ');
  }

  private groupNotesByEntry(
    notes: PatientMemoryNote[],
  ): Map<string, PatientMemoryNote[]> {
    const map = new Map<string, PatientMemoryNote[]>();
    for (const n of notes) {
      const bucket = map.get(n.memoryEntryId) ?? [];
      bucket.push(n);
      map.set(n.memoryEntryId, bucket);
    }
    return map;
  }
}

// CaregiverInfo 타입 re-export (기존 호환)
export type { CaregiverInfo };

// MemoryEntryErrorCode는 외부에서 import 시 trace 보존을 위해 re-export 보존
export { MemoryEntryErrorCode };
