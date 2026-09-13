import { useAuth } from './AuthContext.js';
import { useLocaleSync } from './useLocaleSync.js';

/**
 * 화면 로케일을 계정 설정·환자 모드에 맞추는 보이지 않는 컴포넌트.
 * `AuthProvider` 안에 한 번 둔다(App.tsx). 동작은 `useLocaleSync.ts`.
 */
export function LocaleSync(): null {
  const { user, isPatientMode } = useAuth();
  useLocaleSync(user, isPatientMode);
  return null;
}
