// 발음 정확도 점수화 — 따라말하기(검사6)·소리 내어 읽기(검사7)의 발화 정확도를
// 5단계 등급 + 0~100 점수 + 격려 문구로 나눈다.
//
// 노출 정책: 어르신에게는 숫자 대신 '격려 문구'만, 보호자에게는 숫자 점수를 보여준다.
//
// **자는 하나뿐이다.** 점수는 음향 발음 평가(오디오에서 직접 음소 정확도)에서만
// 나온다. 그게 없으면 **채점하지 않는다**(UNSCORED). 예전에는 문자열 근접도
// 채점으로 조용히 폴백했는데, 그건 다른 것을 재는 다른 자였다 — 같은 환자의 같은
// 과제 점수가 그날 네트워크 상태에 따라 달라졌다.
//
// 실측이 그 우려를 확인했다(2026-08-22, 608 test 417세그): Azure accuracy와
// 문자열 채점 오류율의 순위상관은 −0.376으로, 사전 등록한 기준 0.6의 절반이다.
// 두 경로는 같은 것을 재지 않는다. 상세: docs/asr/acoustic-scorer-plan.md 4-2절.
//
// 그래서 여기에 **문자열 기반 채점 함수를 다시 넣지 말 것.** 넣는 순간 회차 간
// 비교가 무너지고, 개인화(3층)를 켜면 "쓸수록 점수가 오른다"가 실력 향상과
// 구분되지 않는다(개인화 설계 결정 1·6).

/** 발음 정확도 5단계 등급 (perfect > great > good > close > retry). */
export type PronunciationGrade =
  | 'perfect'
  | 'great'
  | 'good'
  | 'close'
  | 'retry';

/** good 이상이면 정답으로 본다(정답 처리 경계). */
export function isGradePass(grade: PronunciationGrade): boolean {
  return grade === 'perfect' || grade === 'great' || grade === 'good';
}

/**
 * 채점 불가일 때 어르신에게 하는 말.
 *
 * 칭찬도 지적도 아니다 — 못한 게 아니라 **못 잰** 것이므로, 환자의 수행에 대해
 * 아무 말도 하지 않는 것이 정직하다. 대신 다시 해보자고 청한다.
 *
 * "소리가 안 들렸어요"라고는 하지 않는다. 채점 불가의 원인은 NoMatch일 수도
 * 서버에 못 닿은 것일 수도 있는데, 앞의 표현은 두 경우 모두를 **환자의 목소리
 * 탓**으로 돌린다. 원인을 모를 때는 원인을 말하지 않는 편이 정직하다.
 */
export const UNSCORED_ENCOURAGEMENT = '이번엔 확인하지 못했어요. 한 번만 더 해볼까요?';

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

/** 채점된 발화 평가 결과. */
export interface ScoredEvaluation {
  scored: true;
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
 * 채점 불가 — 음향 점수를 얻지 못해 **판정을 내리지 않은** 결과.
 *
 * 0점이 아니다. 0점은 "못했다"고 말하는데 실제로는 "못 쟀다"이다. 이 결과가
 * 붙은 문항은 정확도 분모·발음 평균·레벨링 윈도우 어디에도 들어가지 않는다.
 * 환자에게는 격려만 한다(비처벌 원칙).
 */
export interface UnscoredEvaluation {
  scored: false;
  /** 어르신용 문구 — 수행이 아니라 상황에 대해 말한다 */
  encouragement: string;
}

/** 채점됐거나, 못 쟀거나. 셋째 경우는 없다. */
export type SpeechAssessment = ScoredEvaluation | UnscoredEvaluation;

const UNSCORED: UnscoredEvaluation = {
  scored: false,
  encouragement: UNSCORED_ENCOURAGEMENT,
};

// ─── Azure 발음 평가(음소 단위) 채점 정책 ─────────────────────────────
//
// 음향 발음 평가는 오디오에서 직접 음소 정확도를 재므로 STT 오인식과 조음 오류가
// 섞이지 않는다. 이것이 **유일한** 채점 경로다. 못 쓰는 환경(WebSpeech·미구성·
// 서버 실패)에서는 폴백하지 않고 채점 불가로 남긴다.
//
// 이 채점기가 오디오를 실제로 보는지는 실측했다(0단계 측정 B): 같은 음성에
// 음절 수가 같은 **다른** 문장을 참조로 주면 accuracy가 80.6 → 21.1로 무너진다
// (분리 AUC 0.960). 참조 텍스트만 보고 숫자를 지어내는 것이 아니다.

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
 * 음향 발음 평가로 발화를 채점한다. **앱의 유일한 채점 경로다.**
 *
 * 채점 불가로 빠지는 두 경우 — 둘 다 "못했다"가 아니라 "못 쟀다"이다.
 *
 *  1. `azure`가 null. 서버 발음 평가에 닿지 못했다(네트워크·미구성·WebSpeech
 *     환경). 예전에는 여기서 문자열 채점으로 폴백했다. 그 폴백이 이 파일
 *     머리말이 말하는 "다른 자"다.
 *  2. `transcript`가 빔 = Azure NoMatch. 이때 Azure는 accuracy·fluency·
 *     completeness를 전부 0.0으로 돌려주는데, 그 0을 그대로 쓰면 측정 실패가
 *     최저점으로 **기록**된다. 실측상 pa 모드 NoMatch는 0.2%로 드물지만
 *     (417건 중 1건), 드문 것과 틀린 것은 다른 문제다.
 */
export function evaluateFromAzure(
  azure: AzurePronunciationScores | null,
  transcript: string,
  mode: 'word' | 'sentence',
): SpeechAssessment {
  if (azure === null) return UNSCORED;
  if (transcript.trim().length === 0) return UNSCORED;

  const composite = azureComposite(azure, mode);
  const grade = gradeFromScore(composite);
  return {
    scored: true,
    grade,
    score: composite,
    isCorrect: isGradePass(grade),
    encouragement: patientEncouragement(grade),
    caregiverLabel: caregiverGradeLabel(grade),
  };
}
