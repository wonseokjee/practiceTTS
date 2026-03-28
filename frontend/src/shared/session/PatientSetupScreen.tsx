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
    <div className="h-full bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 text-center">
          practiveTTS
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          검사를 시작하기 전에 환자 정보를 입력해주세요.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="patientId"
              className="block text-sm font-medium text-gray-700 mb-1"
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
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              autoComplete="off"
              autoFocus
            />
            {error !== null && (
              <p className="text-red-500 text-sm mt-1">{error}</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 rounded-xl text-base transition-colors mt-2"
          >
            검사 시작
          </button>
        </form>
      </div>
    </div>
  );
}
