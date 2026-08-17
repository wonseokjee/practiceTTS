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

/** 검사 종류 → 보호자에게 보여줄 한글 이름. */
export const QAB_SUBTEST_LABELS: Record<QabSubtest, string> = {
  loc: '의식 수준',
  word: '단어 이해',
  sentence: '문장 이해',
  naming: '그림 이름대기',
  repeat: '따라 말하기',
  reading: '소리 내어 읽기',
  spell: '글자 조합',
  ddk: '말운동(퍼터커)',
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
export const NON_LEVELED_SUBTESTS: readonly QabSubtest[] = ['loc'];

export const LEVELED_SUBTESTS: readonly QabSubtest[] = QAB_SUBTEST_ORDER.filter(
  (s) => !NON_LEVELED_SUBTESTS.includes(s),
);

/** 라벨 조회 — 알 수 없는 값이 와도 화면이 깨지지 않게 키를 그대로 돌려준다. */
export function subtestLabel(subtest: string): string {
  return QAB_SUBTEST_LABELS[subtest as QabSubtest] ?? subtest;
}
