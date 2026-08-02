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

// ─── Azure 발음 평가(음소 단위) 채점 정책 ─────────────────────────────
//
// 위 evaluateSpeech는 "STT가 인식한 텍스트와 목표의 문자열 근접도"라, STT 오인식과
// 조음 오류를 구분하지 못한다. Azure Pronunciation Assessment는 오디오에서 직접
// 음소 정확도를 재므로 이 한계가 없다. 서버 발음 평가가 가능하면 이쪽을 쓰고,
// 불가능하면(WebSpeech·미구성) evaluateSpeech로 폴백한다.

/** ai-service /pronunciation 응답의 점수 부분(0~100). */
export interface AzurePronunciationScores {
  /** 음소 정확도 평균 */
  accuracyScore: number;
  /** 유창성 */
  fluencyScore: number;
  /** 완성도(빠뜨림 없이 말한 비율) */
  completenessScore: number;
  /** 종합 발음 점수 */
  pronunciationScore: number;
  /** 운율(억양·강세). 미지원 시 null */
  prosodyScore: number | null;
}

/**
 * Azure 점수를 정답/오답·등급으로 매핑하는 관대한 임계값(0~100).
 *
 * 대상이 실어증·구음장애 어르신이라, 목적은 임상 등급이 아니라 격려와 진전
 * 추적이다. 문자열 채점의 정답 경계(오류율 0.34 = 점수 66)보다 약간 더 관대하게
 * good 경계를 60으로 둔다. 완벽주의로 좌절시키지 않는 것이 재활 지속에 중요하다.
 */
const AZURE_GRADE_THRESHOLDS = {
  perfect: 90,
  great: 75,
  good: 60, // 이상이면 정답 처리
  close: 40,
} as const;

/**
 * 종합 점수를 낸다. 단어(따라말하기 낱말)는 조음 정확도가 전부지만,
 * 문장은 "얼마나 많이 말했는가(완성도)"도 함께 봐야 빠뜨림에 정직하다.
 */
function azureComposite(
  azure: AzurePronunciationScores,
  mode: 'word' | 'sentence',
): number {
  if (mode === 'word') return azure.accuracyScore;
  return Math.round(azure.accuracyScore * 0.6 + azure.completenessScore * 0.4);
}

function gradeFromScore(score: number): PronunciationGrade {
  if (score >= AZURE_GRADE_THRESHOLDS.perfect) return 'perfect';
  if (score >= AZURE_GRADE_THRESHOLDS.great) return 'great';
  if (score >= AZURE_GRADE_THRESHOLDS.good) return 'good';
  if (score >= AZURE_GRADE_THRESHOLDS.close) return 'close';
  return 'retry';
}

/**
 * Azure 발음 평가 결과로 발화를 종합 평가한다(evaluateSpeech의 음소 단위 대체).
 *
 * transcript가 비면(NoMatch → 전 점수 0) retry·오답으로 본다.
 */
export function evaluateFromAzure(
  azure: AzurePronunciationScores,
  transcript: string,
  mode: 'word' | 'sentence',
): SpeechEvaluation {
  if (transcript.trim().length === 0) {
    return {
      grade: 'retry',
      score: 0,
      isCorrect: false,
      encouragement: patientEncouragement('retry'),
      caregiverLabel: caregiverGradeLabel('retry'),
    };
  }
  const composite = azureComposite(azure, mode);
  const grade = gradeFromScore(composite);
  return {
    grade,
    score: composite,
    isCorrect: isGradePass(grade),
    encouragement: patientEncouragement(grade),
    caregiverLabel: caregiverGradeLabel(grade),
  };
}
