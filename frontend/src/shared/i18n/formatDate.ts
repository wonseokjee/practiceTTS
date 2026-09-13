import { DEFAULT_LOCALE } from '../domain/locale.js';
import { i18n } from './i18n.js';

/**
 * 날짜·시각을 **현재 화면 로케일**로 적는다 — i18n 규약 3(`i18n.ts` 머리말).
 *
 * 문구에 날짜를 박으면(`${d.getDate()}일`) 영어의 서수(`3rd`)·월 이름·12시간제를
 * 표현할 수 없다. 모양은 `Intl.DateTimeFormat`에 맡기고 옵션만 넘긴다.
 *
 * **화면 날짜는 전부 이 함수를 거친다.** 로케일 상수로 `toLocaleDateString`을
 * 직접 부르면 계정 로케일(`LocaleSync`)을 우회한다 — 보호자 화면 네 곳이 그렇게
 * 한국어 날짜를 박고 있었다(계획서 1-2 "날짜 포맷 4곳", 옮김 완료).
 * `locale.test.ts`가 그 모양이 다시 생기는 것을 막는다.
 */
export function formatDate(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = i18n.resolvedLanguage ?? DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}
