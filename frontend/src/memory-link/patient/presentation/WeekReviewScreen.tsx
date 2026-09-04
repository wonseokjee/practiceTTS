// 환자용 돌아보기 — 최근에 **함께 본 기억**을 다시 본다.
//
// **점수가 없다.** 이 앱은 환자에게 정답률을 보여주지 않고(`QuizScreen`이
// `showScore={false}`로 넘긴다), 돌아보기의 목적은 평가가 아니라 회상이다.
// API도 점수를 안 내려보내므로 나중에 "이왕 있으니" 붙는 일이 없다.
//
// **왜 이 화면이 생겼나.** '이번 주 돌아보기' 버튼이 시작 버튼과 같은 곳(퀴즈 목록)
// 으로 가고 있었다. 없는 기능을 약속하는 라벨이었다. 지울 수도 있었지만, 보호자가
// 넣은 사진과 글은 환자에게 보여줄 값어치가 있는 내용이다 — 숫자가 아니라도.
//
// **사진 없는 기억.** 기억은 사진 아니면 글 중 하나가 반드시 있다(백엔드가 생성
// 시점에 강제한다). 그래서 사진 자리에 회색 상자와 아이콘을 두지 않는다. 글만 있는
// 기억은 **처음부터 글 카드로 조판한다** — 사진이 빠진 카드가 아니라 다른 종류의
// 카드다. 결핍으로 보이게 만들 이유가 없다.

import { useEffect, useState } from 'react';
import type { WeekReviewItem } from '../quiz/domain/Quiz.js';
import { quizApi } from '../quiz/infrastructure/QuizApi.js';
import { AuthedImage } from '../../shared/AuthedImage.js';

interface WeekReviewScreenProps {
  onBack: () => void;
  /** 테스트 주입용. 미지정 시 실제 API. */
  loadItems?: (days?: number) => Promise<WeekReviewItem[]>;
}

/** ISO 문자열 → '7월 20일'. 연도는 생략한다 — 최근 며칠이라 늘 올해다. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function WeekReviewScreen({ onBack, loadItems }: WeekReviewScreenProps) {
  const [items, setItems] = useState<WeekReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = loadItems ?? ((d?: number) => quizApi.getWeekReview(d));
    void load(7)
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch(() => {
        if (alive) setError('기억을 불러오지 못했어요.');
      });
    return () => {
      alive = false;
    };
  }, [loadItems]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-ink">
        함께 본 기억
      </h1>
      <p className="mb-8 text-lg text-muted">
        요즘 연습에서 만난 기억이에요.
      </p>

      {error !== null && (
        <div
          className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-base text-danger-ink"
          role="alert"
        >
          {error}
        </div>
      )}

      {error === null && items === null && (
        <p className="py-16 text-center text-lg text-muted" role="status">
          불러오는 중...
        </p>
      )}

      {/*
        빈 상태는 "기억이 없다"가 아니라 "요즘 연습을 안 했다"다. 둘을 같은 문구로
        묶으면, 보호자가 기억을 넣어뒀는데도 없다고 읽힌다.
      */}
      {error === null && items !== null && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg text-muted">
            요즘 연습한 기억이 아직 없어요.
          </p>
          <p className="mt-2 text-base text-muted">
            오늘 연습을 하면 여기에 모여요.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-5">
        {(items ?? []).map((item) => (
          <li
            key={item.memoryEntryId}
            className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
          >
            {item.photoUrl !== null ? (
              <AuthedImage
                src={item.photoUrl}
                alt={`${formatDay(item.lastPlayedAt)}의 기억`}
                className="aspect-[4/3] w-full object-cover"
              />
            ) : null}
            <div className="px-5 py-4">
              <p className="text-sm text-muted">
                {formatDay(item.lastPlayedAt)}
              </p>
              {/*
                `moment`(그 순간)가 실제 기억이고, `activity`·`context`는 한두
                낱말짜리 태그다. 셋을 같은 크기로 늘어놓으면 '산책'·'막국수집'이
                문장 조각처럼 읽힌다 — 실제 데이터로 보고 고쳤다.

                글은 최대 300자까지 들어온다. 카드에서는 줄여서 보여주고, 환자가
                읽기 편한 크기(18px)를 유지한다.
              */}
              {item.notes
                .filter((n) => n.category === 'moment')
                .map((note, i) => (
                  <p
                    key={i}
                    className="mt-2 line-clamp-3 text-lg leading-relaxed text-ink"
                  >
                    {note.text}
                  </p>
                ))}
              {(() => {
                const tags = item.notes.filter((n) => n.category !== 'moment');
                if (tags.length === 0) return null;
                return (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {tags.map((tag, i) => (
                      <li
                        key={i}
                        className="rounded-full bg-primary-light px-3 py-1 text-sm text-primary"
                      >
                        {tag.text}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onBack}
        className="mt-10 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border-2 border-primary bg-white px-6 py-3 text-lg font-semibold text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light"
      >
        돌아가기
      </button>
    </div>
  );
}
