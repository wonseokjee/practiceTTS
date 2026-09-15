import { memoryLinkApi } from './MemoryLinkApi.js';
import { i18n } from '../../shared/i18n/i18n.js';

/** GET /settings/locale 응답 (백엔드 `LocaleSettingsResponse` 미러). */
export interface LocaleSettings {
  patientLocale: string;
  /** 환자 직접 로그인이면 null — 보호자 행이 없다. */
  caregiverLocale: string | null;
}

/**
 * 계정 설정 API — 지금은 로케일 조회. 쓰기(`PUT /settings/locale`)는 언어 설정
 * 화면(계획서 M1 ④)과 함께 붙는다.
 */
export interface ISettingsApi {
  /** GET /settings/locale — 저장된 환자·보호자 로케일 */
  getLocale(): Promise<LocaleSettings>;
}

function isLocaleSettings(value: unknown): value is LocaleSettings {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.patientLocale === 'string' &&
    (obj.caregiverLocale === null || typeof obj.caregiverLocale === 'string')
  );
}

export const settingsApi: ISettingsApi = {
  async getLocale(): Promise<LocaleSettings> {
    const res = await memoryLinkApi.get<unknown>('/settings/locale');
    if (!isLocaleSettings(res.data)) {
      throw new Error(i18n.t('errors.invalidServerResponse', { ns: 'common' }));
    }
    return res.data;
  },
};
