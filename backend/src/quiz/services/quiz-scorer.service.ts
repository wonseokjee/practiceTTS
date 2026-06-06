import { Injectable } from '@nestjs/common';
import { QuizQuestion } from '../entities/quiz-question.entity';
import { IQuizScorer } from '../interfaces/IQuizScorer';

/** yes/no 정규화 매핑 — 긍정 표현 집합 (o/ㅇ 포함: O/X 토글 UI 대응) */
const YES_TOKENS = new Set(['예', '네', '응', 'yes', 'y', 'true', 'o', 'ㅇ']);
/** yes/no 정규화 매핑 — 부정 표현 집합 (x 포함: O/X 토글 UI 대응) */
const NO_TOKENS = new Set([
  '아니오',
  '아니요',
  '아뇨',
  'no',
  'n',
  'false',
  'x',
]);

/** 한글 음절 영역 시작/끝 (가 ~ 힣) */
const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
/** 종성(받침) 경우의 수 */
const HANGUL_JONGSEONG_COUNT = 28;

/**
 * 채점기 구현체 (R3 점수 / R4 빈칸 엄격도).
 *
 * - multiple_choice: 공백 trim + 대소문자 무시 후 정확 일치.
 * - yes_no: 다양한 긍/부정 표현을 'yes'/'no'로 정규화 후 비교.
 * - fill_blank: 모든 공백 제거 + 각 한글 음절의 받침 제거 후 정확 일치 (R4=(b)).
 */
@Injectable()
export class QuizScorerService implements IQuizScorer {
  isCorrect(question: QuizQuestion, userAnswer: string): boolean {
    switch (question.type) {
      case 'multiple_choice':
        return (
          this.normalizeLoose(userAnswer) ===
          this.normalizeLoose(question.correctAnswer)
        );
      case 'yes_no':
        return (
          this.normalizeYesNo(userAnswer) ===
          this.normalizeYesNo(question.correctAnswer)
        );
      case 'fill_blank':
        return (
          this.normalizeFillBlank(userAnswer) ===
          this.normalizeFillBlank(question.correctAnswer)
        );
      default:
        return false;
    }
  }

  toScore(correctCount: number, totalQuestions: number): number {
    if (totalQuestions <= 0) {
      return 0;
    }
    return Math.round((correctCount / totalQuestions) * 100);
  }

  /** 공백 trim + 소문자화 (객관식) */
  private normalizeLoose(value: string): string {
    return value.trim().toLowerCase();
  }

  /** 긍/부정 표현을 'yes'/'no'로 정규화 (미일치 시 원본 소문자) */
  private normalizeYesNo(value: string): string {
    const token = value.trim().toLowerCase();
    if (YES_TOKENS.has(token)) {
      return 'yes';
    }
    if (NO_TOKENS.has(token)) {
      return 'no';
    }
    return token;
  }

  /**
   * 빈칸 채점 정규화 (R4=(b)):
   *  (1) 모든 공백 제거
   *  (2) 각 한글 음절의 종성(받침) 제거 (비한글 문자는 그대로)
   */
  private normalizeFillBlank(value: string): string {
    const withoutSpaces = value.replace(/\s+/g, '');
    let result = '';
    for (const char of withoutSpaces) {
      result += this.stripJongseong(char);
    }
    return result.toLowerCase();
  }

  /** 단일 문자에서 한글 받침을 제거한다. 비한글이면 원본 반환. */
  private stripJongseong(char: string): string {
    const code = char.charCodeAt(0);
    if (code < HANGUL_SYLLABLE_START || code > HANGUL_SYLLABLE_END) {
      return char;
    }
    const base = code - HANGUL_SYLLABLE_START;
    const jongseong = base % HANGUL_JONGSEONG_COUNT;
    return String.fromCharCode(code - jongseong);
  }
}
