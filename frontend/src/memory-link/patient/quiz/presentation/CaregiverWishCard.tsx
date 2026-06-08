// 보호자 한마디 카드 (Phase 6 Pattern 1) — 퀴즈 진입 전 게이트.
//
// §9-1-C: QuizScreen 최상단, caregiverWishMessage가 NULL이 아닐 때만 렌더.
//  - 한마디 본문 표시
//  - 옵션 토글: "따라말하기"(echo, LLM 불필요) / "빈칸 채우기"(LLM, lazy fetch)
//  - "퀴즈로 이동" 버튼
//
// 따라말하기는 한마디 원문을 그대로 읽는 연습이라 prop만으로 즉시 표시한다.
// 빈칸은 ai-service 변환이 필요하므로 탭 전환 시점에 한 번만 가져온다(비용/지연 최소).

import { forwardRef, useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { quizApi } from '../infrastructure/QuizApi.js';
import type { WishPractice } from '../domain/Quiz.js';

const TAB_ID = { echo: 'wish-tab-echo', blank: 'wish-tab-blank' } as const;
const PANEL_ID = 'wish-tabpanel';

type WishTab = 'echo' | 'blank';

interface CaregiverWishCardProps {
  quizSetId: string;
  wishMessage: string;
  onProceed: () => void;
  /** 테스트용 주입 (선택) */
  fetchPractice?: (quizSetId: string) => Promise<WishPractice>;
}

export function CaregiverWishCard({
  quizSetId,
  wishMessage,
  onProceed,
  fetchPractice,
}: CaregiverWishCardProps) {
  const [tab, setTab] = useState<WishTab>('echo');
  const [practice, setPractice] = useState<WishPractice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealAnswer, setRevealAnswer] = useState(false);

  const loadPractice = useCallback(async (): Promise<void> => {
    if (practice !== null || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const fetcher = fetchPractice ?? quizApi.getWishPractice;
      const result = await fetcher(quizSetId);
      setPractice(result);
    } catch {
      setError('연습 문장을 불러오지 못했어요. 따라말하기로 연습해보세요.');
    } finally {
      setIsLoading(false);
    }
  }, [practice, isLoading, fetchPractice, quizSetId]);

  const switchToBlank = useCallback((): void => {
    setTab('blank');
    void loadPractice();
  }, [loadPractice]);

  // 탭 버튼 ref — 화살표 키 이동 시 focus 전달용.
  const echoRef = useRef<HTMLButtonElement>(null);
  const blankRef = useRef<HTMLButtonElement>(null);

  const selectTab = useCallback(
    (next: WishTab): void => {
      if (next === 'blank') switchToBlank();
      else setTab('echo');
    },
    [switchToBlank],
  );

  // WAI-ARIA tabs: 좌우 화살표로 탭 전환 + focus 이동.
  const onTabListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next: WishTab = tab === 'echo' ? 'blank' : 'echo';
      selectTab(next);
      (next === 'echo' ? echoRef : blankRef).current?.focus();
    },
    [tab, selectTab],
  );

  return (
    <section
      className="font-pretendard mb-6 rounded-xl border border-[#E0A984] bg-[#FCF3EC] p-6"
      aria-labelledby="wish-card-heading"
    >
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          💌
        </span>
        <h2
          id="wish-card-heading"
          className="text-sm font-semibold text-[#7A4A20]"
        >
          가족이 전하는 한마디
        </h2>
      </div>

      <p className="mb-5 text-xl font-bold leading-relaxed text-[#1F2A26]">
        {wishMessage}
      </p>

      {/* 옵션 토글 */}
      <div
        className="mb-4 flex gap-2"
        role="tablist"
        aria-label="연습 방식 선택"
        onKeyDown={onTabListKeyDown}
      >
        <TabButton
          ref={echoRef}
          id={TAB_ID.echo}
          controls={PANEL_ID}
          label="따라말하기"
          active={tab === 'echo'}
          onClick={() => setTab('echo')}
        />
        <TabButton
          ref={blankRef}
          id={TAB_ID.blank}
          controls={PANEL_ID}
          label="빈칸 채우기"
          active={tab === 'blank'}
          onClick={switchToBlank}
        />
      </div>

      {/* 탭 본문 */}
      <div
        className="rounded-lg bg-white p-5"
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tab === 'echo' ? TAB_ID.echo : TAB_ID.blank}
        tabIndex={0}
      >
        {tab === 'echo' ? (
          <div>
            <p className="mb-1 text-xs text-[#5C6661]">소리 내어 따라 말해보세요</p>
            <p className="text-lg font-medium text-[#1F2A26]">{wishMessage}</p>
          </div>
        ) : (
          <BlankPanel
            isLoading={isLoading}
            error={error}
            practice={practice}
            revealAnswer={revealAnswer}
            onReveal={() => setRevealAnswer(true)}
            onRetry={() => void loadPractice()}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onProceed}
        className="mt-6 min-h-[56px] w-full rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
        aria-label="퀴즈 풀이로 이동"
      >
        퀴즈 풀러 가기
      </button>
    </section>
  );
}

// ─── 하위 컴포넌트 ──────────────────────────────────────────────────

const TabButton = forwardRef<
  HTMLButtonElement,
  {
    id: string;
    controls: string;
    label: string;
    active: boolean;
    onClick: () => void;
  }
>(function TabButton({ id, controls, label, active, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={active}
      // roving tabindex: 활성 탭만 Tab 순서에 포함, 비활성은 화살표로 접근.
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors duration-[180ms] ease-out ${
        active
          ? 'bg-[#2D6A56] text-white'
          : 'bg-white text-[#5C6661] hover:bg-[#EBF4F0]'
      }`}
    >
      {label}
    </button>
  );
});

interface BlankPanelProps {
  isLoading: boolean;
  error: string | null;
  practice: WishPractice | null;
  revealAnswer: boolean;
  onReveal: () => void;
  onRetry: () => void;
}

function BlankPanel({
  isLoading,
  error,
  practice,
  revealAnswer,
  onReveal,
  onRetry,
}: BlankPanelProps) {
  if (isLoading) {
    return (
      <p className="text-base text-[#5C6661]" role="status">
        연습 문장을 만들고 있어요...
      </p>
    );
  }
  if (error !== null) {
    return (
      <div role="alert">
        <p className="mb-3 text-sm text-[#7A2E15]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-[#2D6A56] px-4 py-2 text-sm font-medium text-white hover:bg-[#1F5240]"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (practice === null) {
    return null;
  }

  return (
    <div>
      <p className="mb-1 text-xs text-[#5C6661]">
        빈칸에 들어갈 말을 떠올려 말해보세요
      </p>
      <p className="mb-3 text-lg font-medium text-[#1F2A26]">
        {practice.fillBlank.prompt}
      </p>
      <p className="mb-3 text-sm text-[#5C6661]">
        힌트: 첫 글자는{' '}
        <span className="font-bold text-[#2D6A56]">
          {practice.fillBlank.hintFirstChar}
        </span>
      </p>
      {revealAnswer ? (
        <p className="text-base font-bold text-[#1F5240]">
          정답: {practice.fillBlank.answer}
        </p>
      ) : (
        <button
          type="button"
          onClick={onReveal}
          className="text-sm text-[#2D6A56] underline transition-colors hover:text-[#1F5240]"
        >
          정답 보기
        </button>
      )}
    </div>
  );
}
