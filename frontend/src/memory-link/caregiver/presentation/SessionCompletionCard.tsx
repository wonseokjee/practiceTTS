// 보호자용 연습 마무리(세션 완료율) 카드
//
// 정답률만 보면 "얼마나 잘했나"는 알아도 "끝까지 갔나"는 모른다. 중간에 화면을
// 닫은 연습은 결과가 일부만 남아 정답률이 오히려 좋아 보이기도 한다. 이 카드는
// 그 구멍을 메운다 — 시작한 연습 중 끝까지 마친 비율과, 그만둘 때 평균 몇
// 문항까지 갔는지.
//
// SkillLevelCard와 같은 원칙: 성적표가 아니라 방향이다. 낮은 완료율에 경고색을
// 칠하지 않는다 — 환자가 게을러서가 아니라 연습이 길거나 어려웠다는 신호다.

import { useEffect, useState } from 'react';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { SessionStats } from '../../patient/quiz/domain/QabResult.js';

interface SessionCompletionCardProps {
  /** 통계 조회 함수(테스트 주입용). 없으면 quizApi.getSessionStats. */
  fetchStats?: () => Promise<SessionStats>;
}

/** 카드가 집계하는 기간(일). 보호자 대시보드는 최근 한 달을 본다. */
const WINDOW_DAYS = 30;

type LoadState = 'loading' | 'ready' | 'error';

export function SessionCompletionCard({
  fetchStats,
}: SessionCompletionCardProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [stats, setStats] = useState<SessionStats | null>(null);

  useEffect(() => {
    let alive = true;
    const run = fetchStats ?? (() => quizApi.getSessionStats(WINDOW_DAYS));
    run()
      .then((data) => {
        if (!alive) return;
        setStats(data);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [fetchStats]);

  // 로딩·에러는 카드를 숨긴다(대시보드를 어지럽히지 않음).
  if (state !== 'ready' || stats === null) return null;
  // 연습 기록이 아직 없으면 0%를 띄우지 않는다 — 시작도 안 한 보호자에게
  // 실패한 것처럼 보인다.
  if (stats.started === 0 || stats.completionRate === null) return null;

  const rate = Math.round(stats.completionRate);

  return (
    <section
      className="mb-6 rounded-2xl border border-[#E5E5E0] bg-white p-5"
      aria-label="연습 마무리"
    >
      <h2 className="mb-1 text-base font-bold text-[#1F2A26]">연습 마무리</h2>
      <p className="mb-4 text-sm text-[#5C6661]">
        시작한 연습 중 끝까지 마친 비율이에요. 중간에 그만둔 연습도 푼 문항까지는
        기록에 남아 있어요.
      </p>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-[#2D6A56]">
          {rate}%
        </span>
        <span className="text-sm text-[#5C6661]">
          최근 {WINDOW_DAYS}일 · 시작 {stats.started}회 중 {stats.completed}회
          완료
        </span>
      </div>

      {/* 진행 막대. 상태색 없이 세이지 한 색만 쓴다(등급이 아니라 비율). */}
      <div
        className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[#EDEEEA]"
        role="img"
        aria-label={`완료율 ${rate}퍼센트`}
      >
        <div
          className="h-full rounded-full bg-[#2D6A56] transition-[width] duration-[250ms] ease-in-out"
          style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
        />
      </div>

      {stats.avgItemsBeforeDropoff !== null && (
        <p className="mb-2 text-sm text-[#5C6661]">
          중간에 그만둔 연습은 평균{' '}
          <span className="font-medium tabular-nums text-[#1F2A26]">
            {stats.avgItemsBeforeDropoff}문항
          </span>
          까지 진행했어요. 자꾸 비슷한 지점에서 멈춘다면 그때쯤 힘들어진다는
          뜻이에요.
        </p>
      )}

      {/* 스트릭과 기준이 다르다. 같은 화면에서 숫자가 어긋나 보이면 보호자가
          어느 쪽을 믿을지 몰라 한다 — 먼저 밝혀 둔다. */}
      <p className="text-xs text-[#8A918C]">
        환자 홈의 &lsquo;연습한 날&rsquo;은 한 문항이라도 푼 날을 세요. 여기
        완료율과는 기준이 달라요.
      </p>
    </section>
  );
}
