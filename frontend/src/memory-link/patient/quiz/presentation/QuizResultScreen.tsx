// 퀴즈 결과 화면
//
// 점수 / 최고점 비교 / 신기록(isNewBest) 축하 / 다시 풀기·목록으로 버튼.
// 무점수 모드(showScore=false): 숫자·별점·최고점을 숨기고 완료 격려만 표시한다
//   (QAB 발화 검사 등 진단성 세트는 점수화가 적절치 않아 "연습/완료" 위주로 보여준다).

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
  /** 점수(숫자·별점·최고점) 표시 여부. false면 완료 격려만 노출 (기본 true) */
  showScore?: boolean;
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
        <span key={i} className={isFilled ? 'text-[#B85C36]' : 'text-[#D4D8D4]'}>
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
  showScore = true,
  onRetry,
  onBackToList,
}: QuizResultScreenProps) {
  return (
    <section
      className="font-pretendard mx-auto mt-8 w-full max-w-md rounded-3xl border border-white/90 bg-white/85 p-8 text-center shadow-[0_6px_18px_rgba(0,0,0,0.05)]"
      role="status"
      aria-live="polite"
    >
      {showScore ? (
        <>
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
        </>
      ) : (
        <>
          <div className="mb-2 text-5xl" aria-hidden="true">🎉</div>
          <h2 className="text-2xl font-bold text-[#1F2A26]">
            오늘도 끝까지 잘 하셨어요!
          </h2>
          <p className="mt-3 text-base text-[#5C6661]">
            모든 문제를 다 마쳤어요.
          </p>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[56px] rounded-full bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
          aria-label="다시 풀기"
        >
          다시 풀기
        </button>
        <button
          type="button"
          onClick={onBackToList}
          className="min-h-[48px] rounded-full bg-white px-6 py-3 text-base font-medium text-[#5C6661] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6]"
          aria-label="퀴즈 목록으로"
        >
          목록으로
        </button>
      </div>
    </section>
  );
}
