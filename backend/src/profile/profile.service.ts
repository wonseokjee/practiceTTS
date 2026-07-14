import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../memory/services/crypto.service';
import {
  MAX_FAMILY_MEMBERS,
  type FamilyRelation,
} from './constants/profile.constants';
import { FamilyMemberInputDto } from './dto/family-member-input.dto';
import {
  PatientProfileResponseDto,
  toPatientProfileResponseDto,
} from './dto/patient-profile-response.dto';
import { UpsertPatientProfileDto } from './dto/upsert-patient-profile.dto';
import { FamilyMember } from './entities/family-member.entity';
import { PatientProfile } from './entities/patient-profile.entity';

/** 복호화된 가족 구성원 (내부 페르소나 매핑 생성용) */
export interface DecryptedFamilyMember {
  relation: FamilyRelation;
  name: string;
  gender: 'M' | 'F' | 'U';
  relationOrdinal: number;
}

/** 페르소나 매핑 소스 (PersonaContextService 전용) */
export interface PersonaSource {
  hometown: string | null;
  occupation: string | null;
  hobbies: string[];
  significantPlaces: string[];
  family: DecryptedFamilyMember[];
}

/** 보호자 정보 (소유권 검증용) */
export interface CaregiverContext {
  patientId: string | null;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(PatientProfile)
    private readonly profileRepository: Repository<PatientProfile>,
    @InjectRepository(FamilyMember)
    private readonly familyRepository: Repository<FamilyMember>,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * 프로필 upsert (가족 목록 동봉 시 전체 교체).
   */
  async upsert(
    caregiverId: string,
    caregiver: CaregiverContext,
    patientId: string,
    dto: UpsertPatientProfileDto,
  ): Promise<PatientProfileResponseDto> {
    this.verifyOwnership(caregiver, patientId);

    let profile = await this.profileRepository.findOne({
      where: { patientId },
    });

    if (!profile) {
      profile = this.profileRepository.create({
        patientId,
        caregiverId,
        hobbies: [],
        significantPlaces: [],
      });
    }

    if (dto.hometown !== undefined) profile.hometown = dto.hometown || null;
    if (dto.occupation !== undefined)
      profile.occupation = dto.occupation || null;
    if (dto.hobbies !== undefined) profile.hobbies = dto.hobbies;
    if (dto.significantPlaces !== undefined)
      profile.significantPlaces = dto.significantPlaces;
    if (dto.notes !== undefined)
      profile.notes = dto.notes ? this.cryptoService.encrypt(dto.notes) : null;

    const saved = await this.profileRepository.save(profile);

    // family 전달 시 전체 교체 (relationOrdinal 자동 채번)
    if (dto.family !== undefined) {
      await this.replaceFamily(saved.id, dto.family);
    }

    return this.getProfile(caregiver, patientId);
  }

  /**
   * 보호자용 프로필 조회 (실명 복호화 노출).
   */
  async getProfile(
    caregiver: CaregiverContext,
    patientId: string,
  ): Promise<PatientProfileResponseDto> {
    this.verifyOwnership(caregiver, patientId);

    const profile = await this.profileRepository.findOne({
      where: { patientId },
    });
    if (!profile) {
      throw new NotFoundException('등록된 환자 프로필이 없습니다.');
    }

    const family = await this.familyRepository.find({
      where: { profileId: profile.id },
      order: { relation: 'ASC', relationOrdinal: 'ASC' },
    });

    return toPatientProfileResponseDto(profile, family, (cipher) =>
      this.cryptoService.decrypt(cipher),
    );
  }

  /**
   * 가족 1명 추가 (relationOrdinal 자동 채번).
   */
  async addFamilyMember(
    caregiver: CaregiverContext,
    patientId: string,
    dto: FamilyMemberInputDto,
  ): Promise<PatientProfileResponseDto> {
    this.verifyOwnership(caregiver, patientId);
    const profile = await this.requireProfile(patientId);

    const count = await this.familyRepository.count({
      where: { profileId: profile.id },
    });
    if (count >= MAX_FAMILY_MEMBERS) {
      throw new BadRequestException(
        `가족 구성원은 최대 ${MAX_FAMILY_MEMBERS}명까지 등록할 수 있습니다.`,
      );
    }

    const ordinal = await this.nextOrdinal(profile.id, dto.relation);
    await this.familyRepository.save(
      this.familyRepository.create({
        profileId: profile.id,
        relation: dto.relation,
        name: this.cryptoService.encrypt(dto.name),
        gender: dto.gender ?? 'U',
        relationOrdinal: ordinal,
        note: dto.note ? this.cryptoService.encrypt(dto.note) : null,
      }),
    );

    return this.getProfile(caregiver, patientId);
  }

  /**
   * 가족 1명 삭제.
   */
  async removeFamilyMember(
    caregiver: CaregiverContext,
    patientId: string,
    familyMemberId: string,
  ): Promise<PatientProfileResponseDto> {
    this.verifyOwnership(caregiver, patientId);
    const profile = await this.requireProfile(patientId);

    const member = await this.familyRepository.findOne({
      where: { id: familyMemberId, profileId: profile.id },
    });
    if (!member) {
      throw new NotFoundException('해당 가족 구성원을 찾을 수 없습니다.');
    }

    await this.familyRepository.delete({ id: familyMemberId });
    return this.getProfile(caregiver, patientId);
  }

