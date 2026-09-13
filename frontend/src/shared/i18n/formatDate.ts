import { DEFAULT_LOCALE } from '../domain/locale.js';
import { i18n } from './i18n.js';

/**
 * 날짜·시각을 **현재 화면 로케일**로 적는다 — i18n 규약 3(`i18n.ts` 머리말).
 *
 * 문구에 날짜를 박으면(`${d.getDate()}일`) 영어의 서수(`3rd`)·월 이름·12시간제를
 * 표현할 수 없다. 모양은 `Intl.DateTimeFormat`에 맡기고 옵션만 넘긴다.
 *
 * 지금 `toLocaleDateString('ko-KR', …)`을 직접 부르는 네 곳(보호자 화면)은
 * 별도 커밋에서 이 함수로 옮긴다(계획서 1-2 "날짜 포맷 4곳").
 */
export function formatDate(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = i18n.resolvedLanguage ?? DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}
