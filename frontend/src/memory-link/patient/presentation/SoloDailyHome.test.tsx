// SoloDailyHome 렌더 테스트 — 단일 CTA·강등 비가시·부차링크·이어서 문구
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SoloDailyHome } from './SoloDailyHome.js';
import { buildWeekStreak } from '../domain/streak.js';

const days = buildWeekStreak(new Set(['2026-08-10']), new Date(2026, 7, 12));

describe('SoloDailyHome', () => {
  it('오늘 연습 시작 CTA를 누르면 onStart 호출', () => {
    const onStart = vi.fn();
    const { getByLabelText } = render(
      <SoloDailyHome greetingName="김순자 님" streakDays={days} onStart={onStart} />,
    );
    fireEvent.click(getByLabelText('오늘 연습 시작하기'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('이어서 가능하면 "이어서" 문구, 아니면 오늘치 문구', () => {
    const { getByText, rerender } = render(
      <SoloDailyHome streakDays={days} hasResumable onStart={vi.fn()} />,
    );
    expect(getByText('지난번에 이어서 해요')).toBeTruthy();
    rerender(<SoloDailyHome streakDays={days} onStart={vi.fn()} />);
    expect(getByText('오늘 치 연습을 시작해요')).toBeTruthy();
  });

  it('레벨/강등 신호를 환자에게 노출하지 않는다(강등 완전 비가시)', () => {
    const { container } = render(
      <SoloDailyHome greetingName="김순자 님" streakDays={days} onStart={vi.fn()} />,
    );
    const text = container.textContent ?? '';
    // 레벨 숫자·"레벨"·"단계"·강등 어휘가 화면에 없어야 한다.
    expect(text).not.toMatch(/레벨|단계|난이도|강등|내려/);
  });

  it('부차 링크는 onReview가 있을 때만 렌더', () => {
    const onReview = vi.fn();
    const { queryByText, getByText, rerender } = render(
      <SoloDailyHome streakDays={days} onStart={vi.fn()} />,
    );
    expect(queryByText('이번 주 돌아보기')).toBeNull();
    rerender(
      <SoloDailyHome streakDays={days} onStart={vi.fn()} onReview={onReview} />,
    );
    fireEvent.click(getByText('이번 주 돌아보기'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('이름이 없으면 이름 없이 인사한다', () => {
    const { container } = render(
      <SoloDailyHome streakDays={days} onStart={vi.fn()} />,
    );
    expect(container.textContent).toContain('오늘도 반가워요.');
  });
});
