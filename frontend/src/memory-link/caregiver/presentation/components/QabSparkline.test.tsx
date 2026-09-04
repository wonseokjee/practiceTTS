import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QabSparkline } from './QabSparkline.js';

/**
 * 주차 추이 스파크라인 회귀 테스트.
 *
 * 배경: 추이 API가 전 기간을 하나로 합쳐서 "나아지고 있나"를 알 수 없었다.
 * 치매 진료는 "지난 몇 달 어떠셨어요?"로 시작하는데 보호자는 대개 기억으로
 * 답한다. 주 단위 기록을 보여주는 것이 이 컴포넌트의 목적이다.
 */
describe('QabSparkline', () => {
  it('점이 2개 미만이면 그리지 않는다', () => {
    // 한 점으로는 추세가 아니다. 억지로 그리면 정보 없는 선만 남는다.
    const { container } = render(<QabSparkline values={[50]} label="x" />);

    expect(container.querySelector('svg')).toBeNull();
  });

  it('추세를 그리고 접근성 설명을 남긴다', () => {
    // 그래프를 못 보는 사용자도 같은 정보를 얻어야 한다.
    render(
      <QabSparkline
        values={[30, 50, 70]}
        label="문장 이해 최근 3주 추이: 30, 50, 70%"
      />,
    );

    const svg = screen.getByRole('img', {
      name: '문장 이해 최근 3주 추이: 30, 50, 70%',
    });
    expect(svg).toBeTruthy();
  });

  it('모든 값이 같아도 깨지지 않는다', () => {
    // span이 0이면 0으로 나누게 된다.
    const { container } = render(
      <QabSparkline values={[50, 50, 50]} label="평탄" />,
    );

    const path = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(path).not.toContain('NaN');
  });

  it('이번 주 지점을 강조 색으로 표시한다', () => {
    // 눈이 먼저 가야 하는 지점이다.
    const { container } = render(
      <QabSparkline values={[30, 70]} label="추이" />,
    );

    const dot = container.querySelector('circle');
    expect(dot?.getAttribute('class')).toContain('fill-primary');
  });

  it('선 색이 흰 배경에서 그래픽 대비 3:1을 넘는다', () => {
    // #9AA09B(2.67:1)를 쓰려다 실측으로 걸러냈다. 고령 사용자 대상이라
    // 흐린 선은 아예 안 보인다.
    //
    // 색이 클래스로 옮겨간 뒤로 DOM에는 hex가 없다(jsdom은 Tailwind를 적용하지
    // 않는다). 그래서 **컴포넌트가 고른 토큰**과 **그 토큰의 실제 값** 둘을
    // 따로 확인한다. hex를 여기 베껴 적으면 index.css가 바뀌어도 통과하는
    // 죽은 테스트가 되므로, 값은 팔레트에서 읽는다.
    const { container } = render(
      <QabSparkline values={[30, 70]} label="추이" />,
    );

    const cls = container.querySelector('path')?.getAttribute('class') ?? '';
    expect(cls).toContain('stroke-muted');

    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
    const hex = /--color-muted:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(hex, 'index.css에 --color-muted가 있어야 한다').toBeTruthy();

    const luminance = (value: string): number => {
      const channels = [1, 3, 5]
        .map((i) => parseInt(value.substr(i, 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return (
        0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      );
    };
    const ratio = (1.0 + 0.05) / (luminance(hex as string) + 0.05);

    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
