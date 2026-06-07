import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { DEFAULT_QUIZ_DISTRIBUTION } from './constants/quiz-distribution';
import { QuizSetSummaryDto } from './dto/quiz-set-summary.dto';
import {
  QuizQuestionPublicDto,
  toQuizQuestionPublicDto,
} from './dto/quiz-question-public.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import {
  IQuizGenerationClient,
  QUIZ_GENERATION_CLIENT,
} from './interfaces/IQuizGenerationClient';
import type { IQuizGenerationPayload } from './interfaces/IQuizGenerationPayload';
import { IQuizScorer, QUIZ_SCORER } from './interfaces/IQuizScorer';

/** 세션 만료 기준: 첫 답안 이후 30분 (§7-1 SESSION_EXPIRED) */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * pending QuizSet이 이 시간보다 오래 멈춰 있으면 "고아"로 간주하고 복구한다.
 * LLM 타임아웃(25s)보다 충분히 길게 잡아 정상 진행 중인 생성을 건드리지 않는다.
 */
const STALE_PENDING_MS = 10 * 60 * 1000;

/** 1회 복구에서 처리할 최대 QuizSet 수 (부팅 스톰 방지) */
const MAX_RECOVERY_BATCH = 50;

/** 목록 조회 기본/최대 limit */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** notePreview 카테고리 한글 라벨 */
const CATEGORY_LABELS: Record<string, string> = {
  activity: '활동',
  moment: '순간',
  context: '맥락',
};

/** 단일 답안 채점 결과 */
export interface AttemptResult {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
}

/** submitAttempts 반환 타입 */
export interface SubmitAttemptsResult {
  results: AttemptResult[];
  sessionScore: number;
  completed: boolean;
  bestScore?: number;
  isNewBest?: boolean;
}

/** getSetDetail 반환 타입 */
export interface QuizSetDetail {
  quizSetId: string;
  memoryEntry: {
    photoUrl: string | null;
    caregiverWishMessage: null;
  };
  patientNotes: Array<{ category: string; answerText: string }>;
  questions: QuizQuestionPublicDto[];
}

/** getBestScore 반환 타입 */
export interface BestScoreResult {
  quizSetId: string;
  bestScore: number | null;
  achievedAt?: string;
}

/** requestGeneration 반환 타입 */
export interface RequestGenerationResult {
  quizSetId: string;
  generationStatus: 'pending';
}

/**
 * 퀴즈 도메인 서비스 (Phase 3).
 *
 * 설계 핵심:
 *  - 자동 트리거(generateForMemoryEntry)와 수동 트리거(requestGeneration)는
 *    공통 내부 로직 runGeneration을 공유한다.
 *  - LLM 호출 페이로드는 IQuizGenerationPayload 화이트리스트만 사용한다.
 *  - QuizError는 컨트롤러에서 HttpException으로 매핑된다 (서비스는 도메인 에러만 throw).
 */
