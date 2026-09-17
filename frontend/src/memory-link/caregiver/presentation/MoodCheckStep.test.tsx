// MoodCheckStep.tsx — 5단계 이모지 무드 체크 컴포넌트 테스트

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoodCheckStep } from './MoodCheckStep.js';
import { MOOD_VISUAL_TOKENS } from '../domain/CaptureFlow.js';
import { i18n } from '../../../shared/i18n/i18n.js';

describe('MoodCheckStep', () => {
  function renderStep(overrides?: {
    mood?: 1 | 2 | 3 | 4 | 5 | null;
    error?: string | null;
  }) {
    const onSelectMood = vi.fn();
    const onNext = vi.fn();
    render(
      <MoodCheckStep
        mood={overrides?.mood ?? null}
        onSelectMood={onSelectMood}
        onNext={onNext}
        error={overrides?.error ?? null}
      />,
    );
    return { onSelectMood, onNext };
  }

  it('5개 무드 이모지 버튼을 모두 렌더링한다', () => {
    renderStep();

    for (const token of MOOD_VISUAL_TOKENS) {
      expect(
        screen.getByRole('radio', { name: i18n.t(`caregiver:${token.labelKey}`) }),
      ).toBeInTheDocument();
    }
  });

  it('이모지 버튼 클릭 시 onSelectMood가 해당 level로 호출된다', () => {
    const { onSelectMood } = renderStep();

    const happyButton = screen.getByRole('radio', { name: '좋아요' });
    fireEvent.click(happyButton);

    expect(onSelectMood).toHaveBeenCalledWith(4);
  });

  it('mood 미선택 시 "다음" 버튼은 비활성화된다', () => {
    renderStep({ mood: null });

    const nextButton = screen.getByRole('button', {
      name: '다음 단계로 이동',
    });
    expect(nextButton).toBeDisabled();
  });

  it('mood 선택 후 "다음" 버튼이 활성화되고 클릭 시 onNext가 호출된다', () => {
    const { onNext } = renderStep({ mood: 3 });

    const nextButton = screen.getByRole('button', {
      name: '다음 단계로 이동',
    });
    expect(nextButton).not.toBeDisabled();

    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('선택된 무드 버튼은 aria-checked=true가 된다', () => {
    renderStep({ mood: 5 });

    const selectedButton = screen.getByRole('radio', { name: '매우 좋아요' });
    expect(selectedButton).toHaveAttribute('aria-checked', 'true');

    const otherButton = screen.getByRole('radio', { name: '매우 힘들어요' });
    expect(otherButton).toHaveAttribute('aria-checked', 'false');
  });

  it('error prop이 있으면 alert로 표시된다', () => {
    renderStep({ error: '오늘의 마음을 선택해주세요.' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('오늘의 마음을 선택해주세요.');
  });
});
