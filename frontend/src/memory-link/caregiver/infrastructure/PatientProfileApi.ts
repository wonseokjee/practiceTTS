import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import type {
  FamilyMemberInput,
  PatientProfile,
  UpsertProfileRequest,
} from '../domain/PatientProfile.js';

/**
 * 환자 프로필 API 클라이언트 인터페이스.
 * - 테스트 시 Mock으로 교체 가능.
 */
export interface IPatientProfileApi {
  /** GET /patient-profile — 미등록 시 null */
  get(): Promise<PatientProfile | null>;
  /** PUT /patient-profile — upsert (family 동봉 시 전체 교체) */
  upsert(data: UpsertProfileRequest): Promise<PatientProfile>;
  /** POST /patient-profile/family — 가족 1명 추가 */
  addFamily(data: FamilyMemberInput): Promise<PatientProfile>;
  /** DELETE /patient-profile/family/:id — 가족 1명 삭제 */
  removeFamily(familyMemberId: string): Promise<PatientProfile>;
}

function isPatientProfile(value: unknown): value is PatientProfile {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.patientId === 'string' &&
    Array.isArray(obj.hobbies) &&
    Array.isArray(obj.significantPlaces) &&
    Array.isArray(obj.family)
  );
}

function toPatientProfile(raw: unknown): PatientProfile {
  if (!isPatientProfile(raw)) {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }
  return raw;
}

export const patientProfileApi: IPatientProfileApi = {
  async get(): Promise<PatientProfile | null> {
    try {
      const res = await memoryLinkApi.get<unknown>('/patient-profile');
      return toPatientProfile(res.data);
    } catch (err: unknown) {
      // 미등록(404)은 null로 정상 처리
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) {
        return null;
      }
      throw err;
    }
  },

  async upsert(data: UpsertProfileRequest): Promise<PatientProfile> {
    const res = await memoryLinkApi.put<unknown>('/patient-profile', data);
    return toPatientProfile(res.data);
  },

  async addFamily(data: FamilyMemberInput): Promise<PatientProfile> {
    const res = await memoryLinkApi.post<unknown>(
      '/patient-profile/family',
      data,
    );
    return toPatientProfile(res.data);
  },

  async removeFamily(familyMemberId: string): Promise<PatientProfile> {
    const res = await memoryLinkApi.delete<unknown>(
      `/patient-profile/family/${familyMemberId}`,
    );
    return toPatientProfile(res.data);
  },
};
