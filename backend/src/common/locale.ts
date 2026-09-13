/**
 * 로케일 기본값의 **단일 출처**(백엔드).
 *
 * `ai-proxy`가 STT·발음 평가로 넘기는 `lang`이 두 곳에 각자
 * `body.lang ?? 'ko-KR'`로 박혀 있었다. 값이 같아 문제가 없어 보였지만,
 * 언어를 늘릴 때 한 곳만 고치면 그 경로만 조용히 한국어로 남는다.
 *
 * 진짜 저장소는 `users.locale`(M27)이다. 이 상수는 클라이언트가 값을 안
 * 보냈을 때의 기본값이고, `qab_results.locale`이 NULL을 허용하는 것과 같은
 * 이유로 **여기서 프로필을 다시 읽지는 않는다** — 그러면 세션 중 설정 변경이
 * 진행 중인 요청에 섞인다.
 */
export const DEFAULT_LOCALE = 'ko-KR';

/**
 * 로케일이 붙는 두 자리. `users.locale` 하나가 환자 행에선 `patient_locale`,
 * 보호자 행에선 `caregiver_locale`의 뜻이다(계획서 §13 OV-6A).
 */
export type LocaleField = 'patient' | 'caregiver';

/**
 * 필드별 **지원 로케일** — 영어판의 두 문(계획서 §7-7 결정 A, §16).
 *
 *   caregiver  UI 문자열 + 보호자용 시드가 차고, 미국 컴플라이언스(T7)가 끝나면 연다
 *   patient    문항 풀이 밴드 기준(116)을 채우면 연다
 *
 * **여기에 값을 넣는 커밋이 곧 문을 여는 커밋이다.** 환경변수로 빼지 않은
 * 이유가 그것이다 — 설정 한 줄이 조용히 틀려 문이 열리는 것보다, 리뷰를 거친
 * PR 한 줄로 여닫는 편이 안전하다(fail-closed). `locale.spec.ts`가 지금 닫혀
 * 있다는 것을 고정해 두어, 여는 PR은 그 테스트도 같이 고쳐야 한다.
 *
 * 쓰기 경로(`PUT /settings/locale`)는 이 목록에 없는 값을 400으로 거부하고,
 * 프론트는 `GET /settings/locales`로 받은 목록으로만 선택지를 그린다(계획서 0-5c).
 */
export const SUPPORTED_LOCALES: Readonly<
  Record<LocaleField, readonly string[]>
> = {
  patient: [DEFAULT_LOCALE],
  caregiver: [DEFAULT_LOCALE],
};

export function isSupportedLocale(field: LocaleField, locale: string): boolean {
  return SUPPORTED_LOCALES[field].includes(locale);
}
