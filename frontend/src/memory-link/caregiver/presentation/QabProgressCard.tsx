// 보호자용 QAB 회복 추세 카드
//
// 환자가 데일리 퀴즈에서 푼 QAB 검사(단어/문장이해, 이름대기, 따라말하기, 읽기, 말운동)
// 결과를 검사별 정확도로 집계해 보여준다. "저장만 하고 안 보임"을 막는 가시성 화면.
// 데이터가 없으면(아직 검사 전) 카드를 숨긴다 — 대시보드를 비우지 않게.

import { useEffect, useState } from 'react';
import { QabSparkline } from './components/QabSparkline.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type {
  QabSubtestSummary,
  QabTrendSeries,
} from '../../patient/quiz/domain/QabResult.js';

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
  loc: '의식 수준',
};
const SUBTEST_ORDER = [
  'loc',
  'word',
  'sentence',
  'naming',
  'repeat',
  'reading',
  'ddk',
];

/**
 * loc는 다른 검사와 지표의 의미가 다르다.
 *  - accuracy: 정답률이 아니라 **반응률**(무반응이 아닌 시도 비율)
 *  - avgScore: 발음 점수가 아니라 **의식 수준 점수**(0~3)
 * 같은 말로 표기하면 보호자가 오해한다 — 발음 검사가 아닌데 "발음 0점"이
 * 뜨는 식이다.
 */
const IS_REACTION_BASED = (subtest: string): boolean => subtest === 'loc';

type LoadState = 'loading' | 'ready' | 'error';

export function QabProgressCard({ fetchSummary }: QabProgressCardProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<QabSubtestSummary[]>([]);
  // 주차 추이. 실패해도 카드 전체를 죽이지 않는다 — 요약만으로도 쓸모가 있다.
  const [trend, setTrend] = useState<Map<string, QabTrendSeries>>(new Map());

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
    void quizApi
      .getQabTrend()
      .then((series) => {
        if (!alive) return;
        setTrend(new Map(series.map((x) => [x.subtest, x])));
      })
      .catch(() => {
        // 추이는 부가 정보다. 없으면 요약만 보여준다.
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
                <span className="flex items-center gap-2 text-sm font-medium text-[#1F2A26]">
                  {label}
                  <WeeklyTrend series={trend.get(it.subtest)} label={label} />
                </span>
                <span className="text-sm tabular-nums text-[#5C6661]">
                  {it.subtest === 'ddk' && it.maxMetric !== null ? (
                    <>최고 {it.maxMetric}회 · </>
                  ) : null}
                  {it.total > 0 ? (
                    <>
                      {IS_REACTION_BASED(it.subtest) ? '반응률' : '정답률'}{' '}
                      <span className="font-bold text-[#2D6A56]">
                        {it.accuracy}%
                      </span>{' '}
                      ({it.correct}/{it.total}){assistedSuffix}
                      {/* 발화 항목은 발음 정확도(0~100), loc는 의식 수준 점수(0~3) */}
                      {it.avgScore !== null && (
                        <>
                          {IS_REACTION_BASED(it.subtest)
                            ? ' · 평균 '
                            : ' · 발음 '}
                          <span className="font-bold text-[#2D6A56]">
                            {it.avgScore}점
                            {IS_REACTION_BASED(it.subtest) ? ' / 3' : ''}
                          </span>
                        </>
                      )}
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
                  aria-label={`${label} ${IS_REACTION_BASED(it.subtest) ? "반응률" : "정답률"} ${it.accuracy}%`}
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

// ─── 주차 추이 ──────────────────────────────────────────────────

/**
 * 검사 하나의 주차 추이 — 스파크라인 + 직전 검사 주 대비 변화.
 *
 * 델타를 상태색(빨강/초록)으로 칠하지 않는다. 의도적인 선택이다.
 *
 * 이 수치는 주당 문항 10~20개에서 나온 값이라 주간 변동이 크다. 2문항 차이가
 * "-20%p"로 보인다. 치매는 진행성이라 등락도 정상이다. 그걸 빨간색으로
 * 칠하면 (a) 노이즈에 보호자가 놀라고 (b) 진짜 하락과 구분이 안 된다.
 *
 * 대신 방향과 숫자를 담담히 보여주고, 옆의 스파크라인이 "한 번 튄 건지
 * 추세인지"를 판단하게 한다. 판단은 보호자와 임상의의 몫이다.
 */
function WeeklyTrend({
  series,
  label,
}: {
  series: QabTrendSeries | undefined;
  label: string;
}) {
  if (series === undefined || series.points.length < 2) {
    return null;
  }

  const values = series.points.map((p) => p.accuracy);
  const delta = series.deltaFromPrevious;

  return (
    <span className="flex items-center gap-1.5">
      <QabSparkline
        values={values}
        label={`${label} 최근 ${values.length}주 추이: ${values.join(', ')}%`}
      />
      {delta !== null && delta !== 0 && (
        <span className="text-xs tabular-nums text-[#5C6661]">
          {delta > 0 ? '▲' : '▼'}
          {Math.abs(delta)}%p
        </span>
      )}
    </span>
  );
}
