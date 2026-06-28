// 풀 수 있는 퀴즈 목록 화면
//
// 'ready' 상태 세트만 카드로 표시(날짜 기반 제목 / 사진 썸네일 / 최고점).
// 보호자 입력 원문(notePreview)은 카드에 노출하지 않는다.
// 카드 선택 시 onSelectQuiz(quizSetId) 호출.

import { useQuizList } from '../application/useQuizList.js';
import type { UseQuizListDeps } from '../application/useQuizList.js';
import type { QuizSetSummary } from '../domain/Quiz.js';
import { formatScore } from '../domain/QuizScoring.js';

interface QuizListScreenProps {
  onSelectQuiz: (quizSetId: string) => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UseQuizListDeps;
}

/** 날짜 ISO 문자열을 'YYYY년 M월 D일' 형태로 포맷 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** 풀 수 있는 퀴즈 카드 목록 */
export function QuizListScreen({ onSelectQuiz, deps }: QuizListScreenProps) {
  const { items, isLoading, error, reload } = useQuizList(deps);

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      <h2 className="mb-5 text-2xl font-bold text-[#1F2A26]">
        오늘의 기억 퀴즈
      </h2>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <p className="text-xl text-[#5C6661]">불러오는 중...</p>
        </div>
      )}

      {!isLoading && error !== null && (
        <div
          className="rounded-3xl border border-[#E07B54] bg-[#FBE9E2] p-6 text-center"
          role="alert"
        >
          <p className="mb-4 text-lg text-[#7A2E15]">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="min-h-[48px] rounded-full bg-[#2D6A56] px-6 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
          >
            다시 시도
          </button>
        </div>
      )}

      {!isLoading && error === null && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-xl text-[#5C6661]">
            아직 풀 수 있는 퀴즈가 없어요.
          </p>
          <p className="mt-2 text-base text-[#9AA09B]">
            보호자가 일기를 등록하면 퀴즈가 도착해요.
          </p>
        </div>
      )}

      {!isLoading && error === null && items.length > 0 && (
        <ul
          className="flex flex-col gap-4"
          role="list"
          aria-label="풀 수 있는 퀴즈 목록"
        >
          {items.map((item) => (
            <QuizSetCard
              key={item.quizSetId}
              item={item}
              onSelect={onSelectQuiz}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 하위 컴포넌트 ──────────────────────────────────────────────────

interface QuizSetCardProps {
  item: QuizSetSummary;
  onSelect: (quizSetId: string) => void;
}

function QuizSetCard({ item, onSelect }: QuizSetCardProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.quizSetId)}
        aria-label={`${formatDate(item.createdAt)} 퀴즈 풀기`}
        className="flex w-full items-center gap-4 rounded-3xl border border-[#E8E4DC] bg-white p-4 text-left shadow-[0_6px_18px_rgba(0,0,0,0.05)] transition-colors duration-[180ms] ease-out hover:border-[#2D6A56]"
      >
        {item.photoUrl !== null && (
          <img
            src={item.photoUrl}
            alt="기억 사진"
            className="h-20 w-20 flex-shrink-0 rounded-2xl object-cover"
          />
        )}

        <div className="flex flex-1 flex-col gap-1">
          <p className="text-lg font-medium text-[#1F2A26]">
            {formatDate(item.createdAt)} 기억 퀴즈
          </p>
          {item.bestScore !== null && (
            <span className="text-sm tabular-nums text-[#2D6A56]">
              최고점 {formatScore(item.bestScore)}
            </span>
          )}
        </div>

        <span className="text-2xl text-[#2D6A56]" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}
