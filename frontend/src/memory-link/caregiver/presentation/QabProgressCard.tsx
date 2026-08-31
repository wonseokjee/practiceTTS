// 보호자용 QAB 회복 추세 카드
//
// 환자가 데일리 퀴즈에서 푼 QAB 검사(단어/문장이해, 이름대기, 따라말하기, 읽기, 말운동)
// 결과를 검사별 정확도로 집계해 보여준다. "저장만 하고 안 보임"을 막는 가시성 화면.
// 데이터가 없으면(아직 검사 전) 카드를 숨긴다 — 대시보드를 비우지 않게.

import { useEffect, useState } from 'react';
import {
  QAB_SUBTEST_ORDER,
  subtestLabel,
} from '../../patient/quiz/domain/qabSubtestLabels.js';
import { QabSparkline } from './components/QabSparkline.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type {
  QabSubtestSummary,
  QabTrendSeries,
} from '../../patient/quiz/domain/QabResult.js';

interface QabProgressCardProps {
  /** 요약 조회 함수 (테스트 주입용) */
  fetchSummary?: () => Promise<QabSubtestSummary[]>;
  /** 주차별 기록 상세 열기. 없으면 링크를 감춘다(테스트·독립 사용 대비). */
  onOpenReport?: () => void;
}


/**
 * loc는 다른 검사와 지표의 의미가 다르다.
 *  - accuracy: 정답률이 아니라 **반응률**(무반응이 아닌 시도 비율)
 *  - avgScore: 발음 점수가 아니라 **의식 수준 점수**(0~3)
 * 같은 말로 표기하면 보호자가 오해한다 — 발음 검사가 아닌데 "발음 0점"이
 * 뜨는 식이다.
 */
const IS_REACTION_BASED = (subtest: string): boolean => subtest === 'loc';

/**
 * 반복 훈련 과제인가 — **정답률을 회복 신호로 읽으면 안 되는 검사.**
 *
 * 글자 조합은 실어증 치료 원리(limited transfer: 훈련한 그 항목만 좋아진다)에
 * 따라 같은 낱말을 간격을 두고 일부러 다시 낸다 — 틀린 건 바로, 맞힌 건 오래
 * 안 나온 것부터. 그러면 정답률은 오를 수밖에 없는데,
 * 그 상승분은 **언어 회복이 아니라 그 문항에 익숙해진 것**이다. 다른 검사(듣고
 * 고르기·이름대기)는 매번 다른 문항이라 정답률이 회복 신호로 읽힌다.
 *
 * 같은 숫자를 같은 자리에 같은 모양으로 놓으면 보호자는 구분하지 못한다.
 * 그 오해가 진료 상담이나 치료 결정에 쓰일 수 있어서 표시를 나눈다.
 */
const IS_DRILL_BASED = (subtest: string): boolean => subtest === 'spell';

/**
 * 오답 갈래를 말하기 시작하는 최소 표본.
 *
 * 두세 개로 "소리에서 어려워한다"고 말하면 우연을 손상으로 읽는 것이다. 보호자는
 * 이 문장을 근거로 연습 방향을 바꾸므로, 말할 수 없을 때는 **아무 말도 안 하는
 * 편이 낫다.**
 */
const MIN_FOIL_SAMPLE = 5;

/**
 * 오답 갈래 한 줄 — 정답률이 못 하는 말을 한다.
 *
 * "정답률 24%"는 몇 개 틀렸는지까지만 말한다. 무엇이 어려운지는 **어떤 오답을
 * 골랐는가**가 말한다. 뜻이 가까운 그림을 반복해 고르면 의미 쪽, 소리가 닮은
 * 그림이면 음운 쪽이다.
 *
 * **0을 안전하게 읽으면 안 된다.** 소리가 닮은 그림은 눈높이 4단계부터 나오므로
 * (`LEVEL_CHOICE_SPEC`), 그 아래 환자는 고를 기회 자체가 없어 0이 된다. 0은
 * "소리는 괜찮다"가 아니라 "아직 안 물어봤다"이다 — 그래서 안내에 그 사실을
 * 같이 적는다.
 */
