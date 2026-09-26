// 이웃 비교 판정 골든 벡터 — TS ↔ Python 실측 코드의 계약.
//
// 왜 필요한가: 같은 판정 규칙이 두 곳에 있다.
//   정본  : 이 폴더의 neighborScoring.ts (앱이 실제로 쓰는 것)
//   재현본: scripts/asr_eval/azure_neighbor_eval.py (0단계 실측 — 오통과 3.5%·모호율 13.0%)
//
// 실측 수치는 재현본의 규칙으로 낸 것이다. 앱 규칙이 달라지면 그 수치는 앱에 대한 근거가 못 된다.
// 예전 방어(speechScoreGolden.test.ts와 같은 이야기)는 주석 한 줄이었고, 활발히 바뀌는 쪽은 앱이다.
// 그래서 입력·출력 쌍을 파일에 **얼려서** 양쪽이 각자 재현하는지 본다.
//
// 벡터를 고칠 때(= 판정 규칙을 의도적으로 바꿀 때):
//   UPDATE_GOLDEN=1 npx vitest run src/memory-link/patient/quiz/domain/neighborScoringGolden.test.ts
// 그다음 Python 테스트(scripts/asr_eval/test_neighbor_golden.py)를 돌려 재현본도 같이 고쳐야 통과한다.
// 한쪽만 바꾸면 반드시 빨간불이 난다 — 자동 재생성으로 두지 않는 이유가 이것이다.
//
// 입력의 형태는 **서버 응답 기준**이다(competitor_scores 항목·stt_status). `pythonModelled: false`인
// 사례는 Python 실측이 모델링하지 못하는 것(캐시로 돌리는 실측에는 호출 실패·건너뜀이 없다)이라
// TS만 고정한다.

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PARTIAL_MIN_RATIO } from './nameMatch.js';
import {
  evaluateNamingWithNeighbors,
  isAcceptedNamingVariant,
  type CompetitorScore,
} from './neighborScoring.js';

const VECTOR_PATH = resolve(
  __dirname,
  '../../../../../../scripts/asr_eval/golden/neighbor_decisions.json',
);

type Verdict = 'pass' | 'fail' | 'ambiguous' | 'unscored';

interface Entry {
  text: string;
  source: 'neighbor' | 'stt';
  accuracy: number;
  status: 'ok' | 'no_match' | 'error';
}

interface DecisionCase {
  name: string;
  target: string;
  targetAccuracy: number;
  /** 목표를 참조로 채점할 때 Azure가 인식한 텍스트. 비면 NoMatch. */
  targetText: string;
  sttStatus: 'ok' | 'empty' | 'error' | null;
  /** null = 경쟁자를 채점하지 않았다. */
  competitors: Entry[] | null;
  /** Python 실측 코드가 재현할 수 있는 사례인가. */
  pythonModelled: boolean;
}

interface Vectors {
  passLine: number;
  partialMinRatio: number;
  variants: { said: string; target: string; accepted: boolean }[];
  decisions: (DecisionCase & { verdict: Verdict })[];
}

// ── 사례 ─────────────────────────────────────────────────────
// 규칙의 각 갈래가 단독으로 드러나게 고른다: 정답선·동점·이웃/인식 경쟁자·변형 제외·조각·
// 부분 명칭 경계(정확히 60%)·no_match·채점 불가 각 경로.

const n = (text: string, accuracy: number, status: Entry['status'] = 'ok'): Entry => ({
  text, source: 'neighbor', accuracy, status,
});
const s = (text: string, accuracy: number): Entry => ({
  text, source: 'stt', accuracy, status: 'ok',
});

