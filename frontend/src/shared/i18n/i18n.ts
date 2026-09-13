/**
 * 화면 문구 i18n의 **단일 인스턴스** — 영어판 Phase 1-1(계획서 §4).
 *
 * 이 커밋은 문구를 옮기지 않는다. 옮기기 전에 **규약 다섯 개**를 못 박는 것이
 * 목적이다 — 1,785개 리터럴에 키가 달린 뒤에 규약을 바꾸면 전부 다시 만진다.
 *
 * ## 규약
 *
 * 1. **키 이름** — 네임스페이스 = 최상위 영역(`common`·`caregiver`·`patient`·
 *    `quiz`·`assessments`). 키 = `화면또는컴포넌트.요소`, camelCase
 *    (`weeklyReport.title`). **문장 자체를 키로 쓰지 않는다** — 한국어 문장이
 *    키가 되면 문구를 고칠 때마다 영어 파일의 키도 갈린다.
 *
 * 2. **복수형** — 수량이 붙는 문구는 반드시 `count`로 보간하고 `_one`/`_other`
 *    접미를 쓴다. 한국어는 복수형이 없어(`Intl.PluralRules('ko')`가 `other`만
 *    낸다) 한국어 파일엔 `_other`만 둔다. 지금 수량이 붙은 자리는 17곳이다
 *    (`{count}회`·`{totalItems}문항` …, 계획서 1-1).
 *    날짜 서수(`3일` → `3rd`)는 복수형이 아니다 — 3번으로 푼다.
 *
 * 3. **날짜·시각** — 문구에 박지 않는다. `formatDate`(`Intl.DateTimeFormat`,
 *    현재 로케일)로 만든다. 12시간/24시간제·서수·요일 이름은 로케일이 정한다.
 *
 * 4. **어느 로케일인가 — `isPatientMode`가 정한다.** 환자 모드면
 *    `patient_locale`, 아니면 `caregiver_locale`(`LocaleSync`). 로그인이 아니라
 *    모드 토글이라 같은 탭·같은 세션에서 언어가 갈린다. 로그인 전 화면은
 *    `DEFAULT_LOCALE` — 브라우저 언어 추론은 보호자 문을 여는 M1 ④에서 붙인다
 *    (서버 지원 목록이 아직 로그인 뒤에만 열려 있다).
 *
 * 5. **리소스는 로케일별 지연 로딩** — `import.meta.glob`의 기본이 동적
 *    import라, 쓰는 로케일의 JSON만 받는다. 한국어만 쓰는 사용자가 영어 문구를
 *    받지 않는다(폰트를 2,346KB → 257KB로 줄인 것과 같은 이유, §7-1).
 *    `initI18n`이 활성 로케일의 네임스페이스를 **첫 렌더 전에** 전부 받으므로
 *    화면이 로딩 상태에 걸리지 않는다. 언어를 바꿀 때는 i18next가 새 리소스를
 *    다 받은 뒤에 전환한다 — 그 사이엔 이전 언어가 그대로 보인다.
 *
 * ## 폴백을 끈 이유 (`fallbackLng: false`)
 *
 * 기본 폴백은 원문 노출이고, 여기서 원문은 한국어다. 영어 화면에서 키가
 * 빠지면 미국 고령 환자에게 "따라 말해 보세요"가 뜬다 — 실어증 환자는 못 읽는
 * 글을 자기 증상으로 받아들일 수 있다(§7-7 결정 A). 빠진 키는 폴백으로 덮지
 * 않고, 개발 빌드에서 경고로 드러낸다. 영어 파일이 다 찼는지는 T16 lint가 문을
 * 열기 전에 막는다.
 *
 * **`AVAILABLE_LOCALES`는 게이트가 아니다.** 프론트가 그릴 수 있는 로케일일
 * 뿐이고(영어는 빈 껍데기라도 파일이 있으면 들어간다), 사용자가 고를 수 있는
 * 로케일은 서버(`SUPPORTED_LOCALES`, 계획서 0-5c)가 정한다. 서버가 `en-US`를
 * 저장하지 못하는 동안 이 앱은 한국어만 그린다.
 */
import i18next, { type BackendModule, type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE } from '../domain/locale.js';

/** 규약 1의 네임스페이스. 문자열 추출 커밋이 영역마다 하나씩 늘린다. */
export const NAMESPACES = ['common', 'quiz'] as const;
export type Namespace = (typeof NAMESPACES)[number];

type ResourceModule = { default: Record<string, unknown> };

/** `./locales/<로케일>/<네임스페이스>.json` — 지연(동적 import). */
const loaders = import.meta.glob<ResourceModule>('./locales/*/*.json');

function localeOfPath(path: string): string {
  // './locales/<로케일>/common.json' → '<로케일>' (예: ko-KR)
  return path.split('/')[2];
}

/** 리소스 파일이 있는 로케일 — 게이트가 아니다(머리말). */
export const AVAILABLE_LOCALES: readonly string[] = [
  ...new Set(Object.keys(loaders).map(localeOfPath)),
];

/** 그릴 수 있는 로케일이면 그대로, 아니면 기본 로케일. */
export function resolveUiLocale(candidate: string | null | undefined): string {
  return candidate && AVAILABLE_LOCALES.includes(candidate)
    ? candidate
    : DEFAULT_LOCALE;
}

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`./locales/${language}/${namespace}.json`];
    if (!load) {
      // 그 로케일에 이 네임스페이스 파일이 아직 없다 — 빈 묶음으로 둔다.
      // 빠진 키는 missingKeyHandler가 드러낸다(폴백으로 덮지 않는다).
      callback(null, {});
      return;
    }
    load().then(
      (mod) => callback(null, mod.default),
      (error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)), null),
    );
  },
};

export const i18n: I18n = i18next.createInstance();

let initPromise: Promise<unknown> | null = null;

/**
 * 첫 렌더 전에 한 번 부른다(`main.tsx`). 여러 번 불러도 한 번만 초기화한다 —
 * 이후 언어 변경은 `i18n.changeLanguage`로(`LocaleSync`).
 */
export function initI18n(locale: string = DEFAULT_LOCALE): Promise<unknown> {
  initPromise ??= i18n
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      lng: resolveUiLocale(locale),
      fallbackLng: false,
      supportedLngs: [...AVAILABLE_LOCALES],
      // 언어-지역(ko-KR)에서 언어(ko)만 따로 찾지 않는다 — 파일은 로케일 단위로만 있다.
      load: 'currentOnly',
      ns: [...NAMESPACES],
      defaultNS: 'common',
      // React가 이미 이스케이프한다.
      interpolation: { escapeValue: false },
      saveMissing: import.meta.env.DEV,
      missingKeyHandler: (languages, namespace, key) => {
        console.warn(
          `[i18n] 빠진 키: ${namespace}:${key} (${languages.join(',')})`,
        );
      },
    });
  return initPromise;
}
