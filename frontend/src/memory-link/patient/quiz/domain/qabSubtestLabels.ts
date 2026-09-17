// QAB 검사 종류의 표시 라벨 — **단일 진실**.
//
// 예전에는 보호자 화면 세 곳(QabProgressCard·WeeklyReportScreen의 SUBTEST_LABELS,
// SkillLevelCard의 LEVELED_SKILLS)에 따로 하드코딩돼 있었고, 전부
// `Record<string, string>` / 평범한 배열이라 **타입이 누락을 못 잡았다.**
// 2026-08-17에 `spell` 검사를 추가하면서 세 곳을 다 빠뜨렸는데 `tsc -b`가 통과했고,
// 환자는 문항을 푸는데 보호자에게만 안 보이는 상태가 됐다. 브라우저 QA 전까지 몰랐다.
//
// 이제 `Record<QabSubtest, string>`이라 검사를 추가하고 라벨을 안 주면 **빌드가 깨진다.**

import type { QabSubtest } from './QabResult.js';

/**
 * 검사 종류 → 보호자에게 보여줄 이름의 i18n 키(`caregiver:qabSubtestLabels.*`).
 *
 * 값이 문자열이 아니라 키인 이유는 둘이다.
 *  1. 도메인 계층은 로케일을 모른다 — 실제 문구는 화면 쪽이 `t()`로 옮긴다.
 *  2. **en-US 값은 직역이 아니라 웰니스 어휘다**(전략 문서 §2 FTC 가드레일,
 *     계획서 §1-3). 이 앱은 의료기기가 아니라 인지 활동 도구이므로, 영어
 *     화면은 "검사(test)"·"의식 수준(level of consciousness)" 같은 임상
 *     문구 대신 "activity"·"exercise"·"check" 같은 소비자용 표현을 쓴다.
 *     한국어 값은 그대로 임상 표현을 쓴다(§1-3 표는 en 열만 바꾼다).
 */
export const QAB_SUBTEST_LABELS: Record<QabSubtest, string> = {
  loc: 'qabSubtestLabels.loc',
  word: 'qabSubtestLabels.word',
  sentence: 'qabSubtestLabels.sentence',
  naming: 'qabSubtestLabels.naming',
  repeat: 'qabSubtestLabels.repeat',
  reading: 'qabSubtestLabels.reading',
  spell: 'qabSubtestLabels.spell',
  ddk: 'qabSubtestLabels.ddk',
};

/**
 * 보호자 화면 표시 순서 — 이해 → 산출 → 말운동.
 *
 * `Record`의 키 순서에 기대지 않고 명시한다. 그리고 이 배열이 라벨 표와 어긋나면
 * `qabSubtestLabels.test.ts`가 잡는다 — 배열은 타입만으로 전수를 강제할 수 없다.
 */
export const QAB_SUBTEST_ORDER: readonly QabSubtest[] = [
  'loc',
  'word',
  'sentence',
  'naming',
  'repeat',
  'reading',
  'spell',
  'ddk',
];

/**
 * 적응 레벨(1~5)을 갖는 검사만. `loc`은 진단성이라 눈높이 개념이 없어 제외한다.
 *
 * 제외는 **명시적으로** 한다. 새 검사를 추가하면 여기에 넣을지 빼는지 판단이
 * 필요한데, 배열에서 조용히 빠지면 보호자 눈높이 카드에 안 보인다.
 *
 * **여기 있다는 건 그 검사가 실제로 레벨에 따라 다른 문항을 낸다는 뜻이다.**
 * 2026-08-17까지는 아니었다 — repeat·reading·ddk는 레벨을 받지도 않았고
 * sentence는 스탬핑만 했는데, 보호자 화면은 loc를 뺀 전부에 1~5단계를 보여줬다.
 * 재활 앱에서 그건 UI 오류가 아니라 보호자의 임상 판단을 오염시키는 거짓 신호다.
 * `qabSubtestLabels.test.ts`가 각 검사의 난이도 축이 실재하는지 고정한다.
 */
/**
 * 눈높이(1~5단계)가 없는 검사.
 *
 * `loc`(의식 수준)는 개념상 없다 — 반응 유무이지 난이도가 아니다.
 *
 * `naming`(그림 이름대기)은 **축이 하나도 없어서** 여기 있다. 레벨이 닿는 곳은
 * `presentedLevel` 스탬핑 한 줄뿐이라, 레벨 1과 5가 완전히 같은 문항을 냈다.
 * 그런데 보호자 화면은 1~5단계를 표시했다 — 재활 앱에서 그건 UI 오류가 아니라
 * 보호자의 임상 판단을 오염시키는 거짓 신호다.
 *
 * 재료도 부족하다. 이름대기 낱말의 음절 분포는 1음절 13 / 2음절 49 / 3음절 27 /
 * **4음절 2**라 길이 축으로는 3밴드가 최대다.
 *
 * 이름대기의 표준 난이도 축은 **단서 위계**(모델 제공 → 문장 완성 → 첫 음절 →
 * 의미 단서 → 무단서)다. 그건 화면과 채점이 함께 바뀌는 별개 기능이라 여기서
 * 하지 않는다. 축이 생기면 이 목록에서 빼면 된다.
 */
export const NON_LEVELED_SUBTESTS: readonly QabSubtest[] = ['loc', 'naming'];

export const LEVELED_SUBTESTS: readonly QabSubtest[] = QAB_SUBTEST_ORDER.filter(
  (s) => !NON_LEVELED_SUBTESTS.includes(s),
);

/**
 * 라벨 조회 — 알 수 없는 값이 와도 화면이 깨지지 않게 키를 그대로 돌려준다.
 *
 * `t`를 파라미터로 받는다(PracticeScreen.tsx의 messageFor·
 * useLocViewModel.ts의 mapErrorToMessage와 같은 선례) — 이 함수는 여러
 * 컴포넌트가 공유하는 순수 함수라 자체적으로 훅을 쓸 수 없다.
 */
export function subtestLabel(
  subtest: string,
  t: (key: string) => string,
): string {
  const key = QAB_SUBTEST_LABELS[subtest as QabSubtest];
  return key ? t(key) : subtest;
}
