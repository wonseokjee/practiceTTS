/**
 * 퀴즈 출제 축 — 같은 메모에서도 날마다 다른 방향의 문제가 나오도록 돌린다.
 *
 * 환자의 하루는 단조로워 보호자 메모가 매일 비슷하다. 메모만 보고 출제하면
 * 같은 문제·같은 정답이 반복돼 말 꺼내기 연습이 아니라 답 외우기가 된다.
 * 축을 돌리면 "공원 산책" 하나로도 오늘은 무엇을, 내일은 어디서를 묻는다.
 *
 * '누구' 축은 없다 — 사람 이름은 페르소나 토큰([아들1])이 되는데 프롬프트가
 * 토큰을 정답으로 쓰지 못하게 막는다. 그 축은 정답을 만들 수 없다.
 *
 * FastAPI `/quiz/generate`의 `focus` 값과 1:1로 맞춘다.
 */
export const QUIZ_FOCUS_ROTATION = [
  'activity',
  'place',
  'object',
  'time',
] as const;

export type QuizFocus = (typeof QUIZ_FOCUS_ROTATION)[number];

/** 이 환자의 n번째 세트(0부터)가 쓸 출제 축. */
export function quizFocusFor(previousSetCount: number): QuizFocus {
  const n = Math.max(0, Math.floor(previousSetCount));
  return QUIZ_FOCUS_ROTATION[n % QUIZ_FOCUS_ROTATION.length];
}

/**
 * 최근 며칠의 문제를 "피할 문제"로 넘길지. ai-service는 이 안의 정답을 다시
 * 정답으로 쓰지 않는다.
 *
 * 짧게 둔다: 메모가 매일 같으면 새 사실(정답 후보)은 이틀이면 바닥난다. 7일로
 * 막으면 객관식이 사라지고 따라 말하기만 남는다. 며칠 지난 사실을 다시 묻는 건
 * 간격 반복이라 괜찮다 — 막을 것은 어제 그 문제다.
 */
export const RECENT_QUESTION_WINDOW_DAYS = 3;

/** 넘기는 최근 문제 수 상한 — 하루 5문항 × 3일(같은 날 재생성 여유 포함). */
export const MAX_RECENT_QUESTIONS = 20;
