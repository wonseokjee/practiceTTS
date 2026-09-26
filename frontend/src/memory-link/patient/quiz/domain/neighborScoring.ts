// 이웃 비교 채점 — 이름대기의 판정(정답 · 모호 · 오답 · 채점 불가).
//
// 설계: docs/history/20260926_NeighborScoring_design.md (팔 C), 계획 PR 4.
//
// **왜 필요한가.** 지금 이름대기는 목표 단어를 참조로 Azure 발음 평가를 부르고
// `accuracy ≥ 60`이면 정답이다. 그런데 환자가 목표와 **소리가 가까운 다른 단어**를 말해도
// (고래 문항에 "노래") 정답 참조와 거의 같은 점수가 나온다 — 608 실측에서 근접 오통과가
// 35.7%였다(음향 채점 계획 4-3절). 정답률·적응 레벨·보호자 추이가 실제보다 좋게 나온다.
//
// **어떻게.** 같은 녹음을 목표뿐 아니라 **경쟁자**(목표와 소리가 가까운 앱 단어 3개, 그리고
// 후보 없이 인식한 결과)로도 채점해서, 목표가 경쟁자보다 낮으면 "가르지 못했다"고 본다.
// 이 경우는 오답이 아니라 **모호**다 — 구음장애 왜곡과 다른 단어를 음향적으로 가를 수 없는
// 경우(고래/노래)가 원리적으로 있어서, 오답이라고 우기지 않고 한 번 더 말해 달라고 한다.
//
//   목표 < 60                          → 오답 (경쟁자를 볼 필요가 없다)
//   목표 ≥ 60 이고 목표 ≥ 모든 경쟁자   → 정답
//   목표 ≥ 60 인데 어떤 경쟁자가 더 높음 → 모호 (1회 재시도, 또 모호하면 채점 불가)
//   경쟁자를 하나라도 못 얻음            → 채점 불가  ← 목표 점수만으로 채점하지 않는다
//
// **판정 규칙의 단일 진실은 이 파일이다.** 서버(ai-service)는 점수만 내고 판정하지 않는다.
// 0단계 실측 코드(`scripts/asr_eval/azure_neighbor_eval.py`)가 같은 규칙을 재현하는지는
// 골든 벡터(`scripts/asr_eval/golden/neighbor_decisions.json`)가 양쪽에서 고정한다.
// 이 규칙을 바꾸면 벡터를 다시 쓰고 Python 쪽도 같이 고쳐야 통과한다(neighborScoringGolden.test.ts).
//
// 해석 범위: 실측은 구음장애 화자가 대본을 읽은 녹음이다. 실어증 착어·비구음장애 사용자는
// 재지 않았다(설계 10절).

import { PARTIAL_MIN_RATIO } from './nameMatch.js';
import {
  UNSCORED,
  evaluateFromAzure,
  type AzurePronunciationScores,
  type SpeechAssessment,
} from './pronunciationScore.js';

/** 이 채점기 이전의 채점기 — Azure 발음 평가 하나로 채점(`accuracy ≥ 60`). 컬럼 이전 행이 이것이다. */
export const SCORER_VERSION_V1 = 'azure-pa-v1';
/** 이웃 비교 채점. 백엔드 `QAB_SCORER_VERSIONS`와 같은 값이어야 한다(목록 밖은 400). */
export const SCORER_VERSION_NEIGHBOR = 'azure-pa-nbr-v1';
export type ScorerVersion =
  | typeof SCORER_VERSION_V1
  | typeof SCORER_VERSION_NEIGHBOR;

/** 경쟁자 하나의 채점 결과 — ai-service `competitor_scores` 항목. */
export interface CompetitorScore {
  /** 참조로 쓴 단어. STT 경쟁자는 정규화한 인식 결과다. */
  text: string;
  /** neighbor = 호출자가 넘긴 이웃 단어, stt = 후보 없이 인식한 결과. */
  source: 'neighbor' | 'stt';
  /** 0~100. `status`가 `error`면 쓰면 안 된다. */
  accuracyScore: number;
  recognizedText: string;
  /** ok | no_match(그 참조로는 인식 못함 — 0점) | error(호출 실패 — 점수를 못 믿는다) */
  status: 'ok' | 'no_match' | 'error';
}

/** ai-service가 경쟁자 모드에서 돌려주는 추가 필드를 정리한 것. */
export interface CompetitorInfo {
  /** 경쟁자 채점 결과. null이면 채점하지 않았다(`skipped`가 이유). */
  scores: CompetitorScore[] | null;
  sttTranscript: string | null;
  /** ok | empty(인식 결과 없음 — 경쟁자 없음) | error(호출 실패 — 비교를 못 한 것) */
  sttStatus: 'ok' | 'empty' | 'error' | null;
  skipped: 'target_below_pass' | 'no_match' | null;
}

