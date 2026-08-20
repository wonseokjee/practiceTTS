/**
 * 연습 문항 종류.
 *
 * 검사의 subtest 축(qab-subtest.ts)과 일부러 분리한다. 검사는 "어느 소검사
 * 점수인가"를 세지만, 연습은 "무엇을 얼마나 연습했나"를 센다. 같은 이름을
 * 공유하면 두 테이블을 조인해 평균 내고 싶은 유혹이 생기는데, 그게 정확히
 * 이 모듈이 막으려는 오염이다.
 */
export const PRACTICE_ITEM_KINDS = [
  'imageChoice', // 듣고/읽고 → 그림 고르기 (터치)
  'wordChoice', // 듣고/보고 → 단어 고르기 (터치)
  'category', // 범주 분류 (터치)
  'oddOneOut', // 무리에서 빼기 (터치)
  'arrange', // 어순 맞추기 (터치)
  'spell', // 글자 조합 (터치)
  'naming', // 그림 보고 이름대기 (발화)
  'repeat', // 따라말하기 (발화)
  'reading', // 읽기 (발화)
] as const;

export type PracticeItemKind = (typeof PRACTICE_ITEM_KINDS)[number];

/** 비용 계층. 0 터치 / 1 발화·녹음만 / 2 발화·채점(Azure 1회). */
export const PRACTICE_TIERS = [0, 1, 2] as const;
export type PracticeTier = (typeof PRACTICE_TIERS)[number];
