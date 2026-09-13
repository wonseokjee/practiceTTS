/**
 * 앱 로케일의 **단일 출처**.
 *
 * 예전에는 `'ko-KR'`이 STT·TTS·발화 캡처 여섯 곳에 각자 기본 인자로 박혀 있었다.
 * 값이 같아서 문제가 없어 보였지만, 언어를 늘리는 순간 **여섯 군데를 다 찾아야**
 * 하고 하나만 빠뜨리면 그 경로만 조용히 한국어로 남는다.
 *
 * 지금은 값이 상수 하나다. 서버 쪽 짝은 `users.locale`(M27)이다 — 그쪽이 진짜
 * 저장소이고, 이 상수는 그 값을 모를 때(로그인 전·조회 실패)의 기본값이다.
 *
 * **화면 문구와 날짜는 여기서 고르지 않는다.** i18n(Phase 1-1)이 생긴 뒤로
 * 화면 로케일은 `LocaleSync`가 `isPatientMode`에 따라 `patient_locale`/
 * `caregiver_locale` 중에서 고르고, 날짜는 `formatDate`가 그 로케일로 적는다.
 * 예전의 `CAREGIVER_LOCALE`(= 기본값을 보호자 날짜에 박던 상수)은 그래서
 * 없앴다 — 남겨 두면 보호자 화면이 계정 설정과 무관하게 한국어 날짜를 찍는
 * 통로가 된다.
 */
export const DEFAULT_LOCALE = 'ko-KR';

/**
 * 로케일에서 언어 코드만 — `ko-KR` → `ko`.
 *
 * 브라우저 음성 목록은 `ko-KR`·`ko` 처럼 정밀도가 제각각이라, 지역까지 맞는
 * 음성이 없을 때 언어만으로 한 번 더 찾아야 한다.
 */
export function languageOf(locale: string): string {
  return locale.split('-')[0];
}
