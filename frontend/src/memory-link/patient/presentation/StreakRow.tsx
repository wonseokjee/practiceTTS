// 이번 주 연습 스트릭 (7일 점)
//
// 설계 확정(plan-design-review): 놓친 날은 **중립 빈 원**으로 — 빨강(--danger)·✗·
// 숫자 금지. 병·피로를 실패로 보이게 하지 않아 고령 인지장애 솔로 사용자의 복귀를
// 막지 않는다. 완료=세이지+체크, 오늘=primary-light 링, 미래=점선. 각 점에
// 스크린리더 라벨을 달아 시각 외 접근성도 확보한다.

import type { DayStatus, StreakDay } from '../domain/streak.js';

interface DotStyle {
  /** 원 컨테이너 className */
  circle: string;
  /** 원 안 표시(체크/오늘/빈칸) */
  content: string;
}

/** 상태별 원 스타일. danger 계열 색은 어디에도 쓰지 않는다. */
function dotStyle(status: DayStatus): DotStyle {
  switch (status) {
    case 'done':
      return { circle: 'bg-primary text-white', content: '✓' };
    case 'today-done':
      // 오늘이면서 완료 — 세이지 채움 + 오늘 링을 함께.
      return {
        circle: 'bg-primary text-white ring-2 ring-primary ring-offset-2 ring-offset-[#FFFFFF]',
        content: '✓',
      };
    case 'today':
      return {
        circle: 'bg-primary-light border-2 border-primary text-primary',
        content: '오늘',
      };
    case 'missed':
      // 중립: 테두리만. 빨강·✗ 없음.
      return { circle: 'border-2 border-line', content: '' };
    case 'future':
      return { circle: 'border-2 border-dashed border-line', content: '' };
  }
}

interface StreakRowProps {
  days: StreakDay[];
}

/** 이번 주 7일 스트릭 카드. */
export function StreakRow({ days }: StreakRowProps) {
  return (
    <section
      className="rounded-3xl border border-line bg-white p-6"
      aria-label="이번 주 연습"
    >
      <p className="mb-4 text-sm font-semibold text-muted">이번 주</p>
      <ol className="flex items-start justify-between" role="list">
        {days.map((day, i) => {
          const s = dotStyle(day.status);
          const isToday = day.status === 'today' || day.status === 'today-done';
          return (
            <li
              key={i}
              className="flex flex-col items-center gap-2"
              aria-label={day.ariaLabel}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${s.circle}`}
                aria-hidden="true"
              >
                {s.content}
              </span>
              <span
                className={`text-xs ${isToday ? 'font-bold text-primary' : 'text-muted'}`}
                aria-hidden="true"
              >
                {day.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