function FoilKindLine({
  foilKinds,
}: {
  foilKinds: NonNullable<QabSubtestSummary['foilKinds']>;
}) {
  const { semantic, phonological } = foilKinds;
  // 무관 오답은 세지 않는다. 어느 축의 어려움도 가리키지 않아, 넣으면 분모만
  // 키워 두 갈래의 대비를 흐린다.
  const counted = semantic + phonological;
  if (counted < MIN_FOIL_SAMPLE) return null;

  return (
    <p
      className="mt-2 text-sm leading-relaxed text-[#5C6661]"
      title="소리가 닮은 그림은 눈높이 4단계부터 나와요. 그 아래에서는 고를 기회가 없어 0으로 보입니다."
    >
      고른 오답 {counted}개 중{' '}
      <span className="font-semibold text-[#1F2A26]">
        뜻이 가까운 그림 {semantic}개
      </span>
      ,{' '}
      <span className="font-semibold text-[#1F2A26]">
        소리가 닮은 그림 {phonological}개
      </span>
    </p>
  );
}

type LoadState = 'loading' | 'ready' | 'error';

export function QabProgressCard({
  fetchSummary,
  onOpenReport,
}: QabProgressCardProps) {
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
    (a, b) => QAB_SUBTEST_ORDER.indexOf(a.subtest as never) -
      QAB_SUBTEST_ORDER.indexOf(b.subtest as never),
  );

  return (
    <section
      className="mb-6 rounded-2xl border border-[#E5E5E0] bg-white p-5"
      aria-label="발화 검사 회복 추세"
    >
      <h2 className="mb-1 text-base font-bold text-[#1F2A26]">발화 검사 진행</h2>
      <p className="mb-4 text-sm text-[#5C6661]">
        환자분이 푼 검사별 정답률이에요. 꾸준히 오르는지 지켜봐 주세요.
        <br />
        <span className="text-xs text-[#6B6560]">
          &lsquo;반복 연습&rsquo; 표시가 붙은 항목은 같은 낱말을 다시 내는
          과제예요. 정답률이 오르는 건 그 낱말에 익숙해진 것이라 회복 정도와는
          다르게 봐 주세요.
        </span>
      </p>

      {onOpenReport !== undefined && (
        <button
          type="button"
          onClick={onOpenReport}
          className="mb-4 min-h-[44px] text-sm font-medium text-[#2D6A56] hover:underline"
        >
          주차별 기록 보기 →
        </button>
      )}

      <ul className="flex flex-col gap-3">
        {sorted.map((it) => {
          const label = subtestLabel(it.subtest);
          const assistedSuffix =
            it.assisted > 0 ? ` · 도움 ${it.assisted}회` : '';
          // 채점하지 못한 문항. 오답이 아니라 측정 실패라 정확도 분모 밖에
          // 있는데, 그러면 "몇 번 했는지"와 화면의 수가 어긋나 보인다.
          // 숨기면 그 어긋남이 설명되지 않고, 채점 실패가 계속돼도 아무도 모른다.
          const unscoredSuffix =
            it.unscored > 0 ? ` · 못 잰 ${it.unscored}회` : '';

          /**
           * 도움이 직접 푼 것보다 많으면 이 비율은 **환자 수행을 대표하지 않는다.**
           *
           * 그림 이름대기가 실제로 `정답률 100% (1/1) · 도움 7회`로 떴다. 8번 제시
           * 중 7번이 보호자 넘어가기인데, 막대는 가득 차고 100%가 굵게 먼저 읽힌다.
           * 바로 위 단어 이해는 28번을 직접 풀어 25%인데 막대가 1/4이다 —
           * **28번 푼 검사가 1번 푼 검사보다 나빠 보인다.**
           *
           * 막대는 정답률만 그리고 표본 크기를 전혀 담지 않아서 생기는 일이다.
           * 이 카드는 이미 `total === 0`일 때 비율을 안 그리고 "아직 직접 푼 기록
           * 없음"이라고 말한다. 같은 규칙을 한 칸 넓힌다.
           */
          const 표본부족 = it.total > 0 && it.assisted > it.total;
          return (
            <li key={it.subtest} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-[#1F2A26]">
                  {label}
                  {IS_DRILL_BASED(it.subtest) ? (
                    <span
                      className="rounded-full bg-[#EDEEEA] px-2 py-0.5 text-xs font-normal text-[#5C6661]"
                      title="같은 낱말을 반복해서 연습하는 과제예요. 정답률이 오르는 건 그 낱말에 익숙해진 것이라, 회복 정도로 읽지 말아 주세요."
                    >
                      반복 연습
                    </span>
                  ) : (
                    <WeeklyTrend series={trend.get(it.subtest)} label={label} />
                  )}
                </span>
                <span className="text-sm tabular-nums text-[#5C6661]">
                  {it.subtest === 'ddk' && it.maxMetric !== null ? (
                    <>최고 {it.maxMetric}회 · </>
                  ) : null}
                  {표본부족 ? (
                    // 비율 대신 센 것을 그대로 말한다. 굵게 쓰는 것은 '몇 개를
                    // 직접 풀었나'이지 비율이 아니다.
                    <>
                      직접 푼{' '}
                      <span className="font-bold text-[#2D6A56]">
                        {it.total}문항
                      </span>{' '}
                      중 {it.correct}개 정답 · 도움{' '}
                      <span className="font-bold text-[#5C6661]">
                        {it.assisted}회
                      </span>
                    </>
                  ) : it.total > 0 ? (
                    <>
                      {IS_REACTION_BASED(it.subtest)
                        ? '반응률'
                        : IS_DRILL_BASED(it.subtest)
                          ? '연습 정답률'
                          : '정답률'}{' '}
                      <span className="font-bold text-[#2D6A56]">
                        {it.accuracy}%
                      </span>{' '}
                      ({it.correct}/{it.total}){assistedSuffix}
                      {unscoredSuffix}
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
                    <>
                      아직 직접 푼 기록 없음{assistedSuffix}
                      {unscoredSuffix}
                    </>
                  )}
                </span>
              </div>
              {/*
                정답률 막대 — 직접 응답이 있고, 그 수가 도움보다 많을 때만 그린다.
                막대는 길이로만 말하는데 표본 크기를 담지 못해, 1/1이 7/28보다
                좋아 보이는 착시를 만든다.
              */}
              {it.total > 0 && !표본부족 && (
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
              {/* 오답 갈래 — 단어 이해에만 값이 있다(오답을 코드가 조립하는
                  유일한 과제라 갈래를 알 수 있다). */}
              {it.foilKinds != null && (
                <FoilKindLine foilKinds={it.foilKinds} />
              )}
              {/* 단서량 — 이름대기에만 값이 있다(E18). */}
              {it.avgCueLevel != null && (
                <CueLevelLine
                  avgCueLevel={it.avgCueLevel}
                  scored={it.cueScored ?? 0}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 이름대기 단서량 — **정답률이 못 말하는 것을 말한다.**
 *
 * 정답률은 도움받은 문항을 빼고 "혼자서 몇 %"를 센다. 그래서 도움이 필요한
 * 환자일수록 분모가 비어 값이 안 나온다 — 실제로 이름대기가 오래 `직접 푼
 * 1문항 중 1개 정답 · 도움 7회`였다. 8번 중 7번이 기록에서 사라진 것이다.
 *
 * 여기서는 그 도움 자체를 센다. **4에서 3으로, 3에서 1로 내려오는 것이
 * 회복이다.** 그래서 막대를 거꾸로 채운다 — 왼쪽이 스스로 한 쪽이다.
 *
 * 단계는 0·1·3·4로 띄엄띄엄하다(2는 문장 완성 자리로 비워 뒀다). 그래서
 * 막대는 4를 100%로 두고 비례로만 그리고, 정확한 값은 옆의 숫자가 맡는다.
 */
function CueLevelLine({
  avgCueLevel,
  scored,
}: {
  avgCueLevel: number;
  scored: number;
}) {
  const 남은도움 = Math.min(100, Math.max(0, (avgCueLevel / 4) * 100));
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-[#5C6661]">
        평균{' '}
        <span className="font-bold tabular-nums text-[#7A4A20]">
          {avgCueLevel}단계
        </span>{' '}
        도움 · {scored}문항
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[#EBEAE6]"
        role="progressbar"
        aria-valuenow={avgCueLevel}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label={`그림 이름대기 평균 ${avgCueLevel}단계 도움 (0에 가까울수록 스스로 함)`}
      >
        {/* 채운 쪽이 '스스로 한 만큼'이다. 도움이 줄면 막대가 자란다. */}
        <div
          className="h-full rounded-full bg-[#B85C36] transition-[width] duration-[250ms] ease-in-out"
          style={{ width: `${100 - 남은도움}%` }}
        />
      </div>
    </div>
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
