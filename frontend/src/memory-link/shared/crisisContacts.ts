// 위기 연결처 번호 — 로케일(=보호자가 사는 나라)별.
//
// 번호는 문구가 아니라 데이터라 i18n JSON이 아니라 여기 둔다. 이름 문구만
// `caregiver:crisisBar.contact.<id>` 키로 번역한다.
//
// 없는 로케일은 null — 다른 나라 번호를 대신 보여주지 않는다. 미국 사용자에게
// 109(한국 자살예방 상담)를 띄우면 걸리지 않는 번호를 위기 순간에 누르게 된다.
//
// 최종 번호 확인은 TODOS `legal-review-mentor`에서 한다(2026-10-05 디자인 리뷰).

export interface CrisisContact {
  /** i18n 키 꼬리 — `crisisBar.contact.<id>` */
  id: string;
  /** tel: 링크에 넣는 값 */
  tel: string;
  /** 화면에 보이는 번호 */
  display: string;
}

export interface CrisisContactSet {
  /** 하단 줄에 바로 보이는 번호 — 375px에서 두 개까지 */
  primary: readonly CrisisContact[];
  /** '더보기' 시트의 전체 목록 */
  all: readonly CrisisContact[];
}

const KO_SUICIDE: CrisisContact = { id: 'suicide', tel: '109', display: '109' };
const KO_POLICE: CrisisContact = { id: 'police', tel: '112', display: '112' };
const KO_AMBULANCE: CrisisContact = {
  id: 'ambulance',
  tel: '119',
  display: '119',
};
const KO_ELDER_ABUSE: CrisisContact = {
  id: 'elderAbuse',
  tel: '15771389',
  display: '1577-1389',
};

const US_LIFELINE: CrisisContact = {
  id: 'lifeline',
  tel: '988',
  display: '988',
};
const US_EMERGENCY: CrisisContact = {
  id: 'emergency',
  tel: '911',
  display: '911',
};
const US_ELDERCARE: CrisisContact = {
  id: 'eldercare',
  tel: '18006771116',
  display: '1-800-677-1116',
};

const CRISIS_CONTACTS_BY_LOCALE: Readonly<Record<string, CrisisContactSet>> = {
  'ko-KR': {
    primary: [KO_SUICIDE, KO_AMBULANCE],
    all: [KO_SUICIDE, KO_POLICE, KO_AMBULANCE, KO_ELDER_ABUSE],
  },
  'en-US': {
    primary: [US_LIFELINE, US_EMERGENCY],
    all: [US_LIFELINE, US_EMERGENCY, US_ELDERCARE],
  },
};

export function crisisContactsFor(locale: string): CrisisContactSet | null {
  return CRISIS_CONTACTS_BY_LOCALE[locale] ?? null;
}

/** 모든 로케일에 등장하는 id — 번역 키가 빠지지 않았는지 테스트가 본다. */
export const ALL_CRISIS_CONTACT_IDS: readonly string[] = [
  ...new Set(
    Object.values(CRISIS_CONTACTS_BY_LOCALE).flatMap((s) =>
      s.all.map((c) => c.id),
    ),
  ),
];
