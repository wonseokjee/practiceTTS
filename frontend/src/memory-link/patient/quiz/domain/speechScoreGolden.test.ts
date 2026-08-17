// 발음 채점기 골든 벡터 — TS ↔ Python 이식본의 계약.
//
// 왜 필요한가: 같은 채점 로직이 두 곳에 있다.
//   정본  : 이 폴더의 phoneticDistance.ts + speechScore.ts (앱이 실제로 쓰는 것)
//   이식본: scripts/asr_eval/app_scorer.py (ASR 모델이 앱을 얼마나 좋게 하는지 잴 때)
//
// 예전 방어는 주석 한 줄과, Python 쪽에 기대값을 **하드코딩한** 미러 테스트였다.
// 그건 Python 쪽 드리프트만 잡는다. TS에서 W_JONG을 0.2→0.3으로 바꾸면 Python
// 테스트는 그대로 초록이고, 그때부터 608 평가는 앱이 안 쓰는 채점기로 측정한다.
// 그런데 활발히 바뀌는 쪽은 TS(앱)다.
//
// 그래서 입력·출력 쌍을 파일에 **얼려서** 양쪽이 각자 재현하는지 본다. 상수뿐
// 아니라 알고리즘 변경도 잡힌다 — 비용 계산식을 바꾸면 출력이 달라지니까.
//
// 벡터를 고칠 때(= 채점 규칙을 의도적으로 바꿀 때):
//   UPDATE_GOLDEN=1 npx vitest run src/memory-link/patient/quiz/domain/speechScoreGolden.test.ts
// 그러면 이 파일이 벡터를 다시 쓴다. 그 다음 Python 테스트를 돌려 이식본도 같이
// 고쳐야 통과한다 — 한쪽만 바꾸면 반드시 빨간불이 난다. 자동 재생성으로 두지
// 않는 이유가 이것이다. 매번 다시 쓰면 드리프트가 조용히 지나간다.

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decomposeHangul,
  syllablePhoneticCost,
} from './phoneticDistance.js';
import {
  SPEECH_PASS_THRESHOLD,
  isSpeechCorrect,
  speechErrorRate,
} from './speechScore.js';

/** 저장소 루트 기준 경로. Python 테스트도 같은 파일을 읽는다. */
const VECTOR_PATH = resolve(
  __dirname,
  '../../../../../../scripts/asr_eval/golden/speech_scorer_vectors.json',
);

type Mode = 'word' | 'sentence';

interface Vectors {
  threshold: number;
  decompose: { ch: string; jamo: [string, string, string] | null }[];
  syllableCost: { a: string; b: string; cost: number }[];
  errorRate: { transcript: string; target: string; mode: Mode; rate: number }[];
  isCorrect: {
    transcript: string;
    target: string;
    mode: Mode;
    correct: boolean;
  }[];
}

// ── 사례 선정 ─────────────────────────────────────────────────
// 상수 하나만 바꿔도 값이 움직이도록, 각 가중치가 단독으로 드러나는 입력을 고른다.
// 그래서 SAME_GROUP_COST·JONG_DROP_COST·W_CHO/JUNG/JONG·임계값이 전부 덮인다.

const DECOMPOSE_CASES = ['각', '가', '바', '파', '반', '값', 'a', '1', ' '];

const SYLLABLE_CASES: [string, string][] = [
  ['바', '바'], // 동일 → 0
  ['바', '파'], // 초성 같은 조음위치(양순 파열음) → SAME_GROUP × W_CHO
  ['반', '바'], // 종성 탈락 → JONG_DROP × W_JONG
  ['바', '다'], // 초성 다른 조음위치 → 1.0 × W_CHO
  ['바', '보'], // 중성만 다름 → W_JUNG 쪽
  ['각', '값'], // 종성 치환
  ['바', 'a'], // 한글 아님
];

