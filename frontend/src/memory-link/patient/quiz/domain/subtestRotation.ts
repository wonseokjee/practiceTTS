// 하위검사 로테이션 — 하루에 세 검사만, 대신 검사당 세 문항.
//
// **왜 바꾸는가.** 예전 구성은 한 세션(11문항)에 일곱 하위검사를 모두 넣었다.
// 실측 수율은 이랬다:
//
//   daily 4.000 / word 1.556 / sentence 0.444 / naming·spell·repeat·reading·ddk 1.000
//
// 일곱 중 다섯이 **세션당 정확히 1문항**이다. 그러면 "같은 검사에서 2연속 틀리면
// 다음 문항을 내린다" 같은 세션 내 적응이 발동할 대상 자체가 없다. 다음 문항이
// 없기 때문이다. 매일 전 영역을 훑는 대신 하루 1비트만 얻고 있었다.
//
// **무엇을 포기하는가.** 매일 모든 영역을 보지는 못한다. 한 검사가 2~3일에 한 번
// 돌아오고, 그 사이의 변화는 관측되지 않는다. 이건 실제 손실이고, 그 대가로
// 검사가 나올 때 판정 표본이 1 → 3이 된다.
//
// **왜 요일 고정인가.** 무작위로 세 개를 고르면 보호자가 오늘 무엇을 할지 알 수
// 없다. 고정 순환이면 "오늘은 말하기 날"이 예측 가능해지고, 준비(안경·보청기·
// 조용한 시간)를 미리 할 수 있다.

import type { QabSubtest } from './QabResult.js';

/**
 * 순환 순서. 하루에 여기서 **연속 세 개**를 가져간다.
 *
 * 7과 3은 서로소라 7일이면 각 검사가 정확히 3번 나온다(21슬롯 ÷ 7검사).
 *
 * 순서는 임의가 아니다. 일곱 중 다섯(naming·spell·repeat·reading·ddk)이 발화
 * 산출 과제라 연속 세 칸이 전부 산출인 날을 완전히 피할 수는 없다. 이해 과제
 * (word·sentence)를 0번과 3번에 두면 **7일 중 6일**에 이해 과제가 최소 하나
 * 들어간다 — 이 배치가 가능한 최선이다.
 */
export const ROTATION_ORDER: readonly QabSubtest[] = [
  'word',
  'naming',
  'spell',
  'sentence',
  'repeat',
  'reading',
  'ddk',
];

/** 하루에 내는 하위검사 수. */
export const SUBTESTS_PER_SESSION = 3;

/**
 * 하위검사 하나당 문항 수.
 *
 * 3인 이유: 세션 내 적응이 "2연속 오답 → 내린다 / 3연속 정답 → 올린다"로 판정하는데,
 * 2문항이면 조정한 결과를 확인할 문항이 남지 않는다. 3이면 조정 후 한 번은 본다.
 */
export const ITEMS_PER_SUBTEST = 3;

/** 로컬 날짜 기준 일련 일수. 같은 날이면 같은 값, 자정에 1 오른다. */
export function dayNumber(date: Date = new Date()): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
}

/** 그날 낼 하위검사 세 개. 순환 순서에서 연속 세 칸을 가져온다. */
export function rotationForDay(day: number): QabSubtest[] {
  const n = ROTATION_ORDER.length;
  // 음수 일수(1970 이전)에서도 안전하도록 나머지를 양수로 접는다.
  const start = ((day * SUBTESTS_PER_SESSION) % n + n) % n;
  return Array.from(
    { length: SUBTESTS_PER_SESSION },
    (_, i) => ROTATION_ORDER[(start + i) % n],
  );
}

/** 오늘의 하위검사 세 개. */
export function rotationForToday(now: Date = new Date()): QabSubtest[] {
  return rotationForDay(dayNumber(now));
}

/** 그 검사가 오늘 몇 문항 나오는가 — 로테이션에 없으면 0. */
export function itemCountFor(
  subtest: QabSubtest,
  rotation: readonly QabSubtest[],
): number {
  return rotation.includes(subtest) ? ITEMS_PER_SUBTEST : 0;
}
