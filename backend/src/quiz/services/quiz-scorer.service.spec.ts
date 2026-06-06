import { QuizQuestion } from '../entities/quiz-question.entity';
import { QuizQuestionType } from '../constants/quiz-question-type';
import { QuizScorerService } from './quiz-scorer.service';

/**
 * QuizScorerService 도메인 순수 로직 단위 테스트 (R3 점수 / R4 빈칸 엄격도).
 *
 * 검증 범위:
 *  - multiple_choice: 공백/대소문자 차이 정답 처리, 오답
 *  - yes_no: 다양한 긍/부정 표현 정규화, 반대 답 오답
 *  - fill_blank(R4=(b)): 띄어쓰기 무시, 받침(종성) 제거 후 비교, 완전 오답
 *  - toScore: 정답 비율 → 0..100 환산 + 반올림 + total<=0 방어
 */
describe('QuizScorerService', () => {
  let scorer: QuizScorerService;

  beforeEach(() => {
    scorer = new QuizScorerService();
  });

  /** 테스트용 QuizQuestion 엔티티 팩토리 (필요 필드만 채움) */
  function buildQuestion(
    type: QuizQuestionType,
    correctAnswer: string,
  ): QuizQuestion {
    return {
      type,
      correctAnswer,
    } as QuizQuestion;
  }

  describe('isCorrect — multiple_choice (객관식: trim + 소문자 정규화)', () => {
    it('정답과 완전히 동일하면 true를 반환해야 한다', () => {
      const question = buildQuestion('multiple_choice', '공원');
      expect(scorer.isCorrect(question, '공원')).toBe(true);
    });

    it('앞뒤 공백 차이만 있으면 정답으로 처리해야 한다', () => {
      const question = buildQuestion('multiple_choice', '공원');
      expect(scorer.isCorrect(question, '  공원  ')).toBe(true);
    });

    it('영문 대소문자 차이만 있으면 정답으로 처리해야 한다', () => {
      const question = buildQuestion('multiple_choice', 'Apple');
      expect(scorer.isCorrect(question, 'apple')).toBe(true);
    });

    it('내용이 다르면 오답(false)이어야 한다', () => {
      const question = buildQuestion('multiple_choice', '공원');
      expect(scorer.isCorrect(question, '바다')).toBe(false);
    });
  });

  describe('isCorrect — yes_no (긍/부정 표현 정규화)', () => {
    // 정답이 'yes'인 경우: 다양한 긍정 표현을 정답 처리
    it.each(['예', '네', '응', 'yes', 'y', 'true', 'o', 'ㅇ', 'YES', ' 예 '])(
      "정답이 'yes'일 때 '%s' 입력은 정답이어야 한다",
      (input) => {
        const question = buildQuestion('yes_no', 'yes');
        expect(scorer.isCorrect(question, input)).toBe(true);
      },
    );

    // 정답이 'no'인 경우: 다양한 부정 표현을 정답 처리
    it.each(['아니오', '아니요', '아뇨', 'no', 'n', 'false', 'x', 'NO'])(
      "정답이 'no'일 때 '%s' 입력은 정답이어야 한다",
      (input) => {
        const question = buildQuestion('yes_no', 'no');
        expect(scorer.isCorrect(question, input)).toBe(true);
      },
    );

    it("정답이 'yes'인데 반대 답('아니오')을 내면 오답이어야 한다", () => {
      const question = buildQuestion('yes_no', 'yes');
      expect(scorer.isCorrect(question, '아니오')).toBe(false);
    });

    it("정답이 'no'인데 반대 답('예')을 내면 오답이어야 한다", () => {
      const question = buildQuestion('yes_no', 'no');
      expect(scorer.isCorrect(question, '예')).toBe(false);
    });

    it('긍/부정 토큰에 없는 임의 문자열은 정규화되지 않아 오답이어야 한다', () => {
      const question = buildQuestion('yes_no', 'yes');
      expect(scorer.isCorrect(question, '글쎄요')).toBe(false);
    });
  });

  describe('isCorrect — fill_blank (R4=(b): 공백 제거 + 받침 제거)', () => {
    it('완전히 동일한 입력은 정답이어야 한다', () => {
      const question = buildQuestion('fill_blank', '강아지');
      expect(scorer.isCorrect(question, '강아지')).toBe(true);
    });

    it('띄어쓰기 차이("공 원" vs "공원")는 정답으로 처리해야 한다', () => {
      const question = buildQuestion('fill_blank', '공원');
      expect(scorer.isCorrect(question, '공 원')).toBe(true);
    });

    it('받침 차이를 무시한다 — 정답 "산", 입력 "사"는 받침 제거 후 동일하여 정답이어야 한다', () => {
      // stripJongseong: '산'(받침 ㄴ) → '사', '사'(받침 없음) → '사' ⇒ 동일
      const question = buildQuestion('fill_blank', '산');
      expect(scorer.isCorrect(question, '사')).toBe(true);
    });

    it('받침 차이를 무시한다 — 정답 "강아지", 입력 "강아징"도 정답이어야 한다', () => {
      // '징'(받침 ㅇ) → '지' ⇒ 정답 '강아지'와 동일
      const question = buildQuestion('fill_blank', '강아지');
      expect(scorer.isCorrect(question, '강아징')).toBe(true);
    });

    it('받침 제거 + 띄어쓰기 무시를 동시에 적용한다', () => {
      // 입력 '바 다ㄴ' 형태 대신 받침 케이스: '받침' 정답 → '바침'(첫 음절 받침 제거 결과)
      const question = buildQuestion('fill_blank', '받침');
      // '받'→'바', '침'→'치' ⇒ 정규화 '바치'. 입력 '바 치'도 동일해야 함
      expect(scorer.isCorrect(question, '바 치')).toBe(true);
    });

    it('완전히 다른 단어는 오답이어야 한다', () => {
      const question = buildQuestion('fill_blank', '강아지');
      expect(scorer.isCorrect(question, '고양이')).toBe(false);
    });
  });

  describe('isCorrect — 알 수 없는 유형', () => {
    it('정의되지 않은 type이면 false를 반환해야 한다 (default 분기)', () => {
      const question = buildQuestion('unknown_type' as QuizQuestionType, '값');
      expect(scorer.isCorrect(question, '값')).toBe(false);
    });
  });

  describe('toScore — 정답 비율 → 0..100 환산 (R3=(b))', () => {
    it('(5,5) → 100점이어야 한다', () => {
      expect(scorer.toScore(5, 5)).toBe(100);
    });

    it('(4,5) → 80점이어야 한다', () => {
      expect(scorer.toScore(4, 5)).toBe(80);
    });

    it('(3,5) → 60점이어야 한다', () => {
      expect(scorer.toScore(3, 5)).toBe(60);
    });

    it('(0,5) → 0점이어야 한다', () => {
      expect(scorer.toScore(0, 5)).toBe(0);
    });

    it('(1,3) → 반올림하여 33점이어야 한다 (Math.round)', () => {
      // (1/3)*100 = 33.33... → 33
      expect(scorer.toScore(1, 3)).toBe(33);
    });

    it('(2,3) → 반올림하여 67점이어야 한다 (Math.round 올림)', () => {
      // (2/3)*100 = 66.66... → 67
      expect(scorer.toScore(2, 3)).toBe(67);
    });

    it('totalQuestions가 0이면 0점을 반환해야 한다 (0 나눗셈 방어)', () => {
      expect(scorer.toScore(0, 0)).toBe(0);
    });

    it('totalQuestions가 음수이면 0점을 반환해야 한다', () => {
      expect(scorer.toScore(3, -1)).toBe(0);
    });
  });
});
