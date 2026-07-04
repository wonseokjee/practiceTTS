// 데일리 퀴즈 API 클라이언트
//
// - 모든 요청은 공용 memoryLinkApi(JWT 자동주입, 401 인터셉터)를 통한다.
// - patientId는 서버가 토큰에서 도출하므로 클라이언트가 보내지 않는다.
// - 응답은 런타임 타입가드로 검증한다 (MemoryEntryApi 스타일).

import { memoryLinkApi } from '../../../shared/MemoryLinkApi.js';
import type {
  AttemptResult,
  BestScore,
  PatientNote,
  PatientNoteCategory,
  QuizGenerationStatus,
  QuizQuestionPublic,
  QuizQuestionType,
  QuizSetDetail,
  QuizSetSummary,
  SubmitAnswer,
  SubmitAttemptsResult,
  WishPractice,
} from '../domain/Quiz.js';
import type { QabResultInput, QabSubtestSummary } from '../domain/QabResult.js';

/** 목록 조회 옵션 */
export interface ListQuizSetsParams {
  /** 기본 권장: 'ready'만 노출 */
  status?: QuizGenerationStatus;
  limit?: number;
  memoryEntryId?: string;
}

/** 답안 제출 요청 본문 */
export interface SubmitAttemptsRequest {
  /** 같은 세션을 묶는 토큰 (crypto.randomUUID) */
  sessionToken: string;
  answers: SubmitAnswer[];
}

/**
 * 퀴즈 API 클라이언트 인터페이스.
 * - 테스트 시 Mock 구현체로 교체 가능.
 */
export interface IQuizApi {
  /** GET /quiz/sets */
  listSets(params?: ListQuizSetsParams): Promise<QuizSetSummary[]>;
  /** GET /quiz/sets/:id */
  getSet(quizSetId: string): Promise<QuizSetDetail>;
  /** POST /quiz/sets/:id/attempts */
  submitAttempts(
    quizSetId: string,
    request: SubmitAttemptsRequest,
  ): Promise<SubmitAttemptsResult>;
  /** GET /quiz/sets/:id/best-score */
  getBestScore(quizSetId: string): Promise<BestScore>;
  /** POST /quiz/sets/:id/wish-practice — 보호자 한마디 → 발화 연습 (Phase 6) */
  getWishPractice(quizSetId: string): Promise<WishPractice>;
  /** POST /quiz/qab-results — QAB 검사 결과 일괄 저장 (세션 완료 시) */
  submitQabResults(
    sessionToken: string,
    results: QabResultInput[],
  ): Promise<{ saved: number }>;
  /** GET /quiz/qab-summary — QAB 검사별 회복 추세 (보호자용) */
  getQabSummary(): Promise<QabSubtestSummary[]>;
}

// ─── 런타임 타입가드 ──────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function isGenerationStatus(value: unknown): value is QuizGenerationStatus {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

function isQuestionType(value: unknown): value is QuizQuestionType {
  return (
    value === 'multiple_choice' ||
    value === 'yes_no' ||
    value === 'fill_blank' ||
    value === 'tile_arrange' ||
    value === 'speech'
  );
}

function isNoteCategory(value: unknown): value is PatientNoteCategory {
  return value === 'activity' || value === 'moment' || value === 'context';
}

function isQuizSetSummary(value: unknown): value is QuizSetSummary {
  const obj = asRecord(value);
  if (obj === null) return false;
  return (
    typeof obj.quizSetId === 'string' &&
    typeof obj.memoryEntryId === 'string' &&
    (obj.photoUrl === null || typeof obj.photoUrl === 'string') &&
    isGenerationStatus(obj.generationStatus) &&
    (obj.bestScore === null || typeof obj.bestScore === 'number') &&
    typeof obj.createdAt === 'string'
  );
}

