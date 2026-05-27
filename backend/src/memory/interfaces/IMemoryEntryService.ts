import type { CreateMemoryEntryDto } from '../dto/create-memory-entry.dto';
import type { MemoryEntryResponseDto } from '../dto/memory-entry-response.dto';
import type { TriggerScenarioResponseDto } from '../dto/trigger-scenario-response.dto';
import type { UpdateMemoryEntryDto } from '../dto/update-memory-entry.dto';

/** 소유권 검증에 필요한 보호자 정보 */
export interface CaregiverInfo {
  patientId: string | null;
}

/**
 * 메모리 엔트리 서비스 인터페이스
 * 테스트 시 MockMemoryEntryService로 교체 가능
 */
export interface IMemoryEntryService {
  create(
    caregiverId: string,
    dto: CreateMemoryEntryDto,
    photo: Express.Multer.File | undefined,
    caregiver: CaregiverInfo,
  ): Promise<MemoryEntryResponseDto>;

  findAll(caregiverId: string): Promise<MemoryEntryResponseDto[]>;

  findOne(id: string, caregiverId: string): Promise<MemoryEntryResponseDto>;

  update(
    id: string,
    caregiverId: string,
    dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryResponseDto>;

  triggerScenario(
    id: string,
    caregiverId: string,
  ): Promise<TriggerScenarioResponseDto>;
}