const base = { targetText: '(목표)', sttStatus: 'ok' as const, pythonModelled: true };
const CASES: DecisionCase[] = [
  { ...base, name: '정답 — 경쟁자가 모두 낮다', target: '고래', targetAccuracy: 90, competitors: [n('구름', 20), n('가위', 30), s('노래', 50)] },
  { ...base, name: '오답 — 정답선 바로 아래(59.9)', target: '고래', targetAccuracy: 59.9, competitors: [n('구름', 10)] },
  { ...base, name: '정답 — 정답선 정확히(60), 경쟁자 없음', target: '고래', targetAccuracy: 60, competitors: [] },
  { ...base, name: '정답 — 동점(m=0)', target: '고래', targetAccuracy: 80, competitors: [n('노래', 80)] },
  { ...base, name: '모호 — 이웃이 더 높다(고래←노래)', target: '고래', targetAccuracy: 80, competitors: [n('노래', 91), n('구름', 20)] },
  { ...base, name: '모호 — 인식 경쟁자가 더 높다', target: '고래', targetAccuracy: 80, competitors: [n('구름', 10), s('모래', 85)] },
  { ...base, name: '정답 — 부분 명칭(통나무←나무)은 경쟁자가 아니다', target: '통나무', targetAccuracy: 85, competitors: [n('마루', 20), s('나무', 90)] },
  { ...base, name: '정답 — 목표를 품는 말(사과←사과요)', target: '사과', targetAccuracy: 84, competitors: [s('사과요', 95)] },
  { ...base, name: '모호 — 조각(비행기←비, 1/3)은 경쟁자다', target: '비행기', targetAccuracy: 80, competitors: [s('비', 90)] },
  { ...base, name: '정답 — 부분 명칭 경계(가나다←가나다라마, 정확히 60%)', target: '가나다라마', targetAccuracy: 80, competitors: [s('가나다', 90)] },
  { ...base, name: '모호 — 부분 명칭 경계 아래(가나, 40%)', target: '가나다라마', targetAccuracy: 80, competitors: [s('가나', 90)] },
  { ...base, name: '모호 — 이웃 쪽의 변형 텍스트는 거르지 않는다', target: '통나무', targetAccuracy: 85, competitors: [n('나무', 90)] },
  { ...base, name: '정답 — no_match 경쟁자는 0점', target: '고래', targetAccuracy: 60, competitors: [n('노래', 0, 'no_match')] },
  { ...base, name: '정답 — no_match 경쟁자는 점수 값이 무엇이든 0점이다', target: '고래', targetAccuracy: 60, competitors: [n('노래', 99, 'no_match')] },
  { ...base, name: '정답 — 이웃과 인식 결과가 같은 단어(중복)', target: '고래', targetAccuracy: 90, competitors: [n('노래', 70), s('노래', 70)] },
  { ...base, name: '모호 — 이웃과 인식 결과가 같은 단어이고 더 높다', target: '고래', targetAccuracy: 60, competitors: [n('노래', 70), s('노래', 70)] },
  { ...base, name: '채점 불가 — 목표 인식 결과가 없다(NoMatch)', target: '고래', targetAccuracy: 0, targetText: '', competitors: [] },
  { ...base, name: '채점 불가 — 이웃 호출 실패', target: '고래', targetAccuracy: 90, competitors: [n('구름', 10), n('가위', 0, 'error')] },
  // 아래는 Python 실측이 모델링하지 못한다(캐시로 돌리므로 호출 실패·건너뜀·응답 누락이 없다)
  { ...base, name: '채점 불가 — 인식 호출 실패', target: '고래', targetAccuracy: 90, sttStatus: 'error', competitors: [n('구름', 10)], pythonModelled: false },
  { ...base, name: '채점 불가 — 인식 응답이 없다', target: '고래', targetAccuracy: 90, sttStatus: null, competitors: [n('구름', 10)], pythonModelled: false },
  { ...base, name: '채점 불가 — 정답선을 넘었는데 경쟁자를 건너뛴 응답', target: '고래', targetAccuracy: 90, competitors: null, pythonModelled: false },
  { ...base, name: '오답 — 서버가 경쟁자를 건너뛴 응답(목표 59)', target: '고래', targetAccuracy: 59, competitors: null, pythonModelled: false },
  { ...base, name: '정답 — 인식 결과 없음(empty)은 실패가 아니다', target: '고래', targetAccuracy: 90, sttStatus: 'empty', competitors: [n('구름', 10)] },
];

