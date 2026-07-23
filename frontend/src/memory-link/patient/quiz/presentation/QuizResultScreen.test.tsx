// QuizResultScreen.tsx — 퀴즈 결과 화면 테스트
//
// 검증 포인트:
//  - 점수/라벨/최고점 표시
//  - isNewBest일 때 축하 배지 노출
//  - "다시 풀기"/"목록으로" 버튼 콜백

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuizResultScreen } from './QuizResultScreen.js';

interface Overrides {
  sessionScore?: number;
  bestScore?: number | null;
  isNewBest?: boolean;
  showScore?: boolean;
}

function renderResult(overrides?: Overrides) {
  const onRetry = vi.fn();
  const onBackToList = vi.fn();
  render(
    <QuizResultScreen
      sessionScore={overrides?.sessionScore ?? 80}
      bestScore={overrides?.bestScore ?? null}
      isNewBest={overrides?.isNewBest ?? false}
      showScore={overrides?.showScore ?? true}
      onRetry={onRetry}
      onBackToList={onBackToList}
    />,
  );
  return { onRetry, onBackToList };
}

describe('QuizResultScreen', () => {
  it('세션 점수와 구간 라벨을 표시한다', () => {
    renderResult({ sessionScore: 100 });
    expect(screen.getByText('100점')).toBeInTheDocument();
    expect(screen.getByText('완벽해요!')).toBeInTheDocument();
  });

  it('isNewBest이면 새 최고 기록 배지를 노출한다', () => {
    renderResult({ isNewBest: true });
    expect(screen.getByText('새 최고 기록이에요!')).toBeInTheDocument();
  });

  it('isNewBest가 아니면 축하 배지를 노출하지 않는다', () => {
    renderResult({ isNewBest: false });
    expect(screen.queryByText('새 최고 기록이에요!')).not.toBeInTheDocument();
  });

  it('bestScore가 있으면 최고점을 표시한다', () => {
    renderResult({ sessionScore: 80, bestScore: 90 });
    expect(screen.getByText('최고점 90점')).toBeInTheDocument();
  });

  it('무점수 모드(showScore=false)는 숫자·최고점을 숨기고 완료 격려만 표시한다', () => {
    renderResult({ sessionScore: 80, bestScore: 90, showScore: false });
    expect(screen.queryByText('80점')).not.toBeInTheDocument();
    expect(screen.queryByText('최고점 90점')).not.toBeInTheDocument();
    expect(screen.getByText('오늘도 끝까지 잘 하셨어요!')).toBeInTheDocument();
    // 버튼은 그대로 동작
    expect(screen.getByRole('button', { name: '다시 풀기' })).toBeInTheDocument();
  });

  it('"다시 풀기" 클릭 시 onRetry가 호출된다', () => {
    const { onRetry } = renderResult();
    fireEvent.click(screen.getByRole('button', { name: '다시 풀기' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('"목록으로" 클릭 시 onBackToList가 호출된다', () => {
    const { onBackToList } = renderResult();
    fireEvent.click(screen.getByRole('button', { name: '퀴즈 목록으로' }));
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });
});
