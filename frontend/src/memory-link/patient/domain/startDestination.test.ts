import { describe, expect, it } from 'vitest';
import { startDestination } from './startDestination.js';

const set = (id: string) => ({ quizSetId: id });

describe('startDestination', () => {
  it('하나면 바로 그 퀴즈로 간다 — 고르라고 하지 않는다', () => {
    // 버튼에 "시작하기"라고 적어놓고 고르는 화면을 내면 라벨이 어긋난다.
    expect(startDestination([set('q1')])).toEqual({
      kind: 'quiz',
      quizSetId: 'q1',
    });
  });

  it('여럿이면 목록으로 간다 — 그때는 고를 것이 실제로 있다', () => {
    expect(startDestination([set('q1'), set('q2')])).toEqual({ kind: 'list' });
  });

  it('아직 모르면 목록으로 간다 — 홈에서 멈춰 세우지 않는다', () => {
    // null은 "조회 전이거나 실패"다. 목록 화면이 다시 조회하고 오류도 거기서
    // 보여준다. 큰 버튼을 눌렀는데 아무 일도 안 일어나는 것이 제일 나쁘다.
    expect(startDestination(null)).toEqual({ kind: 'list' });
  });

  it('하나도 없으면 목록으로 간다 — 빈 상태 문구가 거기 있다', () => {
    // "보호자가 일기를 등록하면 퀴즈가 도착해요"를 목록 화면이 말한다.
    expect(startDestination([])).toEqual({ kind: 'list' });
  });
});