const VARIANT_CASES: [string, string][] = [
  ['사과', '사과'],
  ['사과요', '사과'],
  ['나무', '통나무'],
  ['가나다', '가나다라마'], // 정확히 60% — 부동소수 경계
  ['가나다라', '가나다라마'],
  ['가나', '가나다라마'],
  ['가나', '가나다라'], // 50% — 비율을 0.5로 낮추면 여기서 걸린다
  ['가나다', '가나다라'], // 75%
  ['비', '비행기'],
  ['행', '비행기'],
  ['노래', '고래'],
  ['', '고래'],
  ['고래', ''],
  ['고 래.', '고래'], // 공백·문장부호
  ['나 무!', '통나무'],
];

function verdictOf(c: DecisionCase): Verdict {
  const scores: CompetitorScore[] | null = c.competitors
    ? c.competitors.map((e) => ({
        text: e.text,
        source: e.source,
        accuracyScore: e.accuracy,
        recognizedText: e.status === 'ok' ? e.text : '',
        status: e.status,
      }))
    : null;
  const v = evaluateNamingWithNeighbors({
    azure: {
      accuracyScore: c.targetAccuracy,
      fluencyScore: 0,
      completenessScore: 100,
      pronunciationScore: c.targetAccuracy,
      prosodyScore: null,
    },
    transcript: c.targetText,
    targetWord: c.target,
    competitors: {
      scores,
      sttTranscript: null,
      sttStatus: c.sttStatus,
      skipped: null,
    },
  });
  if (v.kind === 'ambiguous') return 'ambiguous';
  if (!v.assessment.scored) return 'unscored';
  return v.assessment.isCorrect ? 'pass' : 'fail';
}

function build(): Vectors {
  return {
    passLine: 60,
    partialMinRatio: PARTIAL_MIN_RATIO,
    variants: VARIANT_CASES.map(([said, target]) => ({
      said,
      target,
      accepted: isAcceptedNamingVariant(said, target),
    })),
    decisions: CASES.map((c) => ({ ...c, verdict: verdictOf(c) })),
  };
}

describe('이웃 비교 판정 골든 벡터 (TS는 정본)', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('벡터를 다시 쓴다 (UPDATE_GOLDEN=1)', () => {
      writeFileSync(VECTOR_PATH, JSON.stringify(build(), null, 2) + '\n', 'utf-8');
      // 다시 쓴 뒤에는 Python 테스트도 돌려야 한다. 재현본이 안 따라왔으면 거기서 빨간불이 난다.
      expect(true).toBe(true);
    });
    return;
  }

  const frozen: Vectors = JSON.parse(readFileSync(VECTOR_PATH, 'utf-8'));

  it('정답선과 부분 명칭 비율이 얼린 값과 같다', () => {
    expect(frozen.passLine).toBe(60);
    expect(PARTIAL_MIN_RATIO).toBe(frozen.partialMinRatio);
  });

  it('변형 판정이 얼린 벡터와 같다', () => {
    for (const v of frozen.variants) {
      expect(isAcceptedNamingVariant(v.said, v.target), `${v.said} ← ${v.target}`).toBe(v.accepted);
    }
  });

  it('판정이 얼린 벡터와 같다', () => {
    for (const d of frozen.decisions) {
      expect(verdictOf(d), d.name).toBe(d.verdict);
    }
  });

  it('벡터가 사례 목록과 같다 — 사례를 고쳤는데 벡터를 안 다시 쓴 것을 막는다', () => {
    expect(frozen).toEqual(build());
  });

  it('네 판정이 모두 벡터에 있다', () => {
    const seen = new Set(frozen.decisions.map((d) => d.verdict));
    expect([...seen].sort()).toEqual(['ambiguous', 'fail', 'pass', 'unscored']);
  });
});