const RATE_CASES: [string, string, Mode][] = [
  ['사과', '사과', 'word'],
  ['사가', '사과', 'word'], // 조음 유사 혼동 — 이식본이 관대해야 하는 지점
  ['파나나', '바나나', 'word'],
  ['', '사과', 'word'],
  ['사과', '', 'word'],
  ['바다에 갔다', '바다에 갔다', 'sentence'],
  ['바다에 간다', '바다에 갔다', 'sentence'],
  ['오늘 밥을 먹었어요', '오늘 밥을 먹었어요', 'sentence'],
  ['밥을 먹었어요', '오늘 밥을 먹었어요', 'sentence'],
  ['바다에, 갔다!', '바다에 갔다', 'sentence'], // 정규화(구두점) 경로
];

const CORRECT_CASES: [string, string, Mode][] = [
  ...RATE_CASES,
  ['   ', '사과', 'word'], // 공백만 → 무조건 오답
];

function build(): Vectors {
  return {
    threshold: SPEECH_PASS_THRESHOLD,
    decompose: DECOMPOSE_CASES.map((ch) => {
      const j = decomposeHangul(ch);
      return { ch, jamo: j === null ? null : [j.cho, j.jung, j.jong] };
    }),
    syllableCost: SYLLABLE_CASES.map(([a, b]) => ({
      a,
      b,
      cost: syllablePhoneticCost(a, b),
    })),
    errorRate: RATE_CASES.map(([transcript, target, mode]) => ({
      transcript,
      target,
      mode,
      rate: speechErrorRate(transcript, target, mode),
    })),
    isCorrect: CORRECT_CASES.map(([transcript, target, mode]) => ({
      transcript,
      target,
      mode,
      correct: isSpeechCorrect(transcript, target, mode),
    })),
  };
}

describe('발음 채점기 골든 벡터 (TS는 정본)', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('벡터를 다시 쓴다 (UPDATE_GOLDEN=1)', () => {
      writeFileSync(
        VECTOR_PATH,
        JSON.stringify(build(), null, 2) + '\n',
        'utf-8',
      );
      // 다시 쓴 뒤에는 Python 테스트도 돌려야 한다. 이식본이 안 따라왔으면
      // 거기서 빨간불이 난다 — 그게 이 장치의 요점이다.
      expect(true).toBe(true);
    });
    return;
  }

  const frozen: Vectors = JSON.parse(readFileSync(VECTOR_PATH, 'utf-8'));

  it('임계값이 얼린 값과 같다', () => {
    expect(SPEECH_PASS_THRESHOLD).toBe(frozen.threshold);
  });

  it('자모 분해가 얼린 값과 같다', () => {
    for (const c of frozen.decompose) {
      const j = decomposeHangul(c.ch);
      const got = j === null ? null : [j.cho, j.jung, j.jong];
      expect(got, `decomposeHangul(${JSON.stringify(c.ch)})`).toEqual(c.jamo);
    }
  });

  it('음절 비용이 얼린 값과 같다', () => {
    for (const c of frozen.syllableCost) {
      expect(
        syllablePhoneticCost(c.a, c.b),
        `syllablePhoneticCost(${c.a}, ${c.b})`,
      ).toBeCloseTo(c.cost, 9);
    }
  });

  it('오류율이 얼린 값과 같다', () => {
    for (const c of frozen.errorRate) {
      expect(
        speechErrorRate(c.transcript, c.target, c.mode),
        `speechErrorRate(${JSON.stringify(c.transcript)}, ${JSON.stringify(c.target)}, ${c.mode})`,
      ).toBeCloseTo(c.rate, 9);
    }
  });

  it('정답 판정이 얼린 값과 같다', () => {
    for (const c of frozen.isCorrect) {
      expect(
        isSpeechCorrect(c.transcript, c.target, c.mode),
        `isSpeechCorrect(${JSON.stringify(c.transcript)}, ${JSON.stringify(c.target)}, ${c.mode})`,
      ).toBe(c.correct);
    }
  });
});
