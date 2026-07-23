// 발음 정확도 점수화 — 따라말하기(검사6)·소리 내어 읽기(검사7)의 발화 정확도를
// 5단계 등급 + 0~100 점수 + 격려 문구로 나눈다.
//
// 노출 정책: 어르신에게는 숫자 대신 '격려 문구'만, 보호자에게는 숫자 점수를 보여준다.
// 주의: 이 점수는 "STT가 인식한 것과 목표의 근접도"이지 순수 조음 정확도가 아니다.
//       (STT 오인식과 조음 오류를 구분하지 못함) → 격려·진전 추적용, 임상 진단 과신 금지.

import { speechErrorRate } from './speechScore.js';

/** 발음 정확도 5단계 등급 (perfect > great > good > close > retry). */
export type PronunciationGrade =
  | 'perfect'
  | 'great'
  | 'good'
  | 'close'
  | 'retry';

/**
 * 오류율(0=완전 일치)을 5단계 등급으로 나눈다.
 * good 이하(rate ≤ 0.34)까지 정답 처리 — 기존 SPEECH_PASS_THRESHOLD와 일치.
 */
export function gradeFromErrorRate(rate: number): PronunciationGrade {
  if (rate <= 0) return 'perfect';
  if (rate <= 0.15) return 'great';
  if (rate <= 0.34) return 'good';
  if (rate <= 0.5) return 'close';
  return 'retry';
}

/** 보호자용 정확도 점수 0~100 (오류율의 역). */
export function accuracyScore(rate: number): number {
  return Math.round(Math.max(0, 1 - Math.min(rate, 1)) * 100);
}

/** good 이상이면 정답으로 본다(정답 처리 경계). */
export function isGradePass(grade: PronunciationGrade): boolean {
  return grade === 'perfect' || grade === 'great' || grade === 'good';
}

/** 어르신용 격려 문구(숫자 미노출). */
const ENCOURAGEMENT: Record<PronunciationGrade, string> = {
  perfect: '완벽해요! 아주 정확하게 말씀하셨어요',
  great: '아주 잘하셨어요!',
  good: '잘하셨어요!',
  close: '거의 다 왔어요. 조금만 더 해볼까요?',
  retry: '괜찮아요. 다시 한 번 해볼까요?',
};

/** 보호자용 등급 라벨(숫자와 함께 표시). */
const CAREGIVER_LABEL: Record<PronunciationGrade, string> = {
  perfect: '완벽',
  great: '아주 좋음',
  good: '좋음',
  close: '근접',
  retry: '재시도',
};

/** 어르신용 격려 문구를 반환. */
export function patientEncouragement(grade: PronunciationGrade): string {
  return ENCOURAGEMENT[grade];
}

/** 보호자용 등급 라벨을 반환. */
export function caregiverGradeLabel(grade: PronunciationGrade): string {
  return CAREGIVER_LABEL[grade];
}

/** 발화 평가 종합 결과. */
export interface SpeechEvaluation {
  /** 5단계 등급 */
  grade: PronunciationGrade;
  /** 보호자용 정확도 점수 0~100 */
  score: number;
  /** 정답 처리 여부(good 이상) */
  isCorrect: boolean;
  /** 어르신용 격려 문구 */
  encouragement: string;
  /** 보호자용 등급 라벨 */
  caregiverLabel: string;
}

/**
 * 발화(따라말하기/읽기)를 종합 평가한다.
 * 어르신에게는 encouragement를, 보호자에게는 score/caregiverLabel을 노출한다.
 */
export function evaluateSpeech(
  transcript: string,
  target: string,
  mode: 'word' | 'sentence',
): SpeechEvaluation {
  const rate = speechErrorRate(transcript, target, mode);
  const grade = gradeFromErrorRate(rate);
  return {
    grade,
    score: accuracyScore(rate),
    isCorrect: isGradePass(grade),
    encouragement: patientEncouragement(grade),
    caregiverLabel: caregiverGradeLabel(grade),
  };
}
