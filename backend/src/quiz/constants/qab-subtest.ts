/**
 * QAB(질문형) 발화/이해 검사 하위 종류.
 * 프론트에서 생성되는 QAB 문항의 출처를 분류해 회복 추적의 집계 단위로 쓴다.
 *  - word     : 단어이해(듣고 그림 고르기)
 *  - sentence : 문장이해(듣고 그림 고르기)
 *  - naming   : 그림 이름대기(보고 말하기)
 *  - repeat   : 따라말하기(듣고 따라 말하기)
 *  - reading  : 소리 내어 읽기(보고 읽기)
 *  - spell    : 글자 조합(정답 음절 + 방해 음절 타일을 눌러 단어 만들기)
 *  - ddk      : 말운동(음절 반복, metric=감지 횟수)
 *  - loc      : 의식 수준(소리 후 화면 터치 반응시간, score=0~3)
 *
 * loc는 성격이 조금 다르다. 문항별 정오답이 아니라 3회 시도의 반응시간으로
 * 0~3점을 매긴다. 그래서 매핑을 이렇게 둔다:
 *   - item_ref  : trial-1 / trial-2 / trial-3
 *   - is_correct: 반응이 있었는가(무반응이면 false) → 집계상 '반응률'이 된다
 *   - score     : 그 시도의 0~3점 → 집계상 '평균 점수'가 된다
 * 집계가 GROUP BY subtest라 다른 검사의 평균을 오염시키지 않는다.
 */
export const QAB_SUBTESTS = [
  'word',
  'sentence',
  'naming',
  'repeat',
  'reading',
  'spell',
  'ddk',
  'loc',
] as const;

export type QabSubtest = (typeof QAB_SUBTESTS)[number];

/**
 * 정적 QAB 문항 풀 매니페스트 버전. 프론트가 이 버전을 제출에 실어 보내고,
 * 백엔드는 GET /quiz/skill-levels로 현재 버전을 알린다. presented_level 해석이
 * 어느 문항 풀 기준인지 추적하기 위한 것으로, 풀(단어·문장·오답거리 등)이
 * 바뀔 때 수동으로 올린다.
 */
export const QAB_MANIFEST_VERSION = 1;
