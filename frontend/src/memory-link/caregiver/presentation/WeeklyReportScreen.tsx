/**
 * 검사 기록 상세 — 검사별 주차 추이를 표로 본다.
 *
 * 왜 만드는가: 대시보드 카드는 요약과 스파크라인만 보여준다. 주차별 실제
 * 숫자(정답/문항)를 보려면 들어올 곳이 필요하다.
 *
 * **인쇄 기능은 의도적으로 없다.** 이 기록은 가정 자가 측정이라 진료 문서로
 * 내밀 만한 공신력이 없다. 인쇄 버튼을 두면 종이에 찍힌 표가 검사 결과지처럼
 * 보이고, 그건 이 데이터가 실제로 가진 신뢰도보다 과하게 읽힌다.
 * 화면으로 참고하는 선에서 멈춘다.
 *
 * 그래도 한계 고지는 싣는다. 화면으로 보더라도 "정답률 50%"만 보고 문항 수가
 * 10개인 줄 모르면 똑같이 오독하기 때문이다.
 */

import { useEffect, useState } from 'react';
import {
  QAB_SUBTEST_ORDER,
  subtestLabel,
} from '../../patient/quiz/domain/qabSubtestLabels.js';
import { useAuth } from '../../shared/AuthContext.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type {
  QabTrendSeries,
  QabWeeklyPoint,
} from '../../patient/quiz/domain/QabResult.js';
import { withHonorific } from '../../shared/honorific.js';

/** 약 3개월. 주간 변동이 커서 이 정도는 봐야 흐름이 보인다. */
const REPORT_WEEKS = 12;


// 검사마다 "성적"의 뜻이 다르다. 같은 표에 같은 라벨로 담으면 오독한다.
//  - reaction(loc): 정오답이 아니라 반응 여부·의식 점수(0~3)
//  - ddk: 목표 음절 수 통과 여부 + 실제 감지 횟수(핵심 지표)
//  - speech(따라말하기·읽기): 통과 여부 + 발음 정확도(0~100)
//  - accuracy(단어·문장·이름대기): 정답률 그대로
type SubtestKind = 'reaction' | 'ddk' | 'speech' | 'accuracy';

function subtestKind(subtest: string): SubtestKind {
  if (subtest === 'loc') return 'reaction';
  if (subtest === 'ddk') return 'ddk';
  if (subtest === 'repeat' || subtest === 'reading') return 'speech';
  return 'accuracy';
}

const HIT_LABEL: Record<SubtestKind, string> = {
  reaction: '반응',
  ddk: '통과',
  speech: '정답',
  accuracy: '정답',
};
const RATE_LABEL: Record<SubtestKind, string> = {
  reaction: '반응률',
  ddk: '통과율',
  speech: '정답률',
  accuracy: '정답률',
};

/** 검사마다 실제로 의미 있는 추가 지표 열. 없으면 null. */
interface ExtraCol {
  header: string;
  value: (p: QabWeeklyPoint) => number | string;
}
function extraCol(kind: SubtestKind): ExtraCol | null {
  switch (kind) {
    case 'reaction':
      return { header: '평균(0~3)', value: (p) => p.avgScore ?? '-' };
    case 'ddk':
      return { header: '평균 감지(회)', value: (p) => p.avgMetric ?? '-' };
    case 'speech':
      return { header: '발음(0~100)', value: (p) => p.avgScore ?? '-' };
    default:
      return null;
  }
}

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

  const viewedAt = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sorted = (series ?? [])
    .filter((s) => s.points.length > 0)
    .sort(
      (a, b) =>
        QAB_SUBTEST_ORDER.indexOf(a.subtest as never) -
        QAB_SUBTEST_ORDER.indexOf(b.subtest as never),
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
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] text-sm text-[#2D6A56] hover:underline"
        >
          ← 목록으로
        </button>
      </div>

      <article className="rounded-2xl border border-[#E8E4DC] bg-white p-6">
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
              <dt>조회일</dt>
              <dd className="font-medium text-[#1A1916]">{viewedAt}</dd>
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
              {sorted.map((s) => {
                const kind = subtestKind(s.subtest);
                const extra = extraCol(kind);
                return (
                  <section key={s.subtest} className="break-inside-avoid">
                    <h2 className="mb-2 text-base font-semibold text-[#1A1916]">
                      {subtestLabel(s.subtest)}
                    </h2>
                    <table className="w-full border-collapse text-sm">
                      <caption className="sr-only">
                        {subtestLabel(s.subtest)} 주차별 기록
                      </caption>
                      <thead>
                        <tr className="border-b border-[#E8E4DC] text-left text-[#5C6661]">
                          <th scope="col" className="py-1.5 font-medium">
                            주 시작
                          </th>
                          <th scope="col" className="py-1.5 font-medium">
                            {HIT_LABEL[kind]}
                          </th>
                          <th scope="col" className="py-1.5 font-medium">
                            문항
                          </th>
                          <th
                            scope="col"
                            className="py-1.5 text-right font-medium"
                          >
                            {RATE_LABEL[kind]}
                          </th>
                          {extra && (
                            <th
                              scope="col"
                              className="py-1.5 text-right font-medium"
                            >
                              {extra.header}
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
                            {extra && (
                              <td className="py-1.5 text-right tabular-nums">
                                {extra.value(p)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>

            {/* 한계 고지 — 이게 없으면 의료진이 오독한다 */}
            <section className="mt-6 rounded-xl bg-[#F7F6F3] p-4">
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
                <li>
                  &lsquo;따라 말하기&rsquo;·&lsquo;소리 내어 읽기&rsquo;의
                  &lsquo;발음&rsquo;은 음성 인식이 매긴 0~100점 근사치입니다.
                  주변 소음·발음 습관에 민감하니 통과 여부와 함께 참고로만
                  봐주세요.
                </li>
                <li>
                  &lsquo;말운동(퍼터커)&rsquo;의 &lsquo;평균 감지&rsquo;는 정해진
                  시간 동안 인식된 음절 반복 횟수입니다. 많을수록 말 움직임이
                  빠른 편이며, &lsquo;통과&rsquo;는 목표 횟수를 넘겼는지입니다.
                </li>
              </ul>
            </section>
          </>
        )}
      </article>
    </div>
  );
}
