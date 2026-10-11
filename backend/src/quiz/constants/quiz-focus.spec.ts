import { QUIZ_FOCUS_ROTATION, quizFocusFor } from './quiz-focus';

describe('quizFocusFor', () => {
  it('세트마다 축을 차례로 돌고, 한 바퀴 뒤 처음으로 돌아온다', () => {
    const focuses = [0, 1, 2, 3, 4].map(quizFocusFor);
    expect(focuses).toEqual([...QUIZ_FOCUS_ROTATION, QUIZ_FOCUS_ROTATION[0]]);
  });

  it('연속한 두 세트는 축이 다르다', () => {
    for (let n = 0; n < 12; n += 1) {
      expect(quizFocusFor(n)).not.toBe(quizFocusFor(n + 1));
    }
  });

  it('음수·소수가 와도 첫 축으로 안전하게 고른다', () => {
    expect(quizFocusFor(-1)).toBe(QUIZ_FOCUS_ROTATION[0]);
    expect(quizFocusFor(1.7)).toBe(QUIZ_FOCUS_ROTATION[1]);
  });
});
