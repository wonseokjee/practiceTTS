// 낱말 고르기 — 그림을 보고 이름을 고른다
//
// **같은 문항을 뒤집어 낸다.** 그림고르기(imageChoice)는 낱말을 *듣고* 그림을
// 고른다. 낱말고르기는 그림을 *보고* 낱말을 고른다. 자극과 반응이 서로 바뀐
// 것뿐이라 새 콘텐츠가 한 톨도 필요 없다 — 뱅크가 이미 만들어 준 유인지
// (같은 범주 오답)를 그대로 쓴다.
//
// 임상적으로는 다른 능력을 건드린다. 그림고르기는 **듣기 이해**이고,
// 낱말고르기는 그림에서 이름을 되찾는 **어휘 인출**(재인 수준)이다. 실어증에서
// 둘은 자주 따로 논다. 덤으로 TTS가 죽어도 이 문항은 그대로 풀린다.
//
// Tier 0을 유지한다 — Azure를 부르지 않는다. 낱말을 소리로 읽어주면 그게 곧
// 정답이라 애초에 부를 수도 없다.

import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';

export interface PracticeWordChoiceOption {
  choiceId: string;
  label: string;
  isCorrect: boolean;
}

export interface PracticeWordChoiceItem {
  /**
   * 저장용 식별자.
   *
   * **접두사가 필수다.** `practice_results`의 UNIQUE는
   * (patient, session, item_ref, attempt)이고 item_kind가 들어 있지 않다.
   * 같은 낱말을 그림고르기와 낱말고르기로 한 세션에 내면서 ref를 공유하면,
   * 두 번째 시도가 ON CONFLICT DO NOTHING에 걸려 **조용히 사라진다.**
   * 글자조합이 `spell_` 접두사를 쓰는 것과 같은 이유다.
   */
  itemId: string;
  /** 보여줄 그림 — 정답 낱말의 것 */
  imageUrl: string;
  choices: PracticeWordChoiceOption[];
}

/** 낱말고르기 item_ref 접두사. */
export const WORD_CHOICE_REF_PREFIX = 'wc_';

/**
 * 그림고르기 문항을 낱말고르기로 뒤집는다.
 *
 * 문장이해 문항은 뒤집을 수 없다 — 선택지 라벨이 "고양이가 개를 쫓는 장면"
 * 같은 장면 서술이라 낱말로 고를 대상이 아니다. 호출자가 낱말 문항만
 * 넘기게 되어 있지만, 넘어오면 `null`로 돌려보내 조용히 이상한 문항이
 * 만들어지는 것을 막는다.
 */
export function toWordChoiceItem(
  source: QabImageItem,
): PracticeWordChoiceItem | null {
  if (source.category !== 'word') return null;
  const correct = source.choices.find((c) => c.isCorrect);
  if (!correct) return null;

  return {
    itemId: `${WORD_CHOICE_REF_PREFIX}${source.itemId}`,
    imageUrl: correct.imageUrl,
    // 선택지 순서는 뱅크가 이미 섞어 놨다. 여기서 또 섞으면 같은 문항이
    // 두 양식으로 나올 때 배치가 달라 보이는 이점이 사라진다 — 오히려
    // 같은 자리에 같은 낱말이 있는 편이 어르신에게 덜 혼란스럽다.
    choices: source.choices.map((c) => ({
      choiceId: c.choiceId,
      label: c.label,
      isCorrect: c.isCorrect,
    })),
  };
}
