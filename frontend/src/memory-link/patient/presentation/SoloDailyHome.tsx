// 솔로 일일 홈 — 혼자 매일 하는 적응형 연습의 진입 화면
//
// 설계 확정(plan-design-review): 화면에서 두드러지는 것은 **단일 거대 CTA** 하나뿐.
// 위계는 인사 < 스트릭 < CTA(앵커). 목록·설정은 부차 링크로 밀어 인지부하를
// 최소화한다. "지난번에 이어서" 문구로 시작 마찰을 줄인다. 레벨·강등은 환자에게
// 절대 노출하지 않는다(강등 완전 비가시).
//
// 와이어프레임: ~/.gstack/projects/wonseokjee-practiceTTS/designs/solo-daily-home-20260813/

import type { StreakDay } from '../domain/streak.js';
import { StreakRow } from './StreakRow.js';

interface SoloDailyHomeProps {
  /** 인사에 쓸 이름(존칭 포함 문자열). 없으면 이름 없이 인사. */
  greetingName?: string | null;
  /** 이번 주 스트릭 7일. */
  streakDays: StreakDay[];
  /** 이어서 하는 세션이면 true → CTA 보조 문구가 "이어서". */
  hasResumable?: boolean;
  /** 오늘 연습 시작. */
  onStart: () => void;
  /** 부차 링크 — 이번 주 돌아보기(대시보드/목록). 없으면 렌더 안 함. */
  onReview?: () => void;
  /**
   * 부차 링크 — 연습 모드(터치 중심, 판정 없음). 없으면 렌더 안 함.
   *
   * 거대 CTA(onStart)는 기존 검사 흐름 그대로 둔다. 연습이 일일 기본이 되는지는
   * 실제로 써보고 정할 일이라, 지금은 나란히 놓고 고를 수 있게만 한다.
   */
  onPractice?: () => void;
}

/** 솔로 일일 홈 화면. */
export function SoloDailyHome({
  greetingName,
  streakDays,
  hasResumable = false,
  onStart,
  onReview,
  onPractice,
}: SoloDailyHomeProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-6 pt-8">
      {/* 인사 (위계 최하) */}
      <h1 className="text-2xl font-bold leading-snug text-[#1A1916]">
        {greetingName ? (
          <>
            {greetingName},<br />
            <span className="text-[#2D6A56]">오늘도 반가워요.</span>
          </>
        ) : (
          <span className="text-[#2D6A56]">오늘도 반가워요.</span>
        )}
      </h1>
      <p className="mt-2 text-base text-[#6B6560]">
        오늘 연습, 3~5분이면 충분해요.
      </p>

      {/* 스트릭 (위계 중간) */}
      <div className="mt-8">
        <StreakRow days={streakDays} />
      </div>

      {/* 단일 거대 CTA (앵커 — 화면에서 유일하게 두드러짐) */}
      <button
        type="button"
        onClick={onStart}
        className="mt-8 flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-3xl bg-[#2D6A56] px-6 text-2xl font-bold text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] active:scale-[0.98]"
        aria-label="오늘 연습 시작하기"
      >
        <span aria-hidden="true" className="text-4xl">
          ▶
        </span>
        오늘 연습 시작하기
        <span className="text-sm font-normal opacity-90">
          {hasResumable ? '지난번에 이어서 해요' : '오늘 치 연습을 시작해요'}
        </span>
      </button>

      {/* 부차 링크 (작게) */}
      {(onReview ?? onPractice) && (
        <div className="mt-5 flex flex-col items-center gap-1 text-center">
          {onPractice && (
            <button
              type="button"
              onClick={onPractice}
              className="inline-block px-4 py-2 text-base text-[#6B6560] transition-colors duration-[180ms] ease-out hover:text-[#1A1916]"
            >
              가볍게 연습하기
            </button>
          )}
          {onReview && (
            <button
              type="button"
              onClick={onReview}
              className="inline-block px-4 py-2 text-base text-[#6B6560] transition-colors duration-[180ms] ease-out hover:text-[#1A1916]"
            >
              이번 주 돌아보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
