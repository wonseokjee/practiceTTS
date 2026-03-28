// 훈련 세션 도메인 타입 정의

/** 훈련 세션 상태 */
export type TrainingSessionStatus = 'active' | 'completed' | 'abandoned';

/** 훈련 세션 도메인 모델 */
export interface TrainingSession {
  id: string;
  memoryEntryId: string;
  status: TrainingSessionStatus;
  hintLevel: number;
  targetWordUsed: string | null;
  /** 세션 생성 시 반환되는 AI 첫 질문 (조회 시에는 null) */
  openingQuestion: string | null;
  createdAt: string;
}

/** 대화 참여자 역할 */
export type ConversationRole = 'ai' | 'patient';

/** 대화 메시지 */
export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  hintTriggered?: boolean;
}

/** 환자 대시보드에서 표시할 훈련 가능 엔트리 */
export interface AvailableEntry {
  id: string;
  photoUrl: string | null;
  locationTag: string | null;
  emotionTag: string | null;
  targetWords: string[];
  /** 시나리오(훈련 준비) 완료 여부 */
  hasScenario: boolean;
  createdAt: string;
}

/** STT 인식 결과 */
export interface SttResult {
  transcript: string;
  confidence: number;
}

/** 최소 STT 신뢰도 기준 */
export const MIN_STT_CONFIDENCE = 0.6;
