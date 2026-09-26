import { describe, expect, it } from 'vitest';
import {
  SCORER_VERSION_NEIGHBOR,
  SCORER_VERSION_V1,
  evaluateNamingWithNeighbors,
  isAcceptedNamingVariant,
  type CompetitorInfo,
  type CompetitorScore,
} from './neighborScoring.js';
import { UNSCORED } from './pronunciationScore.js';

// 이웃 비교 채점의 판정 규칙. 0단계 실측(scripts/asr_eval/azure_neighbor_eval.py)이 같은 규칙을
// 재현하는지는 neighborScoringGolden.test.ts가 골든 벡터로 고정한다 — 여기서는 규칙의 의미를 본다.

const azure = (accuracyScore: number) => ({
  accuracyScore,
  fluencyScore: 0,
  completenessScore: 100,
  pronunciationScore: accuracyScore,
  prosodyScore: null,
});

const neighbor = (
  text: string,
  accuracyScore: number,
  status: CompetitorScore['status'] = 'ok',
): CompetitorScore => ({
  text,
  source: 'neighbor',
  accuracyScore,
  recognizedText: status === 'ok' ? text : '',
  status,
});

const stt = (text: string, accuracyScore: number): CompetitorScore => ({
  text,
  source: 'stt',
  accuracyScore,
  recognizedText: text,
  status: 'ok',
});

const info = (
  scores: CompetitorScore[] | null,
  over: Partial<CompetitorInfo> = {},
): CompetitorInfo => ({
  scores,
  sttTranscript: null,
  sttStatus: 'ok',
  skipped: null,
  ...over,
});

const judge = (
  targetAccuracy: number,
  competitors: CompetitorInfo | null | undefined,
  targetWord = '고래',
  transcript = targetWord,
) =>
  evaluateNamingWithNeighbors({
    azure: azure(targetAccuracy),
    transcript,
    targetWord,
    competitors,
  });

/** 정답·오답·채점 불가·모호를 한 단어로. */
function label(v: ReturnType<typeof judge>): string {
  if (v.kind === 'ambiguous') return 'ambiguous';
  if (!v.assessment.scored) return 'unscored';
  return v.assessment.isCorrect ? 'pass' : 'fail';
}

