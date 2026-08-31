/**
 * 단어이해 오답의 갈래.
 *
 * 실어증 단어-그림 대응 검사의 유인지는 두 종류이고 서로 **다른 손상**을 잡는다.
 * 의미 유인지('사과'에 대한 '바나나')는 의미 체계를, 음운 유인지('사과'에 대한
 * '사자')는 음운 처리를 건드린다. 정답률 하나로는 둘을 구분할 수 없다.
 *
 * 값은 프론트 문항 뱅크(`LEVEL_CHOICE_SPEC`·`buildControlledChoices`)가 오답을
 * **뽑는 자리에서** 정해 함께 보낸다. 낱말 뱅크가 프론트에 있어 서버는 되짚을 수
 * 없다 — 그래서 채점에 쓰지 않는다(관측 전용).
 */
export const QAB_FOIL_KINDS = [
  'semantic',
  'phonological',
  'unrelated',
] as const;

export type QabFoilKind = (typeof QAB_FOIL_KINDS)[number];
