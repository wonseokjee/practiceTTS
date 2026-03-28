import type { CreateSessionDto } from '../dto/create-session.dto';
import type { MessageResponseDto } from '../dto/message-response.dto';
import type { SendMessageDto } from '../dto/send-message.dto';
import type { SessionResponseDto } from '../dto/session-response.dto';

/**
 * 훈련 세션 서비스 인터페이스
 * 테스트 시 MockTrainingService로 교체 가능
 */
export interface ITrainingService {
  /** UC-1: 훈련 세션 생성 (AI 오프닝 질문 포함) */
  createSession(
    patientId: string,
    dto: CreateSessionDto,
  ): Promise<SessionResponseDto>;

  /** UC-GET: 세션 단건 조회 (소유권 검증 포함) */
  getSession(
    sessionId: string,
    patientId: string,
  ): Promise<SessionResponseDto>;

  /** UC-2: 환자 발화 전송 → FastAPI /chat 프록시 → AI 응답 반환 */
  sendMessage(
    sessionId: string,
    patientId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto>;

  /** UC-3: 힌트 레벨 1 증가 (최대 2) */
  incrementHint(
    sessionId: string,
    patientId: string,
  ): Promise<{ hintLevel: number }>;

  /** UC-4: 세션 완료 처리 (success 기록, duration_ms 계산) */
  completeSession(
    sessionId: string,
    patientId: string,
    success: boolean,
  ): Promise<SessionResponseDto>;

  /** 환자 ID로 훈련 가능한 메모리 엔트리 목록 조회 */
  findAvailableEntries(
    patientId: string,
  ): Promise<AvailableEntryDto[]>;
}

/** 환자 대시보드에서 보여줄 훈련 가능 엔트리 정보 */
export interface AvailableEntryDto {
  id: string;
  photoUrl: string | null;
  locationTag: string | null;
  emotionTag: string | null;
  targetWords: string[];
  /** 시나리오(훈련 준비) 완료 여부 */
  hasScenario: boolean;
  createdAt: string;
}
