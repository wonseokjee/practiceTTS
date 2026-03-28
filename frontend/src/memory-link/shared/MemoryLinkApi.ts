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
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      localStorage.removeItem(ML_TOKEN_KEY);
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
