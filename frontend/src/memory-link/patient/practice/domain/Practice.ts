// 연습 모드 도메인 타입
//
// **검사(quiz)와 문항 콘텐츠는 공유하고, 결과는 공유하지 않는다.**
//
// 같은 낱말·같은 그림·같은 유인지 생성기를 쓰는 것은 낭비를 없애는 일이지만,
// 결과가 같은 통에 담기면 연습(세션당 40문항)이 검사(13문항)를 3:1로 압도해
// 연습 성적이 곧 환자의 측정값이 된다. 경계는 **문항이 아니라 결과**에 있다.
// (백엔드도 같은 이유로 practice_results 테이블을 따로 둔다.)

import type {
  QabImageItem,
  QabSpellItem,
} from '../../quiz/domain/MixedQuiz.js';

/**
 * 비용 계층. 문항 하나가 Azure를 몇 번 부르는지가 곧 계층이다.
 *
 *  0  터치 — 호출 없음
 *  1  발화하되 채점 안 함 — 호출 없음 (연습 중엔 판정을 안 보여주므로,
 *     안 보여줄 판정을 얻자고 호출할 이유가 없다)
 *  2  발화 + 채점 — 1회
 *
 * 세션당 40회를 6회로 줄인 것이 연습 모드 재설계의 근거다.
 */
export type PracticeTier = 0 | 1 | 2;

/** 연습 문항 종류. 백엔드 PRACTICE_ITEM_KINDS와 값이 일치해야 한다. */
export type PracticeItemKind =
  | 'imageChoice'
  | 'wordChoice'
  | 'category'
  | 'oddOneOut'
  | 'arrange'
  | 'spell'
  | 'naming'
  | 'repeat'
  | 'reading';

/**
 * 연습에서 순서대로 푸는 단일 문항.
 *
 * 현재는 Tier 0(터치)만 있다. 발화 계층과 단서 층은 후속 작업이며, 그때
 * 이 유니온에 항목이 붙는다.
 */
export type PracticePlayable =
  | { kind: 'imageChoice'; id: string; item: QabImageItem }
  | { kind: 'spell'; id: string; item: QabSpellItem };

/** 백엔드 POST /practice/results가 받는 시도 1건. */
export interface PracticeAttemptInput {
  itemKind: PracticeItemKind;
  itemRef: string;
  /**
   * 같은 문항의 몇 번째 시도인가(1부터). 생략하면 1.
   * 단서를 받고 다시 시도하면 2 — 앞 시도를 덮어쓰지 않는다.
   */
  attempt?: number;
  /**
   * 정오답. **생략이 정상이다.** Tier 1은 판정 자체가 존재하지 않는다.
   * 여기서 false로 접으면 채점하지 않은 발화가 전부 실패로 기록된다.
   */
  isCorrect?: boolean;
  tier: PracticeTier;
}
