/**
 * 글자(음절) 타일 생성기 (tile_arrange 유형용).
 *
 * 정답을 음절 단위로 분해한 뒤, 정답에 없는 오답 음절(distractor)을 섞어
 * 셔플된 타일 배열을 만든다. 환자는 이 타일을 탭해 정답 단어를 조합한다.
 *
 * - 정답 음절은 중복을 보존한다 (예: '바나나' → '바','나','나').
 * - 채점은 fill_blank 규칙(공백 제거 + 끝 음절 받침 무시)을 재사용하므로
 *   타일 순서/공백은 채점에 영향을 주지 않는다.
 * - 정답(correctAnswer) 자체는 타일 배열로부터 역산하기 어렵게 셔플되며,
 *   public DTO는 choices(타일)만 노출하고 correctAnswer는 은닉한다.
 */

/** 오답 타일 후보 풀 (받침 유무가 섞인 흔한 한글 음절) */
const DISTRACTOR_POOL: readonly string[] = [
  '가', '나', '다', '라', '마', '바', '사', '아', '자', '하',
  '고', '노', '도', '로', '모', '보', '소', '오', '조', '호',
  '구', '누', '두', '루', '무', '부', '수', '우', '주', '후',
  '강', '산', '물', '불', '집', '길', '밤', '낮', '봄', '꽃',
];

/** 기본 오답 타일 개수 */
const DEFAULT_DISTRACTOR_COUNT = 3;
/** 타일 총 개수 상한 (UI 가독성) */
const MAX_TILES = 8;

/** Fisher-Yates 셔플 (원본 불변, 새 배열 반환). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 정답 텍스트로부터 타일 배열을 만든다.
 *
 * @param correctAnswer 정답 단어/구 (공백은 제거 후 음절 분해)
 * @param distractorCount 추가할 오답 음절 개수 (기본 3, 총 타일은 MAX_TILES로 제한)
 * @param rng 셔플용 난수 함수 (테스트 주입용, 기본 Math.random)
 * @returns 셔플된 타일 배열 (정답 음절이 비면 빈 배열)
 */
export function buildTiles(
  correctAnswer: string,
  distractorCount: number = DEFAULT_DISTRACTOR_COUNT,
  rng: () => number = Math.random,
): string[] {
  const answerSyllables = Array.from(correctAnswer.replace(/\s+/g, ''));
  if (answerSyllables.length === 0) {
    return [];
  }

  const answerSet = new Set(answerSyllables);
  const allowedDistractors = Math.max(
    0,
    Math.min(distractorCount, MAX_TILES - answerSyllables.length),
  );

  const distractors = shuffle(
    DISTRACTOR_POOL.filter((s) => !answerSet.has(s)),
    rng,
  ).slice(0, allowedDistractors);

  return shuffle([...answerSyllables, ...distractors], rng);
}
