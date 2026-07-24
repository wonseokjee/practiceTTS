/**
 * 진료용 주간 리포트.
 *
 * 왜 만드는가: 치매 진료는 "지난 몇 달 어떠셨어요?"로 시작하는데 보호자는
 * 대개 기억으로 답한다. 객관적 기록을 내밀 수 있으면 그 자체로 가치가 있다.
 *
 * 왜 인쇄인가: 병원에 종이로 들고 가거나 화면을 그대로 보여주는 게 가장
 * 현실적이다. PDF 생성은 라이브러리가 필요하고 무거운 데 비해 얻는 게 없다.
 * 브라우저 인쇄(@media print)로 충분하다.
 *
 * 한계 고지를 반드시 함께 싣는다. 의료진이 "정답률 50%"만 보고 문항 수가
 * 10개인 줄 모르면 오독한다. 이건 자가 측정이고 진단이 아니다.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../shared/AuthContext.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { QabTrendSeries } from '../../patient/quiz/domain/QabResult.js';
import { withHonorific } from '../../shared/honorific.js';

/** 진료 주기를 고려해 약 3개월. */
const REPORT_WEEKS = 12;

const SUBTEST_LABELS: Record<string, string> = {
  loc: '의식 수준',
  word: '단어 이해',
  sentence: '문장 이해',
  naming: '그림 이름대기',
  repeat: '따라 말하기',
  reading: '소리 내어 읽기',
  ddk: '말운동(퍼터커)',
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

/** loc는 정답률이 아니라 반응률이다. 같은 말로 쓰면 오독한다. */
const isReactionBased = (subtest: string): boolean => subtest === 'loc';

function formatWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface WeeklyReportScreenProps {
  onBack: () => void;
}

export function WeeklyReportScreen({ onBack }: WeeklyReportScreenProps) {
  const { user } = useAuth();
  const [series, setSeries] = useState<QabTrendSeries[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    quizApi
      .getQabTrend(REPORT_WEEKS)
      .then((data) => {
        if (alive) setSeries(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const printedAt = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sorted = (series ?? [])
    .filter((s) => s.points.length > 0)
    .sort(
      (a, b) =>
        SUBTEST_ORDER.indexOf(a.subtest) - SUBTEST_ORDER.indexOf(b.subtest),
    );

  // 데이터가 얼마나 쌓였는지 — 의료진이 신뢰도를 판단하는 근거다.
  const totalItems = sorted.reduce(
    (sum, s) => sum + s.points.reduce((n, p) => n + p.total, 0),
    0,
  );
  const allWeeks = [
    ...new Set(sorted.flatMap((s) => s.points.map((p) => p.weekStart))),
  ].sort();
  const periodLabel =
    allWeeks.length === 0
      ? '기록 없음'
      : `${formatWeek(allWeeks[0])} ~ ${formatWeek(allWeeks[allWeeks.length - 1])}`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* 화면 전용 조작 영역 — 인쇄물에는 나오면 안 된다 */}
      <div className="no-print mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] text-sm text-[#2D6A56] hover:underline"
        >
          ← 목록으로
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[44px] rounded-full bg-[#2D6A56] px-5 py-2 text-sm font-medium text-white hover:bg-[#1F5240]"
        >
          인쇄하기
        </button>
      </div>

      <article className="report-sheet rounded-2xl border border-[#E8E4DC] bg-white p-6">
        <header className="mb-5 border-b border-[#E8E4DC] pb-4">
          <h1 className="text-xl font-bold text-[#1A1916]">
            언어·인지 검사 기록
          </h1>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-[#5C6661] sm:grid-cols-3">
            <div className="flex gap-2">
              <dt>대상</dt>
              <dd className="font-medium text-[#1A1916]">
                {withHonorific(user?.patientDisplayName, '어르신')}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>기간</dt>
              <dd className="font-medium text-[#1A1916]">{periodLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt>출력일</dt>
              <dd className="font-medium text-[#1A1916]">{printedAt}</dd>
            </div>
          </dl>
        </header>

        {failed && (
          <p role="alert" className="py-8 text-center text-sm text-[#C94040]">
            기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}

        {!failed && series === null && (
          <p className="py-8 text-center text-sm text-[#6B6560]">
            불러오는 중...
          </p>
        )}

        {!failed && series !== null && sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-[#6B6560]">
            아직 검사 기록이 없습니다. 환자 모드의 &lsquo;기본 검사&rsquo;를
            진행하면 이곳에 쌓입니다.
          </p>
        )}

        {sorted.length > 0 && (
          <>
            <p className="mb-4 text-sm text-[#5C6661]">
              총 {totalItems}문항 · {allWeeks.length}주 기록
            </p>

            <div className="flex flex-col gap-5">
              {sorted.map((s) => (
                <section key={s.subtest} className="break-inside-avoid">
                  <h2 className="mb-2 text-base font-semibold text-[#1A1916]">
                    {SUBTEST_LABELS[s.subtest] ?? s.subtest}
                  </h2>
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">
                      {SUBTEST_LABELS[s.subtest] ?? s.subtest} 주차별 기록
                    </caption>
                    <thead>
                      <tr className="border-b border-[#E8E4DC] text-left text-[#5C6661]">
                        <th scope="col" className="py-1.5 font-medium">
                          주 시작
                        </th>
                        <th scope="col" className="py-1.5 font-medium">
                          {isReactionBased(s.subtest) ? '반응' : '정답'}
                        </th>
                        <th scope="col" className="py-1.5 font-medium">
                          문항
                        </th>
                        <th scope="col" className="py-1.5 text-right font-medium">
                          {isReactionBased(s.subtest) ? '반응률' : '정답률'}
                        </th>
                        {isReactionBased(s.subtest) && (
                          <th
                            scope="col"
                            className="py-1.5 text-right font-medium"
                          >
                            평균(0~3)
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {s.points.map((p) => (
                        <tr
                          key={p.weekStart}
                          className="border-b border-[#F2F1EC]"
                        >
                          <td className="py-1.5 tabular-nums">
                            {formatWeek(p.weekStart)}
                          </td>
                          <td className="py-1.5 tabular-nums">{p.correct}</td>
                          <td className="py-1.5 tabular-nums">{p.total}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {p.accuracy}%
                          </td>
                          {isReactionBased(s.subtest) && (
                            <td className="py-1.5 text-right tabular-nums">
                              {p.avgScore ?? '-'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>

            {/* 한계 고지 — 이게 없으면 의료진이 오독한다 */}
            <section className="report-note mt-6 rounded-xl bg-[#F7F6F3] p-4">
              <h2 className="mb-1.5 text-sm font-semibold text-[#1A1916]">
                이 기록을 읽으실 때
              </h2>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-[#5C6661]">
                <li>
                  가정에서 보호자와 함께 진행한 자가 측정 기록입니다. 의료
                  진단이나 표준화 검사 결과가 아닙니다.
                </li>
                <li>
                  한 주의 문항 수가 적어(10~20문항) 주간 변동이 큽니다. 한 주의
                  등락보다 여러 주의 흐름을 봐주시기 바랍니다.
                </li>
                <li>
                  검사 환경(주변 소음, 기기, 시간대, 컨디션)이 매번 달라 같은
                  조건의 비교가 아닙니다.
                </li>
                <li>
                  &lsquo;의식 수준&rsquo;은 소리를 듣고 화면을 누르기까지의
                  반응으로 0~3점을 매깁니다. 정답·오답이 아니라 반응 여부와
                  속도를 봅니다.
                </li>
              </ul>
            </section>
          </>
        )}
      </article>
    </div>
  );
}
