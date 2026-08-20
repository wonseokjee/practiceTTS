// 연습 문항 채점 — 문항 종류별 순수 함수 한 곳
//
// 검사 훅(useMixedQuizSession)은 submitDaily/submitQabChoice/submitNaming/
// submitSpeech/submitSpell/submitDdk 여섯 함수가 각각
// `guard → 채점 → push → applyResult` 골격을 복사하고 있다. 문항 종류가 늘 때마다
// 갈래가 하나씩 붙는 구조라, 연습 모드에서는 처음부터 채점만 떼어 둔다.
//
// 훅은 "어떤 값이 들어왔는가"만 알고, "그게 맞는가"는 여기서 답한다.

import type {
  PracticeItemKind,
  PracticePlayable,
  PracticeTier,
} from './Practice.js';

/**
 * 답을 채점한다.
 *
 * **연습 중엔 이 결과를 화면에 보여주지 않는다.** 그럼에도 채점하는 이유는
 * 터치 문항의 정오답이 결정적이라 공짜이고(선택지를 눌렀거나 아니거나),
 * 보호자 요약과 문항 난이도 조정의 근거가 되기 때문이다. 계산과 노출은
 * 별개다.
 *
 * 발화 계층(Tier 1)은 애초에 판정이 없으므로 이 함수를 거치지 않는다.
 */
export function scorePracticeAnswer(
  playable: PracticePlayable,
  value: string,
): boolean {
  switch (playable.kind) {
    case 'imageChoice': {
      const chosen = playable.item.choices.find((c) => c.choiceId === value);
      return chosen?.isCorrect ?? false;
    }
    case 'spell': {
      // 타일을 누른 순서가 곧 답이므로 발화 채점처럼 관대하게 볼 여지가 없다 —
      // 만든 글자가 목표와 같거나 다르다. 공백만 무시한다.
      const norm = (t: string): string => t.replace(/\s+/g, '');
      return norm(value) === norm(playable.item.targetWord);
    }
  }
}

/** 문항 종류 → 비용 계층. 지금은 전부 터치(0)다. */
const TIER_BY_KIND: Record<PracticeItemKind, PracticeTier> = {
  imageChoice: 0,
  wordChoice: 0,
  category: 0,
  oddOneOut: 0,
  arrange: 0,
  spell: 0,
  // 발화 계층. 채점 여부는 세션 구성이 정하므로 여기 값은 기본값이며,
  // Tier 2로 올릴 문항은 세션 조립에서 따로 지정한다(후속 작업).
  naming: 1,
  repeat: 1,
  reading: 1,
};

export function tierForKind(kind: PracticeItemKind): PracticeTier {
  return TIER_BY_KIND[kind];
}

/** 문항의 저장용 식별자. 백엔드 item_ref(varchar 100)로 그대로 간다. */
export function itemRefOf(playable: PracticePlayable): string {
  return playable.item.itemId;
}
