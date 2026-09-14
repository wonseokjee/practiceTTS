/**
 * 환자 호칭 표시 헬퍼.
 *
 * 가입 폼은 "어르신 성함"을 묻지만, 보호자가 실제로 적는 값은 성함이 아닌
 * 경우가 많다 — "어머니", "할머니", "김영희 여사"처럼 부르는 말을 적는다.
 * 여기에 경칭을 기계적으로 덧붙이면 "어머니 어르신", "김영희 여사님"처럼
 * 어색하거나 경칭이 겹친다(실제로 "개발 어르신 어르신"으로 렌더링됐다).
 *
 * 규칙은 하나다: **이미 경칭이거나 경칭으로 끝나면 덧붙이지 않는다.**
 * 이름을 잘라내지는 않는다 — 보호자가 적은 말을 임의로 손대는 쪽이 더 위험하다.
 */

/**
 * 기본 경칭 — '님'. 이 시스템 전체가 한국어 전용이라(계획서 §6-3, 별도 재구현
 * 과제) 상수도 한국어다. UI 컴포넌트가 리터럴 '님'을 직접 들고 있지 않게
 * 여기 한 곳에 모아 둔다 — i18n 문자열 추출 가드(§4 1-2)가 UI 디렉터리의
 * 한글을 찾는데, 이 상수는 도메인 파일에 있어 그 대상이 아니다.
 */
export const DEFAULT_HONORIFIC = '님';

/** 끝에 오면 이미 높임으로 보는 말. */
const HONORIFIC_ENDINGS = [
  '어르신',
  '선생님',
  '여사님',
  '여사',
  '옹',
  '님',
  '씨',
] as const;

/** 그 자체로 높임인 호칭(뒤에 경칭을 붙이면 어색하다). */
const KINSHIP_TERMS = [
  '어머니',
  '어머님',
  '아버지',
  '아버님',
  '할머니',
  '할머님',
  '할아버지',
  '할아버님',
  '엄마',
  '아빠',
  '외할머니',
  '외할아버지',
  '장모님',
  '장인어른',
  '시어머니',
  '시아버지',
] as const;

/** 이미 경칭이 붙어 있거나 그 자체로 호칭인가. */
export function alreadyHonorific(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if ((KINSHIP_TERMS as readonly string[]).includes(trimmed)) return true;
  return (HONORIFIC_ENDINGS as readonly string[]).some((ending) =>
    trimmed.endsWith(ending),
  );
}

/**
 * 이름에 경칭을 붙인다. 이미 높임이면 그대로 둔다.
 *
 * @param name       보호자가 입력한 환자 호칭 (null·빈 값이면 fallback)
 * @param honorific  붙일 경칭. 공백 없이 이어붙는 '님'은 separator를 ''로.
 * @param fallback   이름이 없을 때 쓸 말
 */
export function withHonorific(
  name: string | null | undefined,
  honorific: string,
  { separator = ' ', fallback = '환자' }: { separator?: string; fallback?: string } = {},
): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return fallback;
  if (alreadyHonorific(trimmed)) return trimmed;
  return `${trimmed}${separator}${honorific}`;
}