function isPatientNote(value: unknown): value is PatientNote {
  const obj = asRecord(value);
  if (obj === null) return false;
  return isNoteCategory(obj.category) && typeof obj.answerText === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isQuizQuestionPublic(value: unknown): value is QuizQuestionPublic {
  const obj = asRecord(value);
  if (obj === null) return false;
  return (
    typeof obj.id === 'string' &&
    typeof obj.orderIndex === 'number' &&
    isQuestionType(obj.type) &&
    typeof obj.prompt === 'string' &&
    (obj.choices === null || isStringArray(obj.choices)) &&
    (obj.hintFirstChar === null || typeof obj.hintFirstChar === 'string') &&
    // targetWord는 speech 전용 노출 필드. 구버전 응답 호환을 위해 부재(undefined)도 허용.
    (obj.targetWord === undefined ||
      obj.targetWord === null ||
      typeof obj.targetWord === 'string')
  );
}

function isQuizSetDetail(value: unknown): value is QuizSetDetail {
  const obj = asRecord(value);
  if (obj === null) return false;
  const memoryEntry = asRecord(obj.memoryEntry);
  if (memoryEntry === null) return false;
  const photoUrlOk =
    memoryEntry.photoUrl === null || typeof memoryEntry.photoUrl === 'string';
  const wishOk =
    memoryEntry.caregiverWishMessage === null ||
    typeof memoryEntry.caregiverWishMessage === 'string';
  return (
    typeof obj.quizSetId === 'string' &&
    photoUrlOk &&
    wishOk &&
    Array.isArray(obj.patientNotes) &&
    obj.patientNotes.every(isPatientNote) &&
    Array.isArray(obj.questions) &&
    obj.questions.every(isQuizQuestionPublic)
  );
}

function isAttemptResult(value: unknown): value is AttemptResult {
  const obj = asRecord(value);
  if (obj === null) return false;
  return (
    typeof obj.questionId === 'string' &&
    typeof obj.isCorrect === 'boolean' &&
    typeof obj.correctAnswer === 'string'
  );
}

function isSubmitAttemptsResult(value: unknown): value is SubmitAttemptsResult {
  const obj = asRecord(value);
  if (obj === null) return false;
  const bestScoreOk =
    obj.bestScore === undefined || typeof obj.bestScore === 'number';
  const isNewBestOk =
    obj.isNewBest === undefined || typeof obj.isNewBest === 'boolean';
  return (
    Array.isArray(obj.results) &&
    obj.results.every(isAttemptResult) &&
    typeof obj.sessionScore === 'number' &&
    typeof obj.completed === 'boolean' &&
    bestScoreOk &&
    isNewBestOk
  );
}

function isWishPractice(value: unknown): value is WishPractice {
  const obj = asRecord(value);
  if (obj === null) return false;
  const fb = asRecord(obj.fillBlank);
  if (fb === null) return false;
  return (
    typeof obj.echoSentence === 'string' &&
    typeof fb.prompt === 'string' &&
    typeof fb.answer === 'string' &&
    typeof fb.hintFirstChar === 'string'
  );
}

function isQabSubtestSummary(value: unknown): value is QabSubtestSummary {
  const obj = asRecord(value);
  if (obj === null) return false;
  return (
    typeof obj.subtest === 'string' &&
    typeof obj.total === 'number' &&
    typeof obj.correct === 'number' &&
    typeof obj.accuracy === 'number' &&
    typeof obj.assisted === 'number' &&
    (obj.avgMetric === null || typeof obj.avgMetric === 'number') &&
    (obj.maxMetric === null || typeof obj.maxMetric === 'number') &&
    (obj.avgScore === null || typeof obj.avgScore === 'number') &&
    (obj.lastAt === null || typeof obj.lastAt === 'string')
  );
}

function isBestScore(value: unknown): value is BestScore {
  const obj = asRecord(value);
  if (obj === null) return false;
  const achievedAtOk =
    obj.achievedAt === undefined || typeof obj.achievedAt === 'string';
  return (
    typeof obj.quizSetId === 'string' &&
    (obj.bestScore === null || typeof obj.bestScore === 'number') &&
    achievedAtOk
  );
}

const INVALID_RESPONSE_MESSAGE = '서버 응답 형식이 올바르지 않습니다.';

// ─── 구현체 ───────────────────────────────────────────────────────

/**
 * 퀴즈 API 클라이언트 구현체.
 * - JWT 자동 주입은 memoryLinkApi 인터셉터가 처리.
 */
export const quizApi: IQuizApi = {
  async listSets(params?: ListQuizSetsParams): Promise<QuizSetSummary[]> {
    const res = await memoryLinkApi.get<unknown>('/quiz/sets', {
      params: {
        status: params?.status,
        limit: params?.limit,
        memoryEntryId: params?.memoryEntryId,
      },
    });
    const obj = asRecord(res.data);
    const items = obj?.items;
    if (!Array.isArray(items) || !items.every(isQuizSetSummary)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return items;
  },

  async getSet(quizSetId: string): Promise<QuizSetDetail> {
    const res = await memoryLinkApi.get<unknown>(`/quiz/sets/${quizSetId}`);
    if (!isQuizSetDetail(res.data)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return res.data;
  },

  async submitAttempts(
    quizSetId: string,
    request: SubmitAttemptsRequest,
  ): Promise<SubmitAttemptsResult> {
    const res = await memoryLinkApi.post<unknown>(
      `/quiz/sets/${quizSetId}/attempts`,
      request,
    );
    if (!isSubmitAttemptsResult(res.data)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return res.data;
  },

  async getBestScore(quizSetId: string): Promise<BestScore> {
    const res = await memoryLinkApi.get<unknown>(
      `/quiz/sets/${quizSetId}/best-score`,
    );
    if (!isBestScore(res.data)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return res.data;
  },

  async getWishPractice(quizSetId: string): Promise<WishPractice> {
    const res = await memoryLinkApi.post<unknown>(
      `/quiz/sets/${quizSetId}/wish-practice`,
    );
    if (!isWishPractice(res.data)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return res.data;
  },

  async submitQabResults(
    sessionToken: string,
    results: QabResultInput[],
  ): Promise<{ saved: number }> {
    const res = await memoryLinkApi.post<unknown>('/quiz/qab-results', {
      sessionToken,
      results,
    });
    const obj = asRecord(res.data);
    if (obj === null || typeof obj.saved !== 'number') {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return { saved: obj.saved };
  },

  async getQabSummary(): Promise<QabSubtestSummary[]> {
    const res = await memoryLinkApi.get<unknown>('/quiz/qab-summary');
    const obj = asRecord(res.data);
    const items = obj?.items;
    if (!Array.isArray(items) || !items.every(isQabSubtestSummary)) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return items;
  },
};
