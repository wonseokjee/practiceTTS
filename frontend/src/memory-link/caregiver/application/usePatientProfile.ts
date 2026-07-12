import { useCallback, useEffect, useState } from 'react';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';
import { patientProfileApi } from '../infrastructure/PatientProfileApi.js';
import type {
  PatientProfile,
  UpsertProfileRequest,
} from '../domain/PatientProfile.js';

export interface UsePatientProfileReturn {
  profile: PatientProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: (data: UpsertProfileRequest) => Promise<boolean>;
}

/**
 * 환자 프로필 조회/저장 훅.
 * - 마운트 시 자동 조회. 미등록(null)은 정상 상태.
 */
export function usePatientProfile(): UsePatientProfileReturn {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await patientProfileApi.get();
      setProfile(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (data: UpsertProfileRequest): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        const updated = await patientProfileApi.upsert(data);
        setProfile(updated);
        return true;
      } catch (err) {
        setError(extractErrorMessage(err));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  return { profile, isLoading, isSaving, error, reload, save };
}
