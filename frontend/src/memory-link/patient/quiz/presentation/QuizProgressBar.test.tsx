// QuizProgressBar.tsx — 진행 표시 바 테스트
//
// 검증 포인트:
//  - role=progressbar + aria-valuenow/min/max
//  - "n / total" 텍스트
//  - 범위를 벗어난 current는 보정
//  - 점이 아니라 연속 막대 — 11문항에서 점 11개는 세어지지도, 읽히지도 않는다

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuizProgressBar } from './QuizProgressBar.js';

describe('QuizProgressBar', () => {
  it('role=progressbar와 aria 속성을 설정한다', () => {
    render(<QuizProgressBar current={3} total={5} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
  });

  it('"n / total" 텍스트를 표시한다', () => {
    render(<QuizProgressBar current={3} total={5} />);
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });

  it('문항 수만큼 점을 찍지 않는다 — 개수와 무관하게 한 덩어리다', () => {
    // 로테이션으로 세션이 11문항이 되면서 10px짜리 점 11개가 화면의 절반을
    // 썼다. 사람이 한눈에 세는 한계는 4~5개라, 그 개수에서는 낱개가 보이는
    // 장점도 사라진다.
    const { container: 다섯 } = render(<QuizProgressBar current={1} total={5} />);
    const { container: 열하나 } = render(
      <QuizProgressBar current={1} total={11} />,
    );
    const 자식수 = (c: HTMLElement) =>
      c.querySelector('[role="progressbar"]')!.children.length;

    expect(자식수(다섯)).toBe(1);
    expect(자식수(열하나)).toBe(1);
  });

  it('막대 길이가 진행을 따른다', () => {
    const { container } = render(<QuizProgressBar current={3} total={4} />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill).toHaveStyle({ width: '75%' });
  });

  it('current가 total을 초과하면 total로 보정한다', () => {
    render(<QuizProgressBar current={10} total={5} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '5',
    );
  });

  it('current가 1 미만이면 1로 보정한다', () => {
    render(<QuizProgressBar current={0} total={5} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
  });

  it('total이 0이면 1로 보정한다', () => {
    render(<QuizProgressBar current={1} total={0} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuemax',
      '1',
    );
  });
});
