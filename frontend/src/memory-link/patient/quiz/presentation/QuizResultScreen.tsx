// 퀴즈 결과 화면
//
// 점수 / 최고점 비교 / 신기록(isNewBest) 축하 / 다시 풀기·목록으로 버튼.

import {
  formatScore,
  scoreLabel,
  scoreToStars,
} from '../domain/QuizScoring.js';

interface QuizResultScreenProps {
  /** 이번 세션 점수 (0..100) */
  sessionScore: number;
  /** 역대 최고점 (없으면 null) */
  bestScore: number | null;
  /** 이번 시도가 신기록인지 */
  isNewBest: boolean;
  onRetry: () => void;
  onBackToList: () => void;
}

/** 별점 행 (시각 보조 — 텍스트 점수와 병행) */
function StarRow({ score }: { score: number }) {
  const filled = scoreToStars(score);
  const stars = Array.from({ length: 5 }, (_, i) => i < filled);
  return (
    <div
      className="flex justify-center gap-1 text-3xl"
      aria-hidden="true"
    >
      {stars.map((isFilled, i) => (
        <span key={i} className={isFilled ? 'text-[#E07B54]' : 'text-[#D4D8D4]'}>
          ★
        </span>
      ))}
    </div>
  );
}

/** 퀴즈 완료 결과 카드 */
export function QuizResultScreen({
  sessionScore,
  bestScore,
  isNewBest,
  onRetry,
  onBackToList,
}: QuizResultScreenProps) {
  return (
    <section
      className="font-pretendard mx-auto mt-8 w-full max-w-md rounded-lg bg-[#F7F6F3] p-8 text-center"
      role="status"
      aria-live="polite"
    >
      {isNewBest && (
        <div className="mb-4 inline-block rounded-full bg-[#EBF4F0] px-4 py-1 text-sm font-bold text-[#1F5240]">
          새 최고 기록이에요!
        </div>
      )}

      <h2 className="text-xl font-bold text-[#1F2A26]">
        {scoreLabel(sessionScore)}
      </h2>

      <StarRow score={sessionScore} />

      <p className="mt-4 text-5xl font-bold tabular-nums text-[#2D6A56]">
        {formatScore(sessionScore)}
      </p>

      {bestScore !== null && (
        <p className="mt-3 text-base tabular-nums text-[#5C6661]">
          최고점 {formatScore(bestScore)}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[56px] rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
          aria-label="다시 풀기"
        >
          다시 풀기
        </button>
        <button
          type="button"
          onClick={onBackToList}
          className="min-h-[48px] rounded-md bg-white px-6 py-3 text-base font-medium text-[#5C6661] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6]"
          aria-label="퀴즈 목록으로"
        >
          목록으로
        </button>
      </div>
    </section>
  );
}
