// 보호자용 QAB 회복 추세 카드
//
// 환자가 데일리 퀴즈에서 푼 QAB 검사(단어/문장이해, 이름대기, 따라말하기, 읽기, 말운동)
// 결과를 검사별 정확도로 집계해 보여준다. "저장만 하고 안 보임"을 막는 가시성 화면.
// 데이터가 없으면(아직 검사 전) 카드를 숨긴다 — 대시보드를 비우지 않게.

import { useEffect, useState } from 'react';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { QabSubtestSummary } from '../../patient/quiz/domain/QabResult.js';

interface QabProgressCardProps {
  /** 요약 조회 함수 (테스트 주입용) */
  fetchSummary?: () => Promise<QabSubtestSummary[]>;
}

/** 검사 종류 → 한글 라벨 + 표시 순서 */
const SUBTEST_LABELS: Record<string, string> = {
  word: '단어 이해',
  sentence: '문장 이해',
  naming: '그림 이름대기',
  repeat: '따라 말하기',
  reading: '소리 내어 읽기',
  ddk: '말운동(퍼터커)',
};
const SUBTEST_ORDER = ['word', 'sentence', 'naming', 'repeat', 'reading', 'ddk'];

type LoadState = 'loading' | 'ready' | 'error';

export function QabProgressCard({ fetchSummary }: QabProgressCardProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<QabSubtestSummary[]>([]);

  useEffect(() => {
    let alive = true;
    const run = fetchSummary ?? quizApi.getQabSummary;
    run()
      .then((data) => {
        if (!alive) return;
        setItems(data);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [fetchSummary]);

  // 로딩/에러/빈 데이터는 카드 자체를 숨긴다(대시보드를 어지럽히지 않음).
  if (state !== 'ready' || items.length === 0) return null;

  const sorted = [...items].sort(
    (a, b) => SUBTEST_ORDER.indexOf(a.subtest) - SUBTEST_ORDER.indexOf(b.subtest),
  );

  return (
    <section
      className="mb-6 rounded-2xl border border-[#E5E5E0] bg-white p-5"
      aria-label="발화 검사 회복 추세"
    >
      <h2 className="mb-1 text-base font-bold text-[#1F2A26]">발화 검사 진행</h2>
      <p className="mb-4 text-sm text-[#5C6661]">
        환자분이 푼 검사별 정답률이에요. 꾸준히 오르는지 지켜봐 주세요.
      </p>

      <ul className="flex flex-col gap-3">
        {sorted.map((it) => {
          const label = SUBTEST_LABELS[it.subtest] ?? it.subtest;
          const assistedSuffix =
            it.assisted > 0 ? ` · 도움 ${it.assisted}회` : '';
          return (
            <li key={it.subtest} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-[#1F2A26]">
                  {label}
                </span>
                <span className="text-sm tabular-nums text-[#5C6661]">
                  {it.subtest === 'ddk' && it.maxMetric !== null ? (
                    <>최고 {it.maxMetric}회 · </>
                  ) : null}
                  {it.total > 0 ? (
                    <>
                      정답률{' '}
                      <span className="font-bold text-[#2D6A56]">
                        {it.accuracy}%
                      </span>{' '}
                      ({it.correct}/{it.total}){assistedSuffix}
                    </>
                  ) : (
                    // 환자 직접 응답이 아직 없고 도움만 있는 경우.
                    <>아직 직접 푼 기록 없음{assistedSuffix}</>
                  )}
                </span>
              </div>
              {/* 정답률 막대 (직접 응답이 있을 때만) */}
              {it.total > 0 && (
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-[#EBEAE6]"
                  role="progressbar"
                  aria-valuenow={it.accuracy}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label} 정답률 ${it.accuracy}%`}
                >
                  <div
                    className="h-full rounded-full bg-[#2D6A56] transition-[width] duration-[250ms] ease-in-out"
                    style={{ width: `${it.accuracy}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
