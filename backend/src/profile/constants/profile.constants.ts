/**
 * 환자 프로필(가족 페르소나) 도메인 상수.
 */

/** 가족 관계 허용값 */
export const VALID_FAMILY_RELATIONS = [
  'spouse',
  'son',
  'daughter',
  'grandson',
  'granddaughter',
  'sibling',
  'friend',
  'other',
] as const;

export type FamilyRelation = (typeof VALID_FAMILY_RELATIONS)[number];

/** 가족 관계 한국어 라벨 (UI 표시 + 역치환 폴백에 사용) */
export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  spouse: '배우자',
  son: '아들',
  daughter: '딸',
  grandson: '손자',
  granddaughter: '손녀',
  sibling: '형제자매',
  friend: '친구',
  other: '가족',
};

/** 페르소나 토큰 형식: [라벨서수] (예: [아들1], [장소1]) */
export const PLACE_TOKEN_LABEL = '장소';

export const MAX_HOBBIES = 10;
export const MAX_SIGNIFICANT_PLACES = 10;
export const MAX_FAMILY_MEMBERS = 20;
export const MAX_TEXT_FIELD_LENGTH = 100;
export const MAX_NOTES_LENGTH = 1000;
