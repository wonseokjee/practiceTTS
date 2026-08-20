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

/**
 * 한 문항에서 허용하는 최대 시도 횟수.
 *
 * 3번 다 틀리면 정답을 알려주고 다음으로 간다. 선택지 수에 연동하는 안도
 * 검토했으나(마지막 시도에 항상 진짜 선택지 2개를 남기는 규칙) 규칙이 하나인
 * 편을 택했다. 2지선다는 오답 하나가 잠기면 2차에서 반드시 끝나므로 3에
 * 닿지 않는다 — 규칙은 같고 그 경우만 짧게 끝난다.
 */
export const MAX_PRACTICE_ATTEMPTS = 3;

/**
 * 재시도를 허용하는 문항인가.
 *
 * **터치(Tier 0)만이다.** 발화에 재시도를 붙이면 두 가지가 깨진다.
 *  - 비용: Tier 2 재시도 3회 = Azure 3회/문항. 세션 40→6 계산이 무너진다.
 *  - 정확도: 우리 ASR은 단어 CER 0.70이다. 맞게 말한 어르신에게 불확실한
 *    채점기가 "틀렸으니 다시"라고 말하는 상황이 생긴다.
 */
export function allowsRetry(playable: PracticePlayable): boolean {
  return tierForKind(playable.kind) === 0;
}

/**
 * 정답을 말로 알려줄 때 쓰는 문자열.
 *
 * 맞혔든 3번 틀렸든 문항은 정답을 본 채로 끝난다 — 틀린 연결이 굳는 것을
 * 막는 것이 연습의 목적이기 때문이다.
 */
export function correctAnswerLabelOf(playable: PracticePlayable): string {
  switch (playable.kind) {
    case 'imageChoice':
      return playable.item.choices.find((c) => c.isCorrect)?.label ?? '';
    case 'spell':
      return playable.item.targetWord;
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
