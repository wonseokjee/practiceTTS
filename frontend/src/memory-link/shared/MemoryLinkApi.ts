/**
 * Memory Link 전용 Axios 인스턴스
 *
 * 기능:
 * - JWT 토큰 자동 주입 (Authorization 헤더)
 * - 401 응답 시 토큰 삭제 후 /login 으로 리다이렉트
 */

import axios from 'axios';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

/**
 * 백엔드 오리진. axios를 쓰지 않는 호출(fetch로 오디오를 받는 등)에서 필요하다.
 */
export const API_BASE_URL = BASE_URL;

/**
 * 백엔드가 내려주는 상대 경로 미디어 URL(예: /uploads/memory-images/a.jpg)을
 * API 오리진 기준 절대 URL로 바꾼다.
 *
 * 상대 경로를 <img src>에 그대로 넣으면 브라우저가 **프론트 오리진**(:5173)
 * 기준으로 해석해 SPA의 index.html을 받아오고, 사진이 깨진 채 아무 에러도
 * 남지 않는다. axios 호출과 달리 baseURL이 적용되지 않기 때문이다.
 *
 * 이미 절대 URL(http…)이거나 data URI면 그대로 돌려준다.
 */
export function resolveMediaUrl(url: string): string;
export function resolveMediaUrl(url: null | undefined): null;
export function resolveMediaUrl(url: string | null | undefined): string | null;
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // blob:·data:는 브라우저 로컬 URL(업로드 미리보기)이라 오리진을 붙이면 깨진다.
  if (
    /^(https?:)?\/\//i.test(url) ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  return `${BASE_URL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

/** localStorage에 저장되는 JWT 토큰 키 */
export const ML_TOKEN_KEY = 'ml_token';

/** localStorage에 저장되는 환자 모드 플래그 키 (보호자 세션 내 화면 모드) */
export const ML_PATIENT_MODE_KEY = 'ml_patient_mode';

/**
 * 마지막으로 성공한 소셜 로그인 제공자('kakao'|'google'). 로그인 화면에서
 * "최근 사용" 배지를 그 버튼에 달아, 어느 걸로 가입했는지 헷갈리지 않게 한다.
 * 로그아웃해도 유지(다음 로그인 힌트로 계속 쓴다).
 */
export const ML_LAST_PROVIDER_KEY = 'ml_last_provider';

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
