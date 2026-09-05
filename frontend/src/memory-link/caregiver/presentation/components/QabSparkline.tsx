/**
 * 검사 하나의 주차별 성적을 보여주는 작은 추이선.
 *
 * 형태 선택: 전체 라인 차트가 아니라 **스탯 타일의 trend 요소**다. 보호자가
 * 답해야 할 질문은 "나아지고 있나?" 하나이고, 이 카드는 대시보드 안의 작은
 * 조각이라 축·격자를 갖춘 차트는 과하다.
 *
 * 색: 단일 계열이라 카테고리 팔레트가 아니다. 지난 주는 de-emphasis(`muted-sage`),
 * 이번 주만 강조색(`primary`)으로 띄운다.
 * `muted-disabled`(#9AA09B)를 쓰고 싶었지만 흰 배경 대비 2.67:1로 그래픽 객체
 * 기준(3:1)에 미달해 실측 후 `muted-sage`(#5C6661, 5.95:1)로 바꿨다.
 *
 * 색을 `stroke`/`fill` **속성**이 아니라 클래스로 주는 이유: SVG 표현 속성은
 * CSS 값이 아니라 `var(--color-muted-sage)`를 못 읽는다. Tailwind의
 * `stroke-*`·`fill-*` 유틸은 진짜 CSS 선언이라 토큰이 그대로 통한다.
 */

interface QabSparklineProps {
  /** 오래된 주부터. 2개 미만이면 아무것도 그리지 않는다. */
  values: number[];
  /** 접근성 설명. 그래프를 못 보는 사용자가 같은 정보를 얻어야 한다. */
  label: string;
}

const WIDTH = 72;
const HEIGHT = 20;
const PADDING = 3;

export function QabSparkline({ values, label }: QabSparklineProps) {
  // 점 하나로는 추세가 아니다. 억지로 그리면 정보가 없는 선만 남는다.
  if (values.length < 2) {
    return null;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1; // 전부 같은 값이면 가운데 수평선

  const points = values.map((value, index) => {
    const x =
      PADDING + (index / (values.length - 1)) * (WIDTH - PADDING * 2);
    const y =
      HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2);
    return { x, y };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      className="flex-shrink-0"
    >
      <path
        d={path}
        fill="none"
        className="stroke-muted-sage"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 이번 주 — 눈이 먼저 가야 하는 지점 */}
      <circle cx={last.x} cy={last.y} r={3} className="fill-primary" />
    </svg>
  );
}
