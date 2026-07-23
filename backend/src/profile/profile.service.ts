import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
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

/**
 * `UPDATE ... RETURNING` 결과에서 서수를 꺼낸다.
 *
 * TypeORM의 `query()`는 SELECT면 행 배열을, UPDATE ... RETURNING이면
 * **`[rows, affectedCount]`** 를 돌려준다. 이 차이를 놓쳐 `rows[0].ordinal`로
 * 읽으면 항상 undefined다 — 목을 쓴 단위 테스트로는 절대 드러나지 않고,
 * 실제 DB에 붙여야 보인다(실측으로 발견).
 *
 * 드라이버·버전에 따라 형태가 갈릴 수 있으므로 두 형태를 모두 받는다.
 */
function extractReturnedOrdinal(result: unknown): number | null {
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }
  // [rows, affectedCount] 형태
  const head: unknown = result[0];
  const rows: unknown = Array.isArray(head) ? head : result;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const value = (rows[0] as { ordinal?: unknown } | undefined)?.ordinal;
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 서수 충돌(동시 추가) 시 재계산·재시도 횟수 상한. */
const ORDINAL_RETRY_LIMIT = 4;

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
    private readonly dataSource: DataSource,
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

    // nextOrdinal(MAX+1)과 save는 분리돼 있어, 같은 관계로 동시 추가가 들어오면
    // 둘이 같은 서수를 계산해 UNIQUE 제약(profile,relation,ordinal)을 위반한다.
    // 위반(23505)이면 서수를 다시 계산해 재시도한다(처리되지 않은 500 대신).
    for (let attempt = 0; attempt < ORDINAL_RETRY_LIMIT; attempt += 1) {
      const ordinal = await this.nextOrdinal(profile.id, dto.relation);
      try {
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
      } catch (error) {
        if (this.isUniqueViolation(error) && attempt < ORDINAL_RETRY_LIMIT - 1) {
          continue; // 서수 충돌 → 재계산 후 재시도
        }
        throw error;
      }
    }

    return this.getProfile(caregiver, patientId);
  }

  /** Postgres UNIQUE 제약 위반(23505) 여부. */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
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
    //
    // 키 구분자로 NUL( )을 쓴다. 이름에는 절대 들어갈 수 없어 공백이나
    // 하이픈과 달리 충돌이 없다. 다만 **리터럴 NUL을 소스에 박으면 안 된다** —
    // git이 파일을 바이너리로 취급해 줄 단위 diff가 사라지고 grep도 안 먹는다.
    // 반드시 이스케이프로 쓸 것.
    const ordinalByKey = new Map<string, number>();
    // relation → 지금까지 쓰인 최대 서수 (새 구성원 채번의 출발점)
    const maxByRelation = new Map<FamilyRelation, number>();
    for (const member of existing) {
      const name = this.cryptoService.decrypt(member.name);
      ordinalByKey.set(`${member.relation}\u0000${name}`, member.relationOrdinal);
      maxByRelation.set(
        member.relation,
        Math.max(maxByRelation.get(member.relation) ?? 0, member.relationOrdinal),
      );
    }

    // 살아있는 행이 없는 관계도 보존된 최고 수위에서 이어 채번해야 한다.
    // (전원 삭제 후 재등록 시 서수가 1로 되돌아가는 것을 막는다)
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    const highWater = profile?.relationOrdinalHighWater ?? {};
    for (const [relation, value] of Object.entries(highWater)) {
      const key = relation as FamilyRelation;
      maxByRelation.set(
        key,
        Math.max(maxByRelation.get(key) ?? 0, Number(value) || 0),
      );
    }

    // 암호화를 트랜잭션 밖에서 미리 끝낸다. 트랜잭션 구간에 남는 건 DB
    // 작업뿐이라, 암호화가 실패해도 트랜잭션이 열린 채 머물지 않는다.
    const rows = members.slice(0, MAX_FAMILY_MEMBERS).map((m) => {
      const key = `${m.relation}\u0000${m.name}`;
      let ordinal = ordinalByKey.get(key);
      if (ordinal === undefined) {
        // 새 구성원 → 해당 관계에서 쓰인 적 없는 서수를 준다(재사용 금지)
        ordinal = (maxByRelation.get(m.relation) ?? 0) + 1;
        maxByRelation.set(m.relation, ordinal);
        ordinalByKey.set(key, ordinal);
      }
      return {
        profileId,
        relation: m.relation,
        name: this.cryptoService.encrypt(m.name),
        gender: m.gender ?? 'U',
        relationOrdinal: ordinal,
        note: m.note ? this.cryptoService.encrypt(m.note) : null,
      };
    });

    // DELETE와 INSERT를 한 트랜잭션으로 묶는다.
    //
    // 예전에는 둘 사이에 트랜잭션이 없어서, DELETE 직후 무엇이든 실패하면
    // (암호화 키 회전, 커넥션 끊김, 프로세스 재시작) **환자의 가족 정보가
    // 통째로 사라졌다**. 이름은 AES로 저장되므로 백업 없이는 복구할 수
    // 없고, 재등록하면 서수가 1부터 다시 나가 임상 오류까지 뒤따랐다.
    await this.dataSource.transaction(async (manager) => {
      const familyRepo = manager.getRepository(FamilyMember);
      await familyRepo.delete({ profileId });
      if (rows.length > 0) {
        await familyRepo.save(rows.map((r) => familyRepo.create(r)));
      }

      // 이번 교체에서 올라간 수위를 보존한다. 다음 교체에서 전원이 사라져도
      // 여기서 읽어 이어 채번하므로 서수가 재사용되지 않는다. GREATEST
      // 병합이라 다른 관계의 키를 지우지 않는다(옛 방식은 지웠다).
      for (const [relation, value] of maxByRelation) {
        await this.raiseHighWater(profileId, relation, value, manager);
      }
    });
  }

  /**
   * 동일 관계 내 다음 서수를 채번한다.
   *
   * count+1은 삭제로 생긴 구멍을 무시해 충돌한다(아들1·아들2 중 아들1 삭제 시
   * count=1 → 다음도 2 → 아들2와 중복). 중복 서수는 두 사람이 같은 토큰
   * ([아들2])을 갖게 해 페르소나 역치환의 결정성을 깨뜨리므로, 서수를 재사용하지
   * 않도록 채번한다.
   *
   * 살아있는 행의 MAX만으로는 부족하다. 해당 관계의 구성원을 **전원 삭제**하면
   * MAX가 NULL이 되어 카운터가 1로 되돌아가고, 새로 등록한 사람이 [아들1]을
   * 물려받아 옛 기억이 그 사람 이름으로 복원된다. 프로필에 보존한 최고 수위를
   * 함께 봐서 이 구멍을 막는다.
   */
  private async nextOrdinal(
    profileId: string,
    relation: FamilyRelation,
    manager?: EntityManager,
  ): Promise<number> {
    const row = await this.familyRepository
      .createQueryBuilder('member')
      .select('MAX(member.relationOrdinal)', 'max')
      .where('member.profileId = :profileId', { profileId })
      .andWhere('member.relation = :relation', { relation })
      .getRawOne<{ max: number | string | null }>();

    const survivingMax = row?.max == null ? 0 : Number(row.max);
    return this.claimNextOrdinal(profileId, relation, survivingMax, manager);
  }

  /**
   * 다음 서수를 **원자적으로** 발급한다 (수위를 올리고 그 값을 돌려받는다).
   *
   * 예전에는 findOne → JS 스프레드 → save 였다. JSONB 컬럼을 통째로
   * 덮어쓰므로 같은 프로필에 아들·딸을 거의 동시에 추가하면 나중 저장이
   * 앞의 키를 지워 **수위가 통째로 유실**됐다. UNIQUE 위반이 아니라서
   * 재시도 루프에도 안 걸리고 아무 신호가 남지 않는다.
   *
   * 실측(일회용 DB, 동시 10건): 옛 방식은 전원이 서수 1을 받고 최종
   * high-water에서 son 키가 사라졌다. 이 방식은 동시 20건이 1~20으로
   * 겹침 없이 발급된다.
   *
   * 한 문장짜리 UPDATE라 같은 행에 대한 동시 실행이 행 잠금으로 직렬화된다.
   *
   * @param floor 살아있는 행의 MAX. 수위와 이 값 중 큰 쪽 다음을 발급한다.
   */
  private async claimNextOrdinal(
    profileId: string,
    relation: FamilyRelation,
    floor: number,
    manager?: EntityManager,
  ): Promise<number> {
    const runner = manager ?? this.profileRepository.manager;
    const rows = (await runner.query(
      `UPDATE "patient_profiles"
          SET "relation_ordinal_high_water" = jsonb_set(
                COALESCE("relation_ordinal_high_water", '{}'::jsonb),
                ARRAY[$2::text],
                to_jsonb(
                  GREATEST(
                    COALESCE(("relation_ordinal_high_water"->>$2)::int, 0),
                    $3::int
                  ) + 1
                )
              )
        WHERE "id" = $1::uuid
        RETURNING ("relation_ordinal_high_water"->>$2)::int AS ordinal`,
      [profileId, relation, floor],
    )) as unknown;

    const ordinal = extractReturnedOrdinal(rows);
    if (ordinal == null) {
      throw new NotFoundException('환자 프로필을 찾을 수 없습니다.');
    }
    return ordinal;
  }

  /**
   * 수위를 주어진 값까지 끌어올린다(내리지 않는다).
   *
   * `replaceFamily`는 서수를 JS에서 한꺼번에 배정하므로 채번 경로를 쓰지
   * 못한다. 대신 배정이 끝난 뒤 관계별 최대값으로 수위를 맞춘다.
   * 여기서도 GREATEST 병합이라 다른 관계의 키를 지우지 않는다.
   */
  private async raiseHighWater(
    profileId: string,
    relation: FamilyRelation,
    ordinal: number,
    manager?: EntityManager,
  ): Promise<void> {
    const runner = manager ?? this.profileRepository.manager;
    await runner.query(
      `UPDATE "patient_profiles"
          SET "relation_ordinal_high_water" = jsonb_set(
                COALESCE("relation_ordinal_high_water", '{}'::jsonb),
                ARRAY[$2::text],
                to_jsonb(
                  GREATEST(
                    COALESCE(("relation_ordinal_high_water"->>$2)::int, 0),
                    $3::int
                  )
                )
              )
        WHERE "id" = $1::uuid`,
      [profileId, relation, ordinal],
    );
  }
}
