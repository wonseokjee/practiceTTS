// 보호자 3-step 캡처 플로우 도메인 타입
//
// Implementation Plan §2-4(핵심 사용자 흐름) / §9-1-A(3-step 화면 명세) / §7(API 명세) 기반
// - Step1: 무드 체크 (필수)
// - Step2: 나의 하루 (선택, LLM 미전달 사적 영역)
// - Step3: 환자분의 하루 (카테고리별 3개 질문, 사진 옵션)

/** 캡처 플로우 단계 — FSM 상태 */
export type CaptureStep =
  | 'mood'
  | 'myDay'
  | 'patientDay'
  | 'submitting'
  | 'done';

/** 무드 레벨 (1~5) — §9-1-B 무드 이모지 5단계 시각 명세 참고 */
export type MoodLevel = 1 | 2 | 3 | 4 | 5;

/** 환자 질문 카테고리 — D2=(b) 카테고리별 3개 */
export type PatientCategory = 'activity' | 'moment' | 'context';

/** 일기 질문 적용 범위 */
export type DiaryQuestionScope = 'caregiver' | 'patient';

/** Step1: 무드 입력 */
export interface MoodInput {
  level: MoodLevel;
}

/** Step2: 보호자 자기 질문 답변 (옵션) */
export interface CaregiverAnswerInput {
  questionId: string;
  answerText: string;
}

/** Step3: 환자 질문 카테고리별 답변 (1개 이상) */
export interface PatientAnswerInput {
  questionId: string;
  category: PatientCategory;
  answerText: string;
}

/** 서버에서 받아오는 질문 1개 (랜덤 추출) */
export interface DiaryQuestion {
  id: string;
  scope: DiaryQuestionScope;
  /** scope=caregiver일 땐 null, scope=patient일 땐 활동/순간/맥락 */
  category: PatientCategory | null;
  text: string;
}

/**
 * 보호자 3-step 캡처 결과 — POST /memory-entries 페이로드
 *
 * 백엔드 검증 정책(§7-1):
 *  - `patientAnswers.length >= 1` OR `photo` 첨부 (둘 중 최소 1개)
 *  - `caregiverWishMessage`는 Phase 4에서 UI 미노출이나 컬럼은 존재 (H2)
 */
export interface CreateMemoryEntryRequest3Step {
  patientId: string;
  mood: MoodInput;
  patientAnswers: PatientAnswerInput[];
  caregiverAnswer?: CaregiverAnswerInput;
  caregiverWishMessage?: string;
  photo?: File;
}

/** 무드 이모지/라벨/색상 토큰 — §9-1-B 시각 명세
 *
 * 색은 CSS 변수로 적는다. 무드 5단계는 **런타임에 고르는** 값이라 Tailwind가
 * 정적으로 훑을 수 없고(클래스 이름이 소스에 안 나타난다), 그래서 인라인
 * `style`로 들어간다. 변수는 index.css의 `@theme`가 `:root`에 심는다.
 *
 * `label`은 문자열이 아니라 i18n 키(`caregiver:moodStep.levels.*`)를 담는다 —
 * 도메인 계층은 로케일을 모른다. 화면 쪽에서 `t(token.labelKey)`로 옮긴다.
 * 라벨과 aria-label이 항상 같은 문구라 키 하나로 겸한다.
 */
export interface MoodVisualToken {
  level: MoodLevel;
  emoji: string;
  labelKey: string;
  /** 선택 시 배경 — CSS 색 값 */
  selectedBg: string;
  /** 선택 시 border — CSS 색 값 */
  selectedBorder: string;
}

export const MOOD_VISUAL_TOKENS: ReadonlyArray<MoodVisualToken> = Object.freeze(
  [
    {
      level: 1,
      emoji: '😢',
      labelKey: 'moodStep.levels.level1',
      selectedBg: 'var(--color-accent-soft)',
      selectedBorder: 'var(--color-accent)',
    },
    {
      level: 2,
      emoji: '😐',
      labelKey: 'moodStep.levels.level2',
      selectedBg: 'var(--color-accent-faint)',
      selectedBorder: 'var(--color-accent-line)',
    },
    {
      level: 3,
      emoji: '🙂',
      labelKey: 'moodStep.levels.level3',
      selectedBg: 'var(--color-canvas)',
      selectedBorder: 'var(--color-ink-sage)',
    },
    {
      level: 4,
      emoji: '😊',
      labelKey: 'moodStep.levels.level4',
      selectedBg: 'var(--color-primary-light)',
      selectedBorder: 'var(--color-primary)',
    },
    {
      level: 5,
      emoji: '😍',
      labelKey: 'moodStep.levels.level5',
      // 5단계 배경만 이름이 없다 — 여기서 한 번 쓰는 색이라 토큰을 만들지
      // 않았다. primary-light(#EBF4F0)보다 한 단계 진해 4↔5가 구분된다.
      selectedBg: '#D9EBE2',
      selectedBorder: 'var(--color-primary-dark)',
    },
  ],
);

/**
 * 카테고리별 표시 메타 — UI 라벨/아이콘.
 *
 * `labelKey`는 `caregiver:patientDay.categories.*` — MoodVisualToken과 같은
 * 이유로 도메인 계층엔 문자열이 아니라 키만 둔다.
 */
export interface PatientCategoryMeta {
  category: PatientCategory;
  labelKey: string;
  emoji: string;
}

export const PATIENT_CATEGORY_META: ReadonlyArray<PatientCategoryMeta> =
  Object.freeze([
    { category: 'activity', labelKey: 'patientDay.categories.activity', emoji: '🏃' },
    { category: 'moment', labelKey: 'patientDay.categories.moment', emoji: '✨' },
    { category: 'context', labelKey: 'patientDay.categories.context', emoji: '🍞' },
  ]);

/** 텍스트 길이 제한 */
export const MAX_PATIENT_ANSWER_LENGTH = 300;
export const MAX_CAREGIVER_ANSWER_LENGTH = 300;
export const MAX_CAREGIVER_WISH_LENGTH = 120;