describe('evaluateNamingWithNeighbors', () => {
  describe('목표 채점이 먼저다', () => {
    it('목표가 정답선(60) 미만이면 오답이다 — 경쟁자는 보지 않는다', () => {
      expect(label(judge(59.9, info([neighbor('노래', 10)])))).toBe('fail');
      // 경쟁자 결과가 없어도 오답이다(서버가 건너뛴 경우)
      expect(label(judge(30, info(null, { skipped: 'target_below_pass' })))).toBe('fail');
      expect(label(judge(30, undefined))).toBe('fail');
    });

    it('정답선(60) 정확히는 넘는다', () => {
      expect(label(judge(60, info([])))).toBe('pass');
    });

    it('목표 채점을 못 얻었으면 채점 불가다', () => {
      expect(
        label(
          evaluateNamingWithNeighbors({
            azure: null,
            transcript: '고래',
            targetWord: '고래',
            competitors: info([]),
          }),
        ),
      ).toBe('unscored');
      expect(label(judge(90, info([]), '고래', '   '))).toBe('unscored'); // NoMatch
    });
  });

  describe('경쟁자와 비교', () => {
    it('목표가 모든 경쟁자보다 높으면 정답이다 — 채점 결과는 목표 채점 그대로다', () => {
      const v = judge(90, info([neighbor('노래', 50), stt('구름', 40)]));
      expect(label(v)).toBe('pass');
      if (v.kind === 'assessed' && v.assessment.scored) {
        expect(v.assessment.score).toBe(90);
        expect(v.assessment.grade).toBe('perfect');
      }
    });

    it('동점은 정답이다(m = 0)', () => {
      expect(label(judge(80, info([neighbor('노래', 80)])))).toBe('pass');
    });

    it('이웃이 더 높으면 모호다 — 오답이 아니다', () => {
      expect(label(judge(80, info([neighbor('노래', 91)])))).toBe('ambiguous');
    });

    it('후보 없이 인식한 결과가 더 높아도 모호다', () => {
      expect(label(judge(80, info([neighbor('노래', 10), stt('모래', 85)])))).toBe('ambiguous');
    });

    it('경쟁자가 하나도 없으면 정답이다(비교할 것이 없다)', () => {
      expect(label(judge(75, info([])))).toBe('pass');
    });

    it('그 참조로는 안 들린 경쟁자(no_match)는 0점이다 — 목표가 정답선이면 이긴다', () => {
      expect(label(judge(60, info([neighbor('노래', 0, 'no_match')])))).toBe('pass');
    });

    it('no_match는 점수 값이 무엇이든 0점이다 — 서버 계약은 0이지만 값을 믿지 않는다', () => {
      expect(label(judge(60, info([neighbor('노래', 99, 'no_match')])))).toBe('pass');
    });
  });

  describe('정답으로 보는 변형은 경쟁자가 아니다(설계 9절)', () => {
    it('부분 명칭: 통나무 문항에 "나무"라고 인식돼도 모호가 아니다', () => {
      expect(label(judge(85, info([stt('나무', 90)]), '통나무'))).toBe('pass');
    });

    it('목표를 품는 말: 사과 문항에 "사과요"', () => {
      expect(label(judge(84, info([stt('사과요', 95)]), '사과'))).toBe('pass');
    });

    it('조각(60% 미만)은 경쟁자다: 비행기 문항에 "비"', () => {
      expect(label(judge(80, info([stt('비', 90)]), '비행기'))).toBe('ambiguous');
    });

    it('변형 판정은 STT 경쟁자에만 적용한다 — 이웃은 그대로 센다', () => {
      // 이웃 목록은 포함관계를 미리 뺀다(neighbor_manifest.py). 그래도 규칙은 출처로 가른다.
      expect(label(judge(85, info([neighbor('나무', 90)]), '통나무'))).toBe('ambiguous');
    });
  });

  describe('경쟁자를 못 얻으면 채점 불가다 — 목표 점수만으로 채점하지 않는다', () => {
    it('경쟁자 결과가 없다(옛 서버·폴백)', () => {
      expect(label(judge(90, null))).toBe('unscored');
      expect(label(judge(90, undefined))).toBe('unscored');
    });

    it('목표는 정답선을 넘었는데 서버가 경쟁자를 건너뛰었다(이상한 응답)', () => {
      expect(label(judge(90, info(null, { skipped: 'target_below_pass' })))).toBe('unscored');
    });

    it('이웃 하나라도 호출이 실패했다', () => {
      expect(label(judge(90, info([neighbor('노래', 10), neighbor('모래', 0, 'error')])))).toBe(
        'unscored',
      );
    });

    it('인식 호출이 실패했거나 응답에 없다', () => {
      expect(label(judge(90, info([], { sttStatus: 'error' })))).toBe('unscored');
      expect(label(judge(90, info([], { sttStatus: null })))).toBe('unscored');
    });

    it('인식 결과가 없는 것(empty)은 실패가 아니다 — 경쟁자가 없을 뿐이다', () => {
      expect(label(judge(90, info([neighbor('노래', 10)], { sttStatus: 'empty' })))).toBe('pass');
    });

    it('채점 불가 결과는 기존 UNSCORED와 같다(환자 문구가 같다)', () => {
      const v = judge(90, null);
      expect(v).toEqual({ kind: 'assessed', assessment: UNSCORED });
    });
  });
});

describe('isAcceptedNamingVariant', () => {
  it.each([
    ['사과', '사과', true, '같다'],
    ['사과요', '사과', true, '목표를 품는 말'],
    ['나무', '통나무', true, '부분 명칭 2/3'],
    ['가나다', '가나다라마', true, '정확히 60%(3/5)'],
    ['가나다라', '가나다라마', true, '80%'],
    ['가나', '가나다라마', false, '40%'],
    ['가나', '가나다라', false, '정확히 50% — 비율은 60%다'],
    ['가나다', '가나다라', true, '75%'],
    ['비', '비행기', false, '조각 1/3'],
    ['행', '비행기', false, '가운데 조각'],
    ['노래', '고래', false, '소리만 가깝다'],
    ['', '고래', false, '빈 말'],
    ['고래', '', false, '빈 목표'],
    ['고 래.', '고래', true, '공백·문장부호는 무시한다'],
    ['나 무!', '통나무', true, '부분 명칭에도 정규화가 적용된다'],
  ])('%s ← %s = %s (%s)', (said, target, expected) => {
    // 인자 순서: (said, target). 표의 첫 열이 said다.
    expect(isAcceptedNamingVariant(said, target)).toBe(expected);
  });

  it('한글을 지우지 않는다 — JS의 \\w는 ASCII 전용이라 그대로 옮기면 전부 사라진다', () => {
    expect(isAcceptedNamingVariant('고래', '고래')).toBe(true);
    expect(isAcceptedNamingVariant('고래', '노래')).toBe(false);
  });
});

describe('채점기 버전 상수', () => {
  it('이전·이웃 비교 채점기의 이름', () => {
    expect(SCORER_VERSION_V1).toBe('azure-pa-v1');
    expect(SCORER_VERSION_NEIGHBOR).toBe('azure-pa-nbr-v1');
  });
});
