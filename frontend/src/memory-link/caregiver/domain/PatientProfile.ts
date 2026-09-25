/**
 * 환자 프로필(가족 페르소나) 도메인 타입.
 */

export type FamilyRelation =
  | 'spouse'
  | 'son'
  | 'daughter'
  | 'grandson'
  | 'granddaughter'
  | 'sibling'
  | 'friend'
  | 'other';

export const FAMILY_RELATION_OPTIONS: FamilyRelation[] = [
  'spouse',
  'son',
  'daughter',
  'grandson',
  'granddaughter',
  'sibling',
  'friend',
  'other',
];

export type Gender = 'M' | 'F' | 'U';

export interface FamilyMember {
  id: string;
  relation: FamilyRelation;
  relationLabel: string;
  name: string;
  gender: Gender;
  relationOrdinal: number;
  note: string | null;
}

export interface PatientProfile {
  patientId: string;
  hometown: string | null;
  occupation: string | null;
  hobbies: string[];
  significantPlaces: string[];
  hasNotes: boolean;
  family: FamilyMember[];
  updatedAt: string;
}

/** 가족 입력 (저장 요청용) */
export interface FamilyMemberInput {
  relation: FamilyRelation;
  name: string;
  gender?: Gender;
  note?: string;
}

/** 프로필 upsert 요청 (family 동봉 시 전체 교체) */
export interface UpsertProfileRequest {
  hometown?: string;
  occupation?: string;
  hobbies?: string[];
  significantPlaces?: string[];
  notes?: string;
  family?: FamilyMemberInput[];
}
