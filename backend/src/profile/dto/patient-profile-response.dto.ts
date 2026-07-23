import {
  FAMILY_RELATION_LABELS,
  type FamilyRelation,
} from '../constants/profile.constants';
import type { FamilyMember } from '../entities/family-member.entity';
import type { PatientProfile } from '../entities/patient-profile.entity';

/**
 * 가족 구성원 응답 DTO (보호자 전용 — 실명 복호화 노출).
 */
export class FamilyMemberResponseDto {
  id: string;
  relation: FamilyRelation;
  relationLabel: string;
  name: string;
  gender: 'M' | 'F' | 'U';
  relationOrdinal: number;
  note: string | null;
}

/**
 * 환자 프로필 응답 DTO (보호자 전용).
 * - notes 원문은 노출하지 않고 존재 여부(hasNotes)만 노출.
 */
export class PatientProfileResponseDto {
  patientId: string;
  hometown: string | null;
  occupation: string | null;
  hobbies: string[];
  significantPlaces: string[];
  hasNotes: boolean;
  family: FamilyMemberResponseDto[];
  updatedAt: string;
}

/**
 * 엔티티 → 보호자용 응답 DTO 변환.
 * @param decryptName  암호화된 name/note를 복호화하는 함수
 */
export function toPatientProfileResponseDto(
  profile: PatientProfile,
  family: FamilyMember[],
  decryptName: (cipher: string) => string,
): PatientProfileResponseDto {
  return {
    patientId: profile.patientId,
    hometown: profile.hometown,
    occupation: profile.occupation,
    hobbies: profile.hobbies ?? [],
    significantPlaces: profile.significantPlaces ?? [],
    hasNotes: profile.notes != null,
    family: family.map((m) => ({
      id: m.id,
      relation: m.relation,
      relationLabel: FAMILY_RELATION_LABELS[m.relation] ?? m.relation,
      name: decryptName(m.name),
      gender: m.gender,
      relationOrdinal: m.relationOrdinal,
      note: m.note != null ? decryptName(m.note) : null,
    })),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
