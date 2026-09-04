// StreakRow 렌더 테스트 — 설계 확정(놓친날 중립·danger 금지·접근성) 검증
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StreakRow } from './StreakRow.js';
import { buildWeekStreak } from '../domain/streak.js';

const WED = new Date(2026, 7, 12); // 수요일

describe('StreakRow', () => {
  it('7일 점을 렌더하고 각 점에 스크린리더 라벨을 단다', () => {
    const days = buildWeekStreak(new Set(), WED);
    const { getByLabelText, getAllByRole } = render(<StreakRow days={days} />);
    // 놓친 날 aria('쉼')·오늘 aria가 접근 가능
    expect(getByLabelText('화요일 쉼')).toBeTruthy();
    expect(getByLabelText('오늘')).toBeTruthy();
    // 7개 항목
    expect(getAllByRole('listitem')).toHaveLength(7);
  });

  it('어디에도 danger 색·✗·"실패"를 쓰지 않는다', () => {
    // 지난 날 대부분 놓친 최악의 케이스에서도 부정 신호가 없어야 한다.
    const days = buildWeekStreak(new Set(), new Date(2026, 7, 16)); // 일요일 → 월~토 놓침
    const { container } = render(<StreakRow days={days} />);
    const html = container.innerHTML;
    // `danger`·`danger-ink`·`danger-soft`를 한 번에 막는다.
    expect(html).not.toContain('danger');
    expect(html).not.toContain('✗');
    expect(html).not.toContain('실패');
  });

  it('완료한 날은 체크(✓)를 보여준다', () => {
    const days = buildWeekStreak(
      new Set([new Date(2026, 7, 10).toString().slice(0, 0) || '2026-08-10']),
      WED,
    );
    const { container } = render(<StreakRow days={days} />);
    expect(container.innerHTML).toContain('✓');
  });

  it('"N일 연속" 같은 압박 숫자를 렌더하지 않는다', () => {
    const days = buildWeekStreak(new Set(['2026-08-10', '2026-08-11']), WED);
    const { container } = render(<StreakRow days={days} />);
    expect(container.textContent ?? '').not.toMatch(/\d+\s*일\s*연속/);
  });
});
