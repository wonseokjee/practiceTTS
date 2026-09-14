// 풀 수 있는 퀴즈 목록 화면
//
// 'ready' 상태 세트만 카드로 표시(날짜 기반 제목 / 사진 썸네일 / 최고점).
// 보호자 입력 원문(notePreview)은 카드에 노출하지 않는다.
// 카드 선택 시 onSelectQuiz(quizSetId) 호출.

import { useQuizList } from '../application/useQuizList.js';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../shared/i18n/formatDate.js';
import type { UseQuizListDeps } from '../application/useQuizList.js';
import type { QuizSetSummary } from '../domain/Quiz.js';
import { formatScore } from '../domain/QuizScoring.js';
import { AuthedImage } from '../../../shared/AuthedImage.js';

interface QuizListScreenProps {
  onSelectQuiz: (quizSetId: string) => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UseQuizListDeps;
}

/**
 * 카드 날짜 — 모양은 로케일이 정한다(i18n 규약 3). 값이 날짜가 아니면 빈 문자열.
 * 예전에는 연·월·일을 한국어로 박아 계정 로케일을 우회했다.
 */
function formatCardDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 풀 수 있는 퀴즈 카드 목록 */
export function QuizListScreen({ onSelectQuiz, deps }: QuizListScreenProps) {
  const { t } = useTranslation('quiz');
  const { items, isLoading, error, reload } = useQuizList(deps);

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      {/*
        "오늘의"가 아니다. 이 목록은 `status: 'ready'`인 세트 **전부**를 담는다 —
        실제로 8월 27일에 열었을 때 7월 20일 세트가 들어 있었다. 화면 안의
        `aria-label`과 빈 상태 문구는 이미 "풀 수 있는 퀴즈"라고 맞게 적혀 있었고
        제목만 어긋나 있었다.

        홈에서 세트가 하나면 바로 시작하므로(DR1b), 이 화면은 이제 **여럿 중
        고를 때** 나온다. 제목이 그 상황을 말해야 한다.
      */}
      <h2 className="mb-5 text-2xl font-bold text-ink-sage">
        {t('list.title')}
      </h2>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <p className="text-xl text-muted-sage">{t('list.loading')}</p>
        </div>
      )}

      {!isLoading && error !== null && (
        <div
          className="rounded-3xl border border-accent bg-accent-soft p-6 text-center"
          role="alert"
        >
          <p className="mb-4 text-lg text-accent-ink">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="min-h-[48px] rounded-full bg-primary px-6 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
          >
            {t('screen.retry')}
          </button>
        </div>
      )}

      {!isLoading && error === null && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-xl text-muted-sage">
            {t('list.empty')}
          </p>
          {/* muted-disabled는 크림 배경에서 2.47:1이라 AA 미달이다(muted는 5.11:1). */}
          <p className="mt-2 text-base text-muted-sage">
            {t('list.emptyHint')}
          </p>
        </div>
      )}

      {!isLoading && error === null && items.length > 0 && (
        <ul
          className="flex flex-col gap-4"
          role="list"
          aria-label={t('list.listAria')}
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
  const { t } = useTranslation('quiz');
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.quizSetId)}
        aria-label={t('list.cardAria', { date: formatCardDate(item.createdAt) })}
        className="flex w-full items-center gap-4 rounded-3xl border border-line bg-white p-4 text-left shadow-[0_6px_18px_rgba(0,0,0,0.05)] transition-colors duration-[180ms] ease-out hover:border-primary"
      >
        {item.photoUrl !== null && (
          <AuthedImage
            src={item.photoUrl}
            alt={t('list.photoAlt')}
            className="h-20 w-20 flex-shrink-0 rounded-2xl object-cover"
          />
        )}

        <div className="flex flex-1 flex-col gap-1">
          <p className="text-lg font-medium text-ink-sage">
            {t('list.cardTitle', { date: formatCardDate(item.createdAt) })}
          </p>
          {item.bestScore !== null && (
            <span className="text-sm tabular-nums text-primary">
              {t('score.best', { score: formatScore(item.bestScore) })}
            </span>
          )}
        </div>

        <span className="text-2xl text-primary" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}
