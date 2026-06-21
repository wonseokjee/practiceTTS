/**
 * Memory Link 전용 Axios 인스턴스
 *
 * 기능:
 * - JWT 토큰 자동 주입 (Authorization 헤더)
 * - 401 응답 시 토큰 삭제 후 /login 으로 리다이렉트
 */

import axios from 'axios';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

/** localStorage에 저장되는 JWT 토큰 키 */
export const ML_TOKEN_KEY = 'ml_token';

/** localStorage에 저장되는 환자 모드 플래그 키 (보호자 세션 내 화면 모드) */
export const ML_PATIENT_MODE_KEY = 'ml_patient_mode';

/**
 * 401이어도 세션 만료로 간주하지 않는 경로.
 * verify-pin은 "틀린 PIN"을 401로 반환하므로, 전역 로그아웃/리다이렉트 대상에서 제외한다.
 */
const SKIP_401_REDIRECT_PATHS = ['/auth/patient-mode/verify-pin'];

export const memoryLinkApi = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** 요청 인터셉터: 저장된 토큰을 Authorization 헤더에 자동 주입 */
memoryLinkApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(ML_TOKEN_KEY);
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

/** 응답 인터셉터: 401 응답 시 토큰 삭제 후 /login 으로 리다이렉트 */
memoryLinkApi.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url ?? '';
      const isSkipped = SKIP_401_REDIRECT_PATHS.some((p) => url.includes(p));
      // 이미 /login이면 다시 리다이렉트하지 않는다 (무한 새로고침 루프 방지).
      if (!isSkipped && window.location.pathname !== '/login') {
        localStorage.removeItem(ML_TOKEN_KEY);
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
