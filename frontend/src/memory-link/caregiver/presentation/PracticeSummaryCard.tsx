// 보호자용 '가볍게 연습하기' 카드 — 최근 7일에 한 양과 첫 시도 정답률.
//
// 2026-10-10 사용자 결정으로 연습 정답률을 보호자에게 보여주기로 했다. 그전에는
// "집계가 보이는 순간 연습이 시험이 된다"며 저장만 했고, 보호자는 어르신이 연습을
// 했는지조차 몰랐다(로컬 테스트 피드백: "가볍게 연습하기는 기록되지 않네").
//
// 검사 점수와 섞이지 않게 두 가지를 지킨다.
// - 제목을 환자 화면의 버튼 이름("가볍게 연습하기")과 같게 해 검사 카드와 구분한다.
// - 연습은 쉬운 단계까지만 나온다는 점을 카드 안에 적는다 — 같은 퍼센트라도
//   검사 점수와 비교할 수 없다.
// 다른 보호자 카드와 같이 경고색을 쓰지 않는다. 낮은 정답률은 성적이 아니라 방향이다.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  practiceApi,
  type PracticeSummary,
} from '../../patient/practice/infrastructure/PracticeApi.js';

/** 카드가 집계하는 기간(일). */
const WINDOW_DAYS = 7;

interface PracticeSummaryCardProps {
  /** 조회 함수(테스트 주입용). 없으면 practiceApi.getSummary. */
  fetchSummary?: (days: number) => Promise<PracticeSummary>;
}

type LoadState = 'loading' | 'ready' | 'error';

export function PracticeSummaryCard({ fetchSummary }: PracticeSummaryCardProps) {
  const { t } = useTranslation('caregiver');
  const [state, setState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<PracticeSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const run = fetchSummary ?? ((d: number) => practiceApi.getSummary(d));
    run(WINDOW_DAYS)
      .then((data) => {
        if (!alive) return;
        setSummary(data);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [fetchSummary]);

  // 로딩·오류는 카드를 숨긴다(대시보드를 어지럽히지 않음).
  if (state !== 'ready' || summary === null) return null;
  // 연습을 안 했으면 0%를 띄우지 않는다 — 시작도 안 한 것이 실패처럼 보인다.
  if (summary.items === 0) return null;

  const rate =
    summary.firstTry.rate === null ? null : Math.round(summary.firstTry.rate * 100);
  const judgedKinds = summary.byKind.filter((k) => k.judged > 0);

  return (
    <section
      className="mb-6 rounded-2xl border border-line-soft bg-white p-5"
      aria-label={t('practiceSummary.sectionAria')}
    >
      <h2 className="mb-1 text-base font-bold text-ink-sage">
        {t('practiceSummary.title')}
      </h2>
      <p className="mb-4 text-sm text-muted-sage">
        {t('practiceSummary.amount', {
          days: WINDOW_DAYS,
          sessions: summary.sessions,
          items: summary.items,
        })}
      </p>

      {rate !== null && (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-primary">
              {rate}%
            </span>
            <span className="text-sm text-muted-sage">
              {t('practiceSummary.firstTryLabel', {
                correct: summary.firstTry.correct,
                judged: summary.firstTry.judged,
              })}
            </span>
          </div>
          <div
            className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-dim"
            role="img"
            aria-label={t('practiceSummary.progressAria', { rate })}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-[250ms] ease-in-out"
              style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
            />
          </div>

          {judgedKinds.length > 1 && (
            <ul className="mb-4 space-y-1.5">
              {judgedKinds.map((k) => (
                <li
                  key={k.kind}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-ink-sage">{t(`practiceSummary.kind.${k.kind}`)}</span>
                  <span className="tabular-nums text-muted-sage">
                    {t('practiceSummary.kindScore', {
                      correct: k.correct,
                      judged: k.judged,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-xs text-muted-sage">{t('practiceSummary.disclaimer')}</p>
    </section>
  );
}
