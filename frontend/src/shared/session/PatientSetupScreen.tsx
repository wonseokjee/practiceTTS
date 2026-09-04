/**
 * 환자 등록 화면
 *
 * 검사 시작 전 환자 ID를 입력받아 세션을 생성한다.
 * 유효성 검사: 1자 이상 입력 필수.
 */

import { useState } from 'react';
import { useSessionContext } from './SessionContext.js';

export function PatientSetupScreen() {
  const { startSession } = useSessionContext();
  const [patientId, setPatientId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = patientId.trim();
    if (trimmed.length === 0) {
      setError('환자 ID를 입력해주세요.');
      return;
    }
    startSession(trimmed);
  };

  return (
    <div className="h-full bg-canvas flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.08)] w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-ink mb-2 text-center">
          practiveTTS
        </h1>
        <p className="text-sm text-muted text-center mb-8">
          검사를 시작하기 전에 환자 정보를 입력해주세요.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="patientId"
              className="block text-sm font-medium text-ink mb-1"
            >
              환자 ID
            </label>
            <input
              id="patientId"
              type="text"
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value);
                setError(null);
              }}
              placeholder="예: P-2026-001"
              className="w-full border border-line rounded-xl px-4 py-3 text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              autoComplete="off"
              autoFocus
            />
            {error !== null && (
              <p className="text-danger text-sm mt-1">{error}</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full min-h-[48px] bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-full text-base transition-colors mt-2"
          >
            검사 시작
          </button>
        </form>
      </div>
    </div>
  );
}
