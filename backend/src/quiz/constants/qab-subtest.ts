/**
 * QAB(질문형) 발화/이해 검사 하위 종류.
 * 프론트에서 생성되는 QAB 문항의 출처를 분류해 회복 추적의 집계 단위로 쓴다.
 *  - word     : 단어이해(듣고 그림 고르기)
 *  - sentence : 문장이해(듣고 그림 고르기)
 *  - naming   : 그림 이름대기(보고 말하기)
 *  - repeat   : 따라말하기(듣고 따라 말하기)
 *  - reading  : 소리 내어 읽기(보고 읽기)
 *  - ddk      : 말운동(음절 반복, metric=감지 횟수)
 */
export const QAB_SUBTESTS = [
  'word',
  'sentence',
  'naming',
  'repeat',
  'reading',
  'ddk',
] as const;

export type QabSubtest = (typeof QAB_SUBTESTS)[number];
