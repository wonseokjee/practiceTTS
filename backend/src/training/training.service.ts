import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { CryptoService } from '../memory/services/crypto.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  SessionResponseDto,
  toSessionResponseDto,
} from './dto/session-response.dto';
import { ConversationLog } from './entities/conversation-log.entity';
import { TrainingSession } from './entities/training-session.entity';
import { TrainingError, TrainingErrorCode } from './errors/training.errors';
import type {
  AvailableEntryDto,
  ITrainingService,
} from './interfaces/ITrainingService';
import { FastApiChatClientService } from './services/fast-api-chat-client.service';

/** scenarioCache에 저장된 시나리오 데이터 구조 */
interface ScenarioCacheData {
  openingQuestion: string;
}

/** scenarioCache JSON 런타임 타입 검증 */
function isScenarioCacheData(value: unknown): value is ScenarioCacheData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).openingQuestion === 'string'
  );
}

/**
 * 훈련 세션 서비스
 * - ITrainingService 인터페이스 구현
 * - 모든 대화 내용은 CryptoService로 AES-256-CBC 암호화 저장
 * - 환자 소유권 검증 (session.patientId === 요청 patientId)
 */
@Injectable()
export class TrainingService implements ITrainingService {
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
    @InjectRepository(ConversationLog)
    private readonly logRepository: Repository<ConversationLog>,
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    private readonly fastApiChatClient: FastApiChatClientService,
    private readonly cryptoService: CryptoService,
    private readonly personaContext: PersonaContextService,
  ) {}

  /**
   * UC-1: 훈련 세션 생성
   * - memory_entry 조회 → scenarioCache 복호화 → 세션 생성
   * - openingQuestion을 ConversationLog(role='ai')에 암호화 저장
   * - 세션 DTO 반환 (openingQuestion 포함)
   */
  async createSession(
    patientId: string,
    dto: CreateSessionDto,
  ): Promise<SessionResponseDto> {
    // 메모리 엔트리 조회 및 접근 권한 확인 (환자 ID 기준)
    const entry = await this.memoryEntryRepository.findOne({
      where: { id: dto.memoryEntryId, patientId, isActive: true },
    });

    if (!entry) {
      throw new NotFoundException(
        `메모리 엔트리를 찾을 수 없습니다: ${dto.memoryEntryId}`,
      );
    }

    // 시나리오가 준비되어 있어야 훈련 가능
    if (!entry.scenarioCache) {
      throw new UnprocessableEntityException(
        '시나리오가 아직 생성되지 않았습니다. 보호자가 시나리오를 먼저 생성해야 합니다.',
      );
    }

    // scenarioCache 복호화 → openingQuestion 추출 (토큰 상태)
    const tokenizedOpening = this.extractOpeningQuestion(entry.scenarioCache);
    // 페르소나 역치환: 관계/장소 토큰을 환자 실명으로 복원 (표시 직전)
    const tokenMap = await this.personaContext.buildTokenMap(patientId);
    const openingQuestion = this.personaContext.restorePersonaText(
      tokenizedOpening,
      tokenMap,
    );

    // 훈련 세션 생성
    const session = this.sessionRepository.create({
      patientId,
      memoryEntryId: dto.memoryEntryId,
      targetWordUsed: dto.targetWord,
      status: 'active',
      hintLevel: 0,
    });
    const savedSession = await this.sessionRepository.save(session);

    // AI 오프닝 질문을 ConversationLog(role='ai')에 암호화 저장
    const encryptedQuestion = this.encryptContent(openingQuestion);
    const openingLog = this.logRepository.create({
      sessionId: savedSession.id,
      role: 'ai',
      content: encryptedQuestion,
      hintTriggered: false,
    });
    await this.logRepository.save(openingLog);

    return toSessionResponseDto(savedSession, openingQuestion);
  }

  /**
   * UC-GET: 세션 단건 조회
   * - 소유권 검증 포함
   * - openingQuestion은 null 반환 (세션 생성 직후에만 제공)
   */
  async getSession(
    sessionId: string,
    patientId: string,
  ): Promise<SessionResponseDto> {
    const session = await this.findAndVerifyOwnership(sessionId, patientId);
    return toSessionResponseDto(session, null);
  }

  /**
   * UC-2: 환자 발화 전송 → FastAPI /chat 프록시 → AI 응답 반환
   * - 세션 조회 및 소유권 검증 (status='active'여야 함)
   * - 환자 발화를 ConversationLog(role='patient')에 암호화 저장
   * - FastAPI /chat 호출
   * - AI 응답을 ConversationLog(role='ai')에 암호화 저장
   */
  async sendMessage(
    sessionId: string,
    patientId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const session = await this.findAndVerifyOwnership(sessionId, patientId);

    // 세션이 활성 상태여야만 메시지 전송 가능
    if (session.status !== 'active') {
      throw new UnprocessableEntityException(
        `완료되거나 중단된 세션에는 메시지를 보낼 수 없습니다. 현재 상태: ${session.status}`,
      );
    }

    // 환자 발화를 암호화하여 저장
    const encryptedTranscript = this.encryptContent(dto.transcript);
    const patientLog = this.logRepository.create({
      sessionId,
      role: 'patient',
      content: encryptedTranscript,
      hintTriggered: false,
    });
    await this.logRepository.save(patientLog);

    // hint_level 타입 안전 변환 (0 | 1 | 2)
    const hintLevel = this.toHintLevel(session.hintLevel);

    // FastAPI /chat 호출
    let chatResult;
    try {
      chatResult = await this.fastApiChatClient.chat({
        session_id: sessionId,
        user_message: dto.transcript,
        hint_level: hintLevel,
        memory_entry_id: session.memoryEntryId,
      });
    } catch (error) {
      if (error instanceof TrainingError) {
        throw new BadGatewayException(
          'AI 대화 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
        );
      }
      throw new BadGatewayException('AI 서비스 호출에 실패했습니다.');
    }

    // 페르소나 역치환: /chat은 토큰화된 masked_context로 답을 만들므로 응답에
    // [손자1] 같은 토큰이 그대로 섞여 나온다. 환자에게 보여주기 전에 실명으로
    // 되돌린다. (createSession의 openingQuestion만 되돌리고 이후 대화 턴을
    // 빠뜨리면, 첫 질문 뒤 모든 대화에서 환자가 토큰을 보게 된다.)
    const tokenMap = await this.personaContext.buildTokenMap(patientId);
    const aiMessage = this.personaContext.restorePersonaText(
      chatResult.ai_message,
      tokenMap,
    );

    // AI 응답을 암호화하여 저장 (환자가 실제로 본 문장을 남긴다)
    const encryptedAiMessage = this.encryptContent(aiMessage);
    const aiLog = this.logRepository.create({
      sessionId,
      role: 'ai',
      content: encryptedAiMessage,
      hintTriggered: chatResult.hint_triggered,
    });
    await this.logRepository.save(aiLog);

    return {
      aiMessage,
      hintTriggered: chatResult.hint_triggered,
      hintLevel: chatResult.hint_level,
    };
  }

  /**
   * UC-3: 힌트 레벨 증가
   * - hint_level이 2 미만이면 1 증가
   * - 이미 2이면 그대로 유지
   */
  async incrementHint(
    sessionId: string,
    patientId: string,
  ): Promise<{ hintLevel: number }> {
    const session = await this.findAndVerifyOwnership(sessionId, patientId);

    if (session.status !== 'active') {
      throw new UnprocessableEntityException(
        `완료되거나 중단된 세션의 힌트 레벨을 변경할 수 없습니다.`,
      );
    }

    const newHintLevel = session.hintLevel < 2 ? session.hintLevel + 1 : 2;

    if (newHintLevel !== session.hintLevel) {
      await this.sessionRepository.update(sessionId, {
        hintLevel: newHintLevel,
      });
    }

    return { hintLevel: newHintLevel };
  }

  /**
   * UC-4: 세션 완료 처리
   * - status를 'completed'로 변경
   * - success, duration_ms 업데이트 (duration_ms = now - created_at)
   */
  async completeSession(
    sessionId: string,
    patientId: string,
    success: boolean,
  ): Promise<SessionResponseDto> {
    const session = await this.findAndVerifyOwnership(sessionId, patientId);

    if (session.status !== 'active') {
      throw new UnprocessableEntityException(
        `이미 완료되거나 중단된 세션입니다. 현재 상태: ${session.status}`,
      );
    }

    const durationMs = Date.now() - session.createdAt.getTime();

    await this.sessionRepository.update(sessionId, {
      status: 'completed',
      success,
      durationMs,
    });

    // 갱신된 세션 재조회
    const updated = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!updated) {
      throw new NotFoundException('세션을 찾을 수 없습니다.');
    }

    return toSessionResponseDto(updated, null);
  }

  /**
   * 환자 대시보드: 환자 ID로 훈련 가능한 메모리 엔트리 목록 조회
   * - isActive=true이고 해당 patient의 엔트리만 반환
   * - 최신순 정렬
   */
  async findAvailableEntries(patientId: string): Promise<AvailableEntryDto[]> {
    const entries = await this.memoryEntryRepository.find({
      where: { patientId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    return entries.map((entry) => ({
      id: entry.id,
      photoUrl: entry.photoUrl ?? null,
      locationTag: entry.locationTag ?? null,
      emotionTag: entry.emotionTag ?? null,
      targetWords: entry.targetWords ?? [],
      hasScenario: entry.scenarioCache != null,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  // ─── Private 헬퍼 메서드 ────────────────────────────────────────────────

  /**
   * 세션 조회 및 소유권 검증
   * - 미존재: NotFoundException
   * - 소유권 불일치: ForbiddenException
   */
  private async findAndVerifyOwnership(
    sessionId: string,
    patientId: string,
  ): Promise<TrainingSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`훈련 세션을 찾을 수 없습니다: ${sessionId}`);
    }

    if (session.patientId !== patientId) {
      throw new ForbiddenException(
        '해당 훈련 세션에 대한 접근 권한이 없습니다.',
      );
    }

    return session;
  }

  /**
   * scenarioCache 복호화 → openingQuestion 추출
   * - 복호화 실패 또는 형식 불일치 시 UnprocessableEntityException
   */
  private extractOpeningQuestion(scenarioCache: string): string {
    let decrypted: string;
    try {
      decrypted = this.cryptoService.decrypt(scenarioCache);
    } catch {
      throw new UnprocessableEntityException(
        '시나리오 캐시 복호화에 실패했습니다.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decrypted) as unknown;
    } catch {
      throw new UnprocessableEntityException(
        '시나리오 캐시 형식이 올바르지 않습니다.',
      );
    }

    if (!isScenarioCacheData(parsed)) {
      throw new UnprocessableEntityException(
        '시나리오 캐시에 openingQuestion이 없습니다.',
      );
    }

    return parsed.openingQuestion;
  }

  /**
   * 텍스트를 AES-256-CBC로 암호화
   * - 실패 시 TrainingError로 래핑
   */
  private encryptContent(plainText: string): string {
    try {
      return this.cryptoService.encrypt(plainText);
    } catch {
      throw new TrainingError(
        TrainingErrorCode.ENCRYPT_FAILED,
        '대화 내용 암호화에 실패했습니다.',
      );
    }
  }

  /**
   * hintLevel 숫자를 0 | 1 | 2 유니온 타입으로 변환
   * - 범위 초과 값은 가장 가까운 유효 값으로 클램핑
   */
  private toHintLevel(level: number): 0 | 1 | 2 {
    if (level <= 0) return 0;
    if (level === 1) return 1;
    return 2;
  }
}
