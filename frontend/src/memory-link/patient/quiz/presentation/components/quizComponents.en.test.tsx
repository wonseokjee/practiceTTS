// 퀴즈 문항 컴포넌트를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트:
//  - 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다(폴백 끔, §7-7 결정 A)
//  - 복수형 규약 — count 1은 _one, 그 밖은 _other
// 나머지 컴포넌트 테스트는 셋업의 기본 로케일(한국어)로 돈다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../../shared/domain/locale.js';
import type { IDdkRecorder } from '../../infrastructure/DdkRecorder.js';
import type { QabDdkItem } from '../../domain/MixedQuiz.js';
import { DdkItem } from './DdkItem.js';
import { YesNoButtons } from './YesNoButtons.js';
import { TtsFailureNotice } from './TtsFailureNotice.js';
import { QuizResultScreen } from '../QuizResultScreen.js';

const HANGUL = /[가-힣]/;

const idleRecorder = (): IDdkRecorder => ({
  start: async () => {},
  stop: async () => ({ count: 0, durationMs: 0 }),
});

function ddkItem(targetCount: number): QabDdkItem {
  return {
    itemId: 'en-US:ddk_0',
    syllable: 'puh',
    label: 'puh',
    targetCount,
    instruction: 'Say this sound again and again',
    presentedLevel: 1,
  };
}

function renderDdk(targetCount: number) {
  return render(
    <DdkItem
      item={ddkItem(targetCount)}
      isSelectable
      showFeedback={false}
      isCorrect={null}
      onSubmit={() => {}}
      createRecorder={idleRecorder}
    />,
  );
}

describe('퀴즈 문항 컴포넌트 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('DDK — 영어 문구, 한글이 새지 않는다', () => {
    const { container } = renderDdk(6);
    expect(screen.getByText('Repeat it at least 6 times to pass.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sound to repeat: puh')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('복수형 — 1이면 단수', () => {
    renderDdk(1);
    expect(screen.getByText('Repeat it at least 1 time to pass.')).toBeInTheDocument();
  });

  it('예/아니오 — 영어 라벨', () => {
    const { container } = render(
      <YesNoButtons
        isSelectable
        selectedAnswer={null}
        showFeedback={false}
        correctAnswer={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('group', { name: 'Choose yes or no' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('결과 화면 — 점수 없는 완료 화면도 영어', () => {
    const { container } = render(
      <QuizResultScreen
        sessionScore={0}
        bestScore={null}
        isNewBest={false}
        showScore={false}
        onRetry={() => {}}
        onBackToList={() => {}}
      />,
    );
    expect(screen.getByText("You finished today's set")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('소리 실패 안내 — 세 화면이 공유하는 문구도 영어', () => {
    render(<TtsFailureNotice />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The sound didn't play. Please press the Listen button below.",
    );
  });
});