/** 이름대기 판정 결과. `assessed`는 정답·오답·채점 불가를, `ambiguous`는 모호를 뜻한다. */
export type NamingVerdict =
  | { kind: 'assessed'; assessment: SpeechAssessment }
  | { kind: 'ambiguous' };

/**
 * 비교용 정규화 — NFC, 문장부호 제거, 공백 제거.
 *
 * ai-service `competitor_service.compact`와 같다. `\w`가 한글을 못 잡아서(JS의 `\w`는 ASCII
 * 전용이다) 유니코드 속성으로 쓴다 — 그대로 옮기면 한글이 전부 지워진다.
 */
function compact(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/g, '');
}

/**
 * 이름대기에서 **정답으로 보는 변형**인가 — 경쟁자로 세우지 않는다.
 *
 * - 목표를 품는 말: 사과 ← "사과요"(조사·어미가 붙은 정답)
 * - 부분 명칭: 통나무 ← "나무". 목표의 연속 부분이고 **길이가 목표의 60% 이상**이다.
 *   "비행기"에 "비"(1/3) 같은 조각까지 봐주면 너무 관대하다. 60%는 `nameMatch.ts`의
 *   `PARTIAL_MIN_RATIO` — 앱이 이미 쓰던 선례다.
 *
 * 결과를 본 뒤 사용자가 정한 정의다(설계 9절). 따라말하기에는 적용하지 않는다 — 거기서
 * "통나무"에 "나무"는 오류다.
 */
export function isAcceptedNamingVariant(said: string, target: string): boolean {
  const a = compact(said);
  const b = compact(target);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b || a.includes(b)) return true;
  return b.includes(a) && a.length >= PARTIAL_MIN_RATIO * b.length;
}

/**
 * 이웃 비교 채점으로 이름대기 한 번의 시도를 판정한다.
 *
 * @param azure 목표를 참조로 한 Azure 점수. 없으면(서버에 못 닿음) 채점 불가.
 * @param transcript 목표를 참조로 채점할 때 Azure가 인식한 텍스트. 비면 채점 불가(NoMatch).
 * @param targetWord 이 문항의 정답 낱말.
 * @param competitors 서버가 돌려준 경쟁자 결과. 없으면(옛 서버·폴백) 채점 불가.
 */
export function evaluateNamingWithNeighbors(input: {
  azure: AzurePronunciationScores | null;
  transcript: string;
  targetWord: string;
  competitors: CompetitorInfo | null | undefined;
}): NamingVerdict {
  const { azure, transcript, targetWord, competitors } = input;

  // 1) 목표 채점 — 채점 불가·오답이면 여기서 끝난다(경쟁자는 볼 필요가 없다).
  const base = evaluateFromAzure(azure, transcript, 'word');
  if (!base.scored || !base.isCorrect || azure === null) {
    return { kind: 'assessed', assessment: base };
  }

  // 2) 목표는 정답선을 넘었다. 경쟁자를 **하나라도 못 얻으면** 채점하지 않는다 — 목표 점수만으로
  //    정답을 내리면 이웃 비교를 안 한 채점이 된다(폴백 금지 원칙, 채점 불가로 남긴다).
  //    서버는 목표가 정답선 미만일 때만 경쟁자를 건너뛰므로, 정답선을 넘었는데 경쟁자가 없으면 이상한 응답이다.
  const unscored: NamingVerdict = { kind: 'assessed', assessment: UNSCORED };
  if (!competitors || competitors.scores === null) return unscored;
  if (competitors.sttStatus !== 'ok' && competitors.sttStatus !== 'empty') {
    return unscored; // error(호출 실패) 또는 응답에 아예 없음
  }
  if (competitors.scores.some((c) => c.status === 'error')) return unscored;

  // 3) 비교. 정답으로 보는 변형(사과요·부분 명칭)인 인식 결과는 경쟁자가 아니다.
  //    no_match는 0점이다(그 참조로는 안 들렸다). 동점은 정답이다(m = 0).
  const rivals = competitors.scores.filter(
    (c) => !(c.source === 'stt' && isAcceptedNamingVariant(c.text, targetWord)),
  );
  const best = rivals.reduce(
    (max, c) => Math.max(max, c.status === 'no_match' ? 0 : c.accuracyScore),
    Number.NEGATIVE_INFINITY,
  );
  return azure.accuracyScore >= best
    ? { kind: 'assessed', assessment: base }
    : { kind: 'ambiguous' };
}