  /**
   * 페르소나 매핑 소스 조회 (PersonaContextService 전용, 복호화 포함).
   * - 프로필 미등록 시 null.
   */
  async getPersonaSource(patientId: string): Promise<PersonaSource | null> {
    const profile = await this.profileRepository.findOne({
      where: { patientId },
    });
    if (!profile) {
      return null;
    }

    const family = await this.familyRepository.find({
      where: { profileId: profile.id },
      order: { relation: 'ASC', relationOrdinal: 'ASC' },
    });

    return {
      hometown: profile.hometown,
      occupation: profile.occupation,
      hobbies: profile.hobbies ?? [],
      significantPlaces: profile.significantPlaces ?? [],
      family: family.map((m) => ({
        relation: m.relation,
        name: this.cryptoService.decrypt(m.name),
        gender: m.gender,
        relationOrdinal: m.relationOrdinal,
      })),
    };
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────────────

  private verifyOwnership(
    caregiver: CaregiverContext,
    patientId: string,
  ): void {
    if (caregiver.patientId !== patientId) {
      throw new ForbiddenException('해당 환자에 대한 접근 권한이 없습니다.');
    }
  }

  private async requireProfile(patientId: string): Promise<PatientProfile> {
    const profile = await this.profileRepository.findOne({
      where: { patientId },
    });
    if (!profile) {
      throw new NotFoundException(
        '등록된 환자 프로필이 없습니다. 프로필을 먼저 등록해주세요.',
      );
    }
    return profile;
  }

  /**
   * 가족 목록 전체 교체 — 단, 기존 구성원의 서수(relationOrdinal)는 보존한다.
   *
   * 서수는 페르소나 토큰([아들1])을 만드는 키이고, memory_entries의
   * masked_context·scenario_cache는 **토큰 상태로 저장**되어 표시 시점에 *현재*
   * 프로필로 역치환된다. 그래서 서수를 1부터 재부여하면, 보호자가 아들 한 명을
   * 빼고 저장하는 순간 옛 기억 속 [아들1]이 **다른 아들의 이름으로 복원**된다.
   * 환자에게 엉뚱한 가족 이름을 보여주는 것이라 반드시 막아야 한다.
   *
   * 따라서 (relation, name)이 같은 기존 구성원은 서수를 그대로 물려주고,
   * 새 구성원에게만 MAX+1로 새 서수를 준다(서수 재사용 금지).
   */
  private async replaceFamily(
    profileId: string,
    members: FamilyMemberInputDto[],
  ): Promise<void> {
    const existing = await this.familyRepository.find({ where: { profileId } });

    // (relation, 복호화된 실명) → 기존 서수
    const ordinalByKey = new Map<string, number>();
    // relation → 지금까지 쓰인 최대 서수 (새 구성원 채번의 출발점)
    const maxByRelation = new Map<FamilyRelation, number>();
    for (const member of existing) {
      const name = this.cryptoService.decrypt(member.name);
      ordinalByKey.set(`${member.relation} ${name}`, member.relationOrdinal);
      maxByRelation.set(
        member.relation,
        Math.max(maxByRelation.get(member.relation) ?? 0, member.relationOrdinal),
      );
    }

    await this.familyRepository.delete({ profileId });

    const entities = members.slice(0, MAX_FAMILY_MEMBERS).map((m) => {
      const key = `${m.relation} ${m.name}`;
      let ordinal = ordinalByKey.get(key);
      if (ordinal === undefined) {
        // 새 구성원 → 해당 관계에서 쓰인 적 없는 서수를 준다(재사용 금지)
        ordinal = (maxByRelation.get(m.relation) ?? 0) + 1;
        maxByRelation.set(m.relation, ordinal);
        ordinalByKey.set(key, ordinal);
      }
      return this.familyRepository.create({
        profileId,
        relation: m.relation,
        name: this.cryptoService.encrypt(m.name),
        gender: m.gender ?? 'U',
        relationOrdinal: ordinal,
        note: m.note ? this.cryptoService.encrypt(m.note) : null,
      });
    });

    if (entities.length > 0) {
      await this.familyRepository.save(entities);
    }
  }

  /**
   * 동일 관계 내 다음 서수를 채번한다.
   *
   * count+1은 삭제로 생긴 구멍을 무시해 충돌한다(아들1·아들2 중 아들1 삭제 시
   * count=1 → 다음도 2 → 아들2와 중복). 중복 서수는 두 사람이 같은 토큰
   * ([아들2])을 갖게 해 페르소나 역치환의 결정성을 깨뜨리므로, 서수를 재사용하지
   * 않도록 MAX+1로 채번한다.
   */
  private async nextOrdinal(
    profileId: string,
    relation: FamilyRelation,
  ): Promise<number> {
    const row = await this.familyRepository
      .createQueryBuilder('member')
      .select('MAX(member.relationOrdinal)', 'max')
      .where('member.profileId = :profileId', { profileId })
      .andWhere('member.relation = :relation', { relation })
      .getRawOne<{ max: number | string | null }>();

    const max = row?.max == null ? 0 : Number(row.max);
    return max + 1;
  }
}
