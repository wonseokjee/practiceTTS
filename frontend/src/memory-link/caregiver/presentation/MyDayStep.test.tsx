// MyDayStep.tsx — 보호자 자기 질문 단계 컴포넌트 테스트

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyDayStep } from './MyDayStep.js';
import type { DiaryQuestion } from '../domain/CaptureFlow.js';

const CAREGIVER_QUESTION: DiaryQuestion = {
  id: 'q-c-1',
  scope: 'caregiver',
  category: null,
  text: '오늘 본인을 위해 한 작은 일은?',
};

describe('MyDayStep', () => {
  function renderStep(overrides?: {
    question?: DiaryQuestion | null;
    answerText?: string;
  }) {
    const onChangeAnswerText = vi.fn();
    const onSkip = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <MyDayStep
        question={
          overrides?.question === undefined
            ? CAREGIVER_QUESTION
            : overrides.question
        }
        answerText={overrides?.answerText ?? ''}
        onChangeAnswerText={onChangeAnswerText}
        onSkip={onSkip}
        onNext={onNext}
        onPrev={onPrev}
      />,
    );
    return { onChangeAnswerText, onSkip, onNext, onPrev };
  }

  it('질문 텍스트를 렌더링한다', () => {
    renderStep();
    expect(screen.getByText(CAREGIVER_QUESTION.text)).toBeInTheDocument();
  });

  it('자물쇠 아이콘과 보호자 전용 캡션을 표시한다', () => {
    renderStep();
    expect(screen.getByText(/보호자 본인만 볼 수 있어요/)).toBeInTheDocument();
  });

  it('질문이 로드되지 않은 상태(null)에서는 안내 텍스트를 표시한다', () => {
    renderStep({ question: null });
    expect(screen.getByText(/질문을 불러오는 중/)).toBeInTheDocument();
  });

  it('Textarea 입력 시 onChangeAnswerText가 호출된다', () => {
    const { onChangeAnswerText } = renderStep();
    const textarea = screen.getByLabelText('나의 하루 답변');

    fireEvent.change(textarea, { target: { value: '커피 한 잔의 여유' } });
    expect(onChangeAnswerText).toHaveBeenCalledWith('커피 한 잔의 여유');
  });

  it('300자 maxLength 속성이 textarea에 적용된다', () => {
    renderStep();
    const textarea = screen.getByLabelText('나의 하루 답변');
    expect(textarea).toHaveAttribute('maxLength', '300');
  });

  it('answerText 길이가 글자 수 카운터에 반영된다', () => {
    renderStep({ answerText: '안녕하세요' });
    // "5 / 300" 표시
    const counter = screen.getByText('5');
    expect(counter).toBeInTheDocument();
  });

  it('"건너뛰기" 클릭 시 onSkip이 호출된다', () => {
    const { onSkip } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '이 단계 건너뛰기' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('"다음" 클릭 시 onNext가 호출된다', () => {
    const { onNext } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '다음 단계로 이동' }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('"이전" 클릭 시 onPrev가 호출된다', () => {
    const { onPrev } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(onPrev).toHaveBeenCalledOnce();
  });
});
