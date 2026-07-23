// QuizProgressBar.tsx — 진행 표시 바 테스트
//
// 검증 포인트:
//  - role=progressbar + aria-valuenow/min/max
//  - "n / total" 텍스트
//  - 범위를 벗어난 current는 보정

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
