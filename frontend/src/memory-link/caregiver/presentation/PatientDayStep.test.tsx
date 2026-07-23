// PatientDayStep.tsx — 환자 카테고리별 질문 + 사진 첨부 단계 테스트

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PatientDayStep } from './PatientDayStep.js';
import type { DiaryQuestion } from '../domain/CaptureFlow.js';
import type {
  PatientAnswerTextMap,
  PatientQuestionMap,
} from '../application/useCaptureFlow.js';

const Q_ACTIVITY: DiaryQuestion = {
  id: 'q-act',
  scope: 'patient',
  category: 'activity',
  text: '오늘 어떤 활동을 함께 하셨나요?',
};
const Q_MOMENT: DiaryQuestion = {
  id: 'q-mom',
  scope: 'patient',
  category: 'moment',
  text: '기억에 남는 순간은?',
};
const Q_CONTEXT: DiaryQuestion = {
  id: 'q-ctx',
  scope: 'patient',
  category: 'context',
  text: '오늘 만난 사람·장소·음식은?',
};

const QUESTIONS_ALL: PatientQuestionMap = {
  activity: Q_ACTIVITY,
  moment: Q_MOMENT,
  context: Q_CONTEXT,
};

const EMPTY_ANSWERS: PatientAnswerTextMap = {
  activity: '',
  moment: '',
  context: '',
};

describe('PatientDayStep', () => {
  beforeEach(() => {
    if (!('createObjectURL' in URL)) {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL =
        () => 'blob:mock';
    }
  });

  function renderStep(overrides?: {
    patientAnswers?: PatientAnswerTextMap;
    photo?: File | null;
    photoPreview?: string | null;
    isSubmitting?: boolean;
    error?: string | null;
  }) {
    const onChangePatientAnswer = vi.fn();
    const onChangeWishMessage = vi.fn();
    const onSelectPhoto = vi.fn();
    const onClearPhoto = vi.fn();
    const onPrev = vi.fn();
    const onSubmit = vi.fn();

    render(
      <PatientDayStep
        patientAnswers={overrides?.patientAnswers ?? EMPTY_ANSWERS}
        patientQuestions={QUESTIONS_ALL}
        photo={overrides?.photo ?? null}
        photoPreview={overrides?.photoPreview ?? null}
        isSubmitting={overrides?.isSubmitting ?? false}
        error={overrides?.error ?? null}
        caregiverWishMessage=""
        onChangeWishMessage={onChangeWishMessage}
        onChangePatientAnswer={onChangePatientAnswer}
        onSelectPhoto={onSelectPhoto}
        onClearPhoto={onClearPhoto}
        onPrev={onPrev}
        onSubmit={onSubmit}
      />,
    );

    return {
      onChangePatientAnswer,
      onChangeWishMessage,
      onSelectPhoto,
      onClearPhoto,
      onPrev,
      onSubmit,
    };
  }

  it('3개 카테고리 카드(활동/순간/사람·장소·음식)를 렌더링한다', () => {
    renderStep();

    expect(screen.getByText(Q_ACTIVITY.text)).toBeInTheDocument();
    expect(screen.getByText(Q_MOMENT.text)).toBeInTheDocument();
    expect(screen.getByText(Q_CONTEXT.text)).toBeInTheDocument();

    expect(
      screen.getByLabelText('활동 카테고리 답변'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('순간 카테고리 답변'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('사람·장소·음식 카테고리 답변'),
    ).toBeInTheDocument();
  });

  it('모든 답변이 비어있고 photo도 없으면 "저장" 버튼이 비활성화된다', () => {
    renderStep();
    const submitButton = screen.getByRole('button', {
      name: '오늘의 일기 저장',
    });
    expect(submitButton).toBeDisabled();
  });

  it('답변 1개 입력 상태에서는 "저장" 버튼이 활성화된다', () => {
    renderStep({
      patientAnswers: { activity: '공원 산책', moment: '', context: '' },
    });

    const submitButton = screen.getByRole('button', {
      name: '오늘의 일기 저장',
    });
    expect(submitButton).not.toBeDisabled();
  });

  it('답변 모두 공백이지만 photo만 있어도 "저장" 버튼이 활성화된다', () => {
    const fakeFile = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    renderStep({
      photo: fakeFile,
      photoPreview: 'blob:mock-preview',
    });

    const submitButton = screen.getByRole('button', {
      name: '오늘의 일기 저장',
    });
    expect(submitButton).not.toBeDisabled();
  });

  it('답변 모두 공백 문자만 있으면 "저장" 버튼이 비활성화된다', () => {
    renderStep({
      patientAnswers: { activity: '   ', moment: '\n', context: '' },
    });

    const submitButton = screen.getByRole('button', {
      name: '오늘의 일기 저장',
    });
    expect(submitButton).toBeDisabled();
  });

  it('Textarea 입력 시 해당 카테고리로 onChangePatientAnswer가 호출된다', () => {
    const { onChangePatientAnswer } = renderStep();

    const momentTextarea = screen.getByLabelText('순간 카테고리 답변');
    fireEvent.change(momentTextarea, { target: { value: '강아지를 만났다' } });

    expect(onChangePatientAnswer).toHaveBeenCalledWith(
      'moment',
      '강아지를 만났다',
    );
  });

  it('"저장" 클릭 시 onSubmit이 호출된다', () => {
    const { onSubmit } = renderStep({
      patientAnswers: { activity: '공원', moment: '', context: '' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: '오늘의 일기 저장' }),
    );
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('"이전" 클릭 시 onPrev가 호출된다', () => {
    const { onPrev } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('isSubmitting=true이면 저장 버튼이 "저장 중…" 텍스트와 비활성 상태가 된다', () => {
    renderStep({
      patientAnswers: { activity: '공원', moment: '', context: '' },
      isSubmitting: true,
    });

    const submitButton = screen.getByRole('button', { name: '저장 중' });
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('저장 중');
  });

  it('error prop이 있으면 alert로 표시된다', () => {
    renderStep({
      patientAnswers: { activity: '공원', moment: '', context: '' },
      error: '네트워크 오류',
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('네트워크 오류');
  });

  it('photo가 있으면 "제거" 버튼이 노출되고 클릭 시 onClearPhoto가 호출된다', () => {
    const fakeFile = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const { onClearPhoto } = renderStep({
      photo: fakeFile,
      photoPreview: 'blob:mock-preview',
    });

    const removeButton = screen.getByRole('button', {
      name: '첨부한 사진 제거',
    });
    fireEvent.click(removeButton);
    expect(onClearPhoto).toHaveBeenCalledOnce();
  });
});