@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    @InjectRepository(QuizSet)
    private readonly quizSetRepository: Repository<QuizSet>,
    @InjectRepository(QuizQuestion)
    private readonly quizQuestionRepository: Repository<QuizQuestion>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptRepository: Repository<QuizAttempt>,
    @InjectRepository(QuizBestScore)
    private readonly quizBestScoreRepository: Repository<QuizBestScore>,
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    @InjectRepository(PatientMemoryNote)
    private readonly patientMemoryNoteRepository: Repository<PatientMemoryNote>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(QUIZ_GENERATION_CLIENT)
    private readonly generationClient: IQuizGenerationClient,
    @Inject(QUIZ_SCORER)
    private readonly scorer: IQuizScorer,
  ) {}

  /**
   * 자동 트리거 진입점 (이벤트 리스너에서 호출).
   * - pending QuizSet을 만든 뒤 LLM 호출+영속화까지 동기 await 한다.
   *   (리스너 자체가 백그라운드 fire-and-forget이므로 await 해도 무방하다.)
   */
  async generateForMemoryEntry(
    memoryEntryId: string,
    opts?: { force?: boolean; requireCaregiverId?: string },
  ): Promise<{ quizSetId: string }> {
    const force = opts?.force ?? false;
    const requireCaregiverId = opts?.requireCaregiverId;

    const { quizSet, entry, notes, existing } = await this.prepareGeneration(
      memoryEntryId,
      force,
      requireCaregiverId,
    );

    // 기존 set 재사용 (자동 트리거에서 force 없이 이미 존재하는 경우)
    if (existing) {
      return { quizSetId: quizSet.id };
    }

    await this.runGeneration(quizSet, entry, notes);
    return { quizSetId: quizSet.id };
  }

  /**
   * 수동 트리거 진입점 (컨트롤러에서 호출).
   * - 권한 검증 + pending QuizSet 저장 후 즉시 반환한다.
   * - LLM 호출은 fire-and-forget(void)으로 백그라운드 수행한다.
   */
  async requestGeneration(
    memoryEntryId: string,
    caregiverId: string,
    force: boolean,
  ): Promise<RequestGenerationResult> {
    const { quizSet, entry, notes, existing } = await this.prepareGeneration(
      memoryEntryId,
      force,
      caregiverId,
    );

    // 기존 set 재사용 (force=true가 아니면 prepareGeneration이 ALREADY_EXISTS를 던지므로
    // 여기 도달 시 existing은 사실상 없으나, 방어적으로 처리)
    if (existing) {
      return { quizSetId: quizSet.id, generationStatus: 'pending' };
    }

    // fire-and-forget — 백그라운드 생성. 실패는 runGeneration 내부에서 failed로 기록.
    void this.runGeneration(quizSet, entry, notes).catch((error) => {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(
        `백그라운드 퀴즈 생성 실패 (quizSetId=${quizSet.id}): ${message}`,
      );
    });

    return { quizSetId: quizSet.id, generationStatus: 'pending' };
  }

  /**
   * 생성 준비 공통 로직: 엔트리/소유권/노트 검증 + pending QuizSet 확보.
   * - existing=true면 호출자가 LLM 호출 없이 기존 set을 그대로 반환해야 한다.
   */
  private async prepareGeneration(
    memoryEntryId: string,
    force: boolean,
    requireCaregiverId: string | undefined,
  ): Promise<{
    quizSet: QuizSet;
    entry: MemoryEntry;
    notes: PatientMemoryNote[];
    existing: boolean;
  }> {
    const entry = await this.memoryEntryRepository.findOne({
      where: { id: memoryEntryId, isActive: true },
    });
    if (!entry) {
      throw new QuizError(
        QuizErrorCode.MEMORY_ENTRY_NOT_FOUND,
        `메모리 엔트리를 찾을 수 없습니다: ${memoryEntryId}`,
      );
    }

    // 수동 트리거: 소유권 검증
    if (requireCaregiverId && entry.caregiverId !== requireCaregiverId) {
      throw new QuizError(
        QuizErrorCode.NOT_OWNER,
        '해당 메모리 엔트리에 대한 권한이 없습니다.',
      );
    }

    const notes = await this.patientMemoryNoteRepository.find({
      where: { memoryEntryId },
      order: { orderIndex: 'ASC' },
    });
    if (notes.length === 0) {
      throw new QuizError(
        QuizErrorCode.NO_PATIENT_NOTES,
        '환자 답변(PatientMemoryNote)이 1개 이상 필요합니다.',
      );
    }

    // 기존 QuizSet 존재 여부 (최신)
    const existingSet = await this.quizSetRepository.findOne({
      where: { memoryEntryId },
      order: { createdAt: 'DESC' },
    });

    // 재생성(기존 set 교체) 조건:
    //  - force=true (보호자 명시 재생성), 또는
    //  - 기존 set이 'failed' 상태 (실패한 퀴즈는 force 없이도 재시도 허용)
    const replaceExisting =
      !!existingSet && (force || existingSet.generationStatus === 'failed');

    if (existingSet && !replaceExisting) {
      // 수동 트리거(requireCaregiverId 존재) + 정상 set → 충돌 에러
      if (requireCaregiverId) {
        throw new QuizError(
          QuizErrorCode.QUIZ_SET_ALREADY_EXISTS,
          '이미 생성된 퀴즈가 있습니다. 재생성하려면 force 옵션을 사용하세요.',
        );
      }
      // 자동 트리거 → 조용히 기존 set 반환
      return { quizSet: existingSet, entry, notes, existing: true };
    }

    // 신규 pending QuizSet 저장.
    // 교체 시 동일 memoryEntry의 기존 set(들)을 같은 트랜잭션에서 먼저 삭제한다.
    // (FK ON DELETE CASCADE로 questions/attempts/best_scores가 함께 정리되어
    //  동일 라이프로그에 중복 QuizSet이 누적되는 것을 방지한다.)
    const quizSet = await this.dataSource.transaction(async (manager) => {
      const setRepo = manager.getRepository(QuizSet);
      if (replaceExisting) {
        await setRepo.delete({ memoryEntryId });
      }
      return setRepo.save(
        setRepo.create({
          memoryEntryId,
          patientId: entry.patientId,
          caregiverId: entry.caregiverId,
          generationStatus: 'pending',
          generationError: null,
          readyAt: null,
        }),
      );
    });

    return { quizSet, entry, notes, existing: false };
  }

  /**
   * LLM 호출 + QuizQuestion 영속화 + 상태 전이.
   * - 성공: status='ready', readyAt=now.
   * - 실패: status='failed', generationError=메시지, QuizError 재throw.
   */
  private async runGeneration(
    quizSet: QuizSet,
    entry: MemoryEntry,
    notes: PatientMemoryNote[],
  ): Promise<void> {
    const payload: IQuizGenerationPayload = {
      patientNotes: notes.map((note) => ({
        category: note.category,
        answerText: note.answerText,
      })),
      targetWords:
        entry.targetWords && entry.targetWords.length > 0
          ? entry.targetWords
          : undefined,
      distribution: DEFAULT_QUIZ_DISTRIBUTION,
      // photoTags는 R7=(c)에 따라 미전달 (Phase 2에서 R7=(b)로 전환)
    };

    try {
      const result = await this.generationClient.generate(payload);

      // 문항 영속화 + ready 전이를 한 트랜잭션으로 묶어 원자성을 보장한다.
      // (questions만 저장되고 set이 pending에 박제되는 부분 상태를 방지)
      await this.dataSource.transaction(async (manager) => {
        const questionRepo = manager.getRepository(QuizQuestion);
        const setRepo = manager.getRepository(QuizSet);
        const questions = result.questions.map((q, index) =>
          questionRepo.create({
            quizSetId: quizSet.id,
            orderIndex: index,
            type: q.type,
            prompt: q.prompt,
            choices: q.choices,
            correctAnswer: q.correctAnswer,
            hintFirstChar: q.hintFirstChar,
            explanation: null,
          }),
        );
        await questionRepo.save(questions);
        await setRepo.update(quizSet.id, {
          generationStatus: 'ready',
          readyAt: new Date(),
          generationError: null,
        });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      await this.quizSetRepository.update(quizSet.id, {
        generationStatus: 'failed',
        generationError: message,
      });
      throw error;
    }
  }

  /**
   * 풀 수 있는 QuizSet 목록 조회 (createdAt DESC).
   */
  async listSets(
    effectivePatientId: string,
    filter: { memoryEntryId?: string; status?: string; limit?: number },
  ): Promise<QuizSetSummaryDto[]> {
    const qb = this.quizSetRepository
      .createQueryBuilder('set')
      .where('set.patient_id = :patientId', { patientId: effectivePatientId })
      .orderBy('set.created_at', 'DESC');

    if (filter.memoryEntryId) {
      qb.andWhere('set.memory_entry_id = :memoryEntryId', {
        memoryEntryId: filter.memoryEntryId,
      });
    }
    if (filter.status) {
      qb.andWhere('set.generation_status = :status', {
        status: filter.status,
      });
    }
    // limit 검증·캡: 유효한 양수만 허용(NaN/음수/0 → 기본 20), 상한 50.
    const rawLimit = filter.limit;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    qb.take(limit);

    const sets = await qb.getMany();
    if (sets.length === 0) {
      return [];
    }

    const memoryEntryIds = sets.map((s) => s.memoryEntryId);
    const quizSetIds = sets.map((s) => s.id);

    const [notes, entries, bestScores] = await Promise.all([
      this.patientMemoryNoteRepository
        .createQueryBuilder('note')
        .where('note.memory_entry_id IN (:...ids)', { ids: memoryEntryIds })
        .orderBy('note.order_index', 'ASC')
        .getMany(),
      this.memoryEntryRepository
        .createQueryBuilder('entry')
        .where('entry.id IN (:...ids)', { ids: memoryEntryIds })
        .getMany(),
      this.quizBestScoreRepository
        .createQueryBuilder('best')
        .where('best.quiz_set_id IN (:...ids)', { ids: quizSetIds })
        .getMany(),
    ]);

    const notesByEntry = this.groupNotesByEntry(notes);
    const photoByEntry = new Map<string, string | null>(
      entries.map((e) => [e.id, e.photoUrl ?? null]),
    );
    const bestBySet = new Map<string, number>(
      bestScores.map((b) => [b.quizSetId, b.bestScore]),
    );

    return sets.map((set) => ({
      quizSetId: set.id,
      memoryEntryId: set.memoryEntryId,
      notePreview: this.buildNotePreview(
        notesByEntry.get(set.memoryEntryId) ?? [],
      ),
      photoUrl: photoByEntry.get(set.memoryEntryId) ?? null,
      generationStatus: set.generationStatus,
      generationError:
        set.generationStatus === 'failed'
          ? (set.generationError ?? null)
          : null,
      bestScore: bestBySet.get(set.id) ?? null,
      createdAt: set.createdAt.toISOString(),
    }));
  }

  /**
   * 풀이용 단건 조회 (정답 은닉).
   */
  async getSetDetail(
    setId: string,
    effectivePatientId: string,
  ): Promise<QuizSetDetail> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    if (set.generationStatus !== 'ready') {
      throw new QuizError(
        QuizErrorCode.QUIZ_NOT_READY,
        '퀴즈가 아직 준비되지 않았습니다.',
      );
    }

    const [entry, notes, questions] = await Promise.all([
      this.memoryEntryRepository.findOne({
        where: { id: set.memoryEntryId },
      }),
      this.patientMemoryNoteRepository.find({
        where: { memoryEntryId: set.memoryEntryId },
        order: { orderIndex: 'ASC' },
      }),
      this.quizQuestionRepository.find({
        where: { quizSetId: set.id },
        order: { orderIndex: 'ASC' },
      }),
    ]);

    return {
      quizSetId: set.id,
      memoryEntry: {
        photoUrl: entry?.photoUrl ?? null,
        // caregiverWishMessage는 Phase 1~5에서 항상 null (양방향 치유 Phase 6 도입)
        caregiverWishMessage: null,
      },
      patientNotes: notes.map((note) => ({
        category: note.category,
        answerText: note.answerText,
      })),
      questions: questions.map(toQuizQuestionPublicDto),
    };
  }

  /**
   * 답안 제출 + 즉시 채점.
   * - 멱등: 동일 (sessionToken, questionId) attempt가 있으면 재채점/재저장하지 않는다.
   * - 세션 만료: 첫 답안 이후 30분 초과 시 SESSION_EXPIRED.
   */
  async submitAttempts(
    setId: string,
    effectivePatientId: string,
    dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptsResult> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    if (set.generationStatus !== 'ready') {
      throw new QuizError(
        QuizErrorCode.QUIZ_NOT_READY,
        '퀴즈가 아직 준비되지 않았습니다.',
      );
    }

    const questions = await this.quizQuestionRepository.find({
      where: { quizSetId: set.id },
      order: { orderIndex: 'ASC' },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const totalQuestions = questions.length;

    // 동일 세션의 기존 attempt 조회 (멱등 + 세션 만료 판정)
    const existingAttempts = await this.quizAttemptRepository.find({
      where: { quizSetId: set.id, sessionToken: dto.sessionToken },
      order: { answeredAt: 'ASC' },
    });

    // 세션 만료: 가장 이른 answeredAt이 30분 초과
    if (existingAttempts.length > 0) {
      const earliest = existingAttempts[0].answeredAt.getTime();
      if (Date.now() - earliest > SESSION_TTL_MS) {
        throw new QuizError(
          QuizErrorCode.SESSION_EXPIRED,
          '풀이 세션이 만료되었습니다. 다시 시작해주세요.',
        );
      }
    }

    const answeredByQuestion = new Map(
      existingAttempts.map((a) => [a.questionId, a]),
    );

    // 답안 분류 + 채점. 신규 답안은 모아서 한 번에 저장한다(원자성 + N라운드트립 제거).
    // 동일 요청 내 중복 questionId는 1건만 저장하고 첫 채점 결과를 재사용한다.
    const results: AttemptResult[] = [];
    const newAttemptByQuestion = new Map<string, QuizAttempt>();

    for (const answer of dto.answers) {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new QuizError(
          QuizErrorCode.INVALID_ANSWER_FORMAT,
          `해당 퀴즈에 속하지 않는 문제입니다: ${answer.questionId}`,
        );
      }

      // 멱등 — 이미 저장된 답안(이전 요청)
      const persisted = answeredByQuestion.get(question.id);
      if (persisted) {
        results.push({
          questionId: question.id,
          isCorrect: persisted.isCorrect,
          correctAnswer: question.correctAnswer,
        });
        continue;
      }

      // 동일 요청 내 중복 questionId — 첫 채점 결과 재사용
      const pendingNew = newAttemptByQuestion.get(question.id);
      if (pendingNew) {
        results.push({
          questionId: question.id,
          isCorrect: pendingNew.isCorrect,
          correctAnswer: question.correctAnswer,
        });
        continue;
      }

      const isCorrect = this.scorer.isCorrect(question, answer.userAnswer);
      newAttemptByQuestion.set(
        question.id,
        this.quizAttemptRepository.create({
          quizSetId: set.id,
          questionId: question.id,
          patientId: effectivePatientId,
          sessionToken: dto.sessionToken,
          userAnswer: answer.userAnswer,
          isCorrect,
        }),
      );
      results.push({
        questionId: question.id,
        isCorrect,
        correctAnswer: question.correctAnswer,
      });
    }

    // 신규 답안 일괄 저장 (단일 save 호출 = 배치 트랜잭션)
    const newAttempts = Array.from(newAttemptByQuestion.values());
    if (newAttempts.length > 0) {
      await this.quizAttemptRepository.save(newAttempts);
      for (const attempt of newAttempts) {
        answeredByQuestion.set(attempt.questionId, attempt);
      }
    }

    // 세션 전체 기준 정답 수 / 점수 (진행 중에도 환산)
    const correctCount = Array.from(answeredByQuestion.values()).filter(
      (a) => a.isCorrect,
    ).length;
    const answeredCount = answeredByQuestion.size;
    const sessionScore = this.scorer.toScore(correctCount, totalQuestions);
    const completed = totalQuestions > 0 && answeredCount === totalQuestions;

    if (!completed) {
      return { results, sessionScore, completed };
    }

    // 완료 시 최고 점수 갱신
    const { bestScore, isNewBest } = await this.upsertBestScore(
      set.id,
      effectivePatientId,
      dto.sessionToken,
      sessionScore,
    );

    return { results, sessionScore, completed, bestScore, isNewBest };
  }

  /**
   * 최고 점수 조회.
   */
  async getBestScore(
    setId: string,
    effectivePatientId: string,
  ): Promise<BestScoreResult> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    const best = await this.quizBestScoreRepository.findOne({
      where: { quizSetId: set.id },
    });

    if (!best) {
      return { quizSetId: set.id, bestScore: null };
    }
    return {
      quizSetId: set.id,
      bestScore: best.bestScore,
      achievedAt: best.achievedAt.toISOString(),
    };
  }

  /**
   * 고아 pending QuizSet 복구 (이벤트 durability 보강).
   *
   * 배경: 자동 트리거는 in-process EventEmitter2 fire-and-forget이라,
   * pending QuizSet 저장 후 LLM 생성 완료 전 프로세스가 죽거나 재시작되면
   * 해당 set이 'pending'에 영구히 박제된다(환자에게 영영 도착하지 않음).
   *
   * 본 메서드는 부팅 시(@OnApplicationBootstrap) 호출되어, STALE_PENDING_MS보다
   * 오래된 pending set을 찾아 생성을 재시도한다. 정상 진행 중인 생성(25s 이내)은
   * 임계값 밖이라 건드리지 않는다.
   *
   * - 원본 라이프로그가 삭제됐거나 노트가 없으면 더 이상 생성 불가 → failed로 마감.
   * - 각 set 처리 실패는 다음 set 처리를 막지 않는다(독립적).
   */
  async recoverStalePendingSets(
    now: Date = new Date(),
  ): Promise<{ recovered: number; failed: number; skipped: number }> {
    const threshold = new Date(now.getTime() - STALE_PENDING_MS);
    const stale = await this.quizSetRepository.find({
      where: { generationStatus: 'pending', createdAt: LessThan(threshold) },
      order: { createdAt: 'ASC' },
      take: MAX_RECOVERY_BATCH,
    });

    if (stale.length === 0) {
      return { recovered: 0, failed: 0, skipped: 0 };
    }

    let recovered = 0;
    let failed = 0;
    for (const set of stale) {
      const entry = await this.memoryEntryRepository.findOne({
        where: { id: set.memoryEntryId, isActive: true },
      });
      if (!entry) {
        await this.quizSetRepository.update(set.id, {
          generationStatus: 'failed',
          generationError: '원본 라이프로그가 삭제되어 문제를 만들 수 없어요.',
        });
        failed += 1;
        continue;
      }

      const notes = await this.patientMemoryNoteRepository.find({
        where: { memoryEntryId: set.memoryEntryId },
        order: { orderIndex: 'ASC' },
      });
      if (notes.length === 0) {
        await this.quizSetRepository.update(set.id, {
          generationStatus: 'failed',
          generationError: '환자 답변이 없어 문제를 만들 수 없어요.',
        });
        failed += 1;
        continue;
      }

      try {
        await this.runGeneration(set, entry, notes);
        recovered += 1;
      } catch (error) {
        // runGeneration이 이미 status=failed로 기록함. 여기서는 집계만.
        const message =
          error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(
          `pending 복구 실패 (quizSetId=${set.id}): ${message}`,
        );
        failed += 1;
      }
    }

    this.logger.log(
      `pending QuizSet 복구 완료 (recovered=${recovered}, failed=${failed}, scanned=${stale.length})`,
    );
    return { recovered, failed, skipped: 0 };
  }

  // ─── 내부 헬퍼 ─────────────────────────────────────────────────────

  /**
   * QuizBestScore upsert — 신규이거나 **더 높은 점수일 때만** 갱신.
   *
   * 동시 완료(더블클릭/네트워크 재시도)로 두 요청이 동시에 도달해도 안전하도록
   * 원자적으로 처리한다:
   *   1) 행이 없으면 INSERT 시도. 동시 INSERT 충돌(UNIQUE 위반, PG 23505)은
   *      삼키고 (2) 조건부 UPDATE 경로로 폴백한다.
   *   2) `best_score < :score` 조건의 단일 UPDATE 문(행 레벨 원자성)으로 갱신.
   *      affected>0 이면 새 최고점이다.
   */
  private async upsertBestScore(
    quizSetId: string,
    patientId: string,
    sessionToken: string,
    sessionScore: number,
  ): Promise<{ bestScore: number; isNewBest: boolean }> {
    const existing = await this.quizBestScoreRepository.findOne({
      where: { quizSetId },
    });

    if (!existing) {
      try {
        await this.quizBestScoreRepository.save(
          this.quizBestScoreRepository.create({
            quizSetId,
            patientId,
            bestScore: sessionScore,
            bestSessionToken: sessionToken,
          }),
        );
        return { bestScore: sessionScore, isNewBest: true };
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
        // 동시 INSERT 충돌 → 아래 조건부 UPDATE 경로로 폴백
      }
    }

    // 조건부 원자적 UPDATE: 기존보다 높을 때만 갱신
    const updateResult = await this.quizBestScoreRepository
      .createQueryBuilder()
      .update(QuizBestScore)
      .set({
        bestScore: sessionScore,
        bestSessionToken: sessionToken,
        achievedAt: () => 'now()',
      })
      .where('quiz_set_id = :quizSetId', { quizSetId })
      .andWhere('best_score < :sessionScore', { sessionScore })
      .execute();

    const isNewBest = (updateResult.affected ?? 0) > 0;

    // 최종 현재값 조회 (동시 갱신 결과 반영)
    const current = await this.quizBestScoreRepository.findOne({
      where: { quizSetId },
    });
    return {
      bestScore: current?.bestScore ?? sessionScore,
      isNewBest,
    };
  }

  /** PostgreSQL UNIQUE 제약 위반(23505) 판별 */
  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const code = (error as { code?: string }).code;
    const driverCode = (error as { driverError?: { code?: string } })
      .driverError?.code;
    return code === '23505' || driverCode === '23505';
  }

  private async findSetOrThrow(setId: string): Promise<QuizSet> {
    const set = await this.quizSetRepository.findOne({ where: { id: setId } });
    if (!set) {
      throw new QuizError(
        QuizErrorCode.QUIZ_SET_NOT_FOUND,
        `퀴즈 셋을 찾을 수 없습니다: ${setId}`,
      );
    }
    return set;
  }

  private verifyPatient(set: QuizSet, effectivePatientId: string): void {
    if (set.patientId !== effectivePatientId) {
      throw new QuizError(
        QuizErrorCode.FORBIDDEN,
        '해당 퀴즈에 대한 접근 권한이 없습니다.',
      );
    }
  }

  /** "활동: ... · 순간: ..." 형태로 조합 후 앞 40자 미리보기 */
  private buildNotePreview(notes: PatientMemoryNote[]): string {
    const preview = notes
      .map((note) => {
        const label = CATEGORY_LABELS[note.category] ?? note.category;
        return `${label}: ${note.answerText}`;
      })
      .join(' · ');
    return preview.length > 40 ? `${preview.slice(0, 40)}...` : preview;
  }

  private groupNotesByEntry(
    notes: PatientMemoryNote[],
  ): Map<string, PatientMemoryNote[]> {
    const map = new Map<string, PatientMemoryNote[]>();
    for (const note of notes) {
      const bucket = map.get(note.memoryEntryId) ?? [];
      bucket.push(note);
      map.set(note.memoryEntryId, bucket);
    }
    return map;
  }
}
