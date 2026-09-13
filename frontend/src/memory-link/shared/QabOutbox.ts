// QAB 결과 제출 재전송 대기열 — 실패한 제출을 localStorage에 남겨 앱을 다시 열 때
// 다시 시도한다(영어판 실행 계획 §13 8-1·2-2A: 제출 경로 둘을 공유 QabOutbox
// 하나로).
//
// 배경: 지금까지 두 제출 경로가 저마다 다르게 실패를 다뤘다.
//   - useMixedQuizSession.flushPending: 실패하면 메모리에만 남고, 같은 세션이
//     계속 진행돼야만(다음 문항으로 넘어가야만) 재시도됐다. 탭을 닫거나
//     화면을 나가면 그 시도로 끝 — 재시도 기회가 사라진다.
//   - AssessmentResultSubmitter.submit: 실패하면 콘솔에만 남기고 끝. 재시도가
//     아예 없다. 독립 검사(LOC·단어이해·문장이해)는 "임상적으로 더 중요한"
//     결과인데 가장 약한 보호를 받고 있었다.
//
// 이 모듈은 실패한 제출을 localStorage에 적재해 두고, 앱을 다시 열 때
// (AuthContext가 로그인 상태를 확인한 시점)마다 다시 시도한다. 네트워크
// 호출은 `flush()`에서만 일어난다 — `enqueue()`는 순수하게 저장만 한다.
// 그래야 두 제출 경로가 실패 시 이 모듈을 불러도 자기 자신의 재시도 로직
// (예: flushPending의 tail 재전송)과 네트워크 호출이 겹치지 않는다.
//
// 로그아웃 시 통째로 지운다(AuthContext.clearAuth, 2-2A) — 같은 기기를 다른
// 계정이 이어 쓸 때 앞사람이 남긴 대기열이 새 계정의 이름으로 제출되는 것을
// 막는다. 서버는 어차피 매 요청의 JWT로만 환자를 정하므로(클라 입력 불신),
// 잘못된 제출이 실제로 남에게 붙지는 않지만 — 로그아웃 뒤 대기열이 계속
// 남아 있으면 다음 사람의 로그인 성공 시점에 **그 사람 명의로** 새어 나간다.
// 그래서 저장이 아니라 계정 경계에서 끊는다.

import axios from 'axios';
import type { QabResultInput, QabSubtest } from '../patient/quiz/domain/QabResult.js';

const STORAGE_KEY = 'ml_qab_outbox';

/**
 * 이보다 오래 대기열에 남으면 버린다 — 서버가 `answeredAt`을 받아주는 창
 * (지금 − 24h ~ 지금, quiz.service.ts)과 같다. 그보다 늦게 도착하면 서버가
 * 값을 지금 근처로 접어서(clamp) 받으므로, 재시도해도 원래 푼 시각을 살릴
 * 수 없다 — 그 시점부턴 재시도가 데이터를 왜곡하기만 한다.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface QueuedSubmission {
  id: string;
  sessionToken: string;
  results: QabResultInput[];
  manifestVersion?: number;
  completed?: boolean;
  levels?: Partial<Record<QabSubtest, number>>;
  /** 대기열에 들어온 시각(ISO). 문항을 푼 시각(answeredAt)과는 다르다 — TTL 판단 전용. */
  queuedAt: string;
}

/** `quizApi.submitQabResults`와 같은 모양. 실제 호출부의 함수를 그대로 넘겨 쓴다 — 테스트가 아무 데도 몰래 네트워크를 부르지 않는다. */
export type QabSubmitFn = (
  sessionToken: string,
  results: QabResultInput[],
  manifestVersion?: number,
  completed?: boolean,
  levels?: Partial<Record<QabSubtest, number>>,
) => Promise<{ saved: number }>;

function readQueue(): QueuedSubmission[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSubmission[]) : [];
  } catch {
    // 손상된 값이거나 localStorage 접근 자체가 막혀 있으면(사생활 보호 모드
    // 등) 빈 대기열로 본다 — 여기서 죽으면 원래 없던 기능이 앱을 깨뜨린다.
    return [];
  }
}

function writeQueue(queue: QueuedSubmission[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // 저장 공간이 막혀 있으면 이번 항목은 재부팅 재시도를 못 받는다 — 그래도
    // 호출부 자체의 즉시 재시도(있다면)는 이 모듈과 무관하게 그대로 동작한다.
  }
}

/** 오래된 항목을 버리고, 몇 건 버렸는지 로그한다. */
function pruneExpired(
  queue: QueuedSubmission[],
  now: number,
): QueuedSubmission[] {
  const fresh = queue.filter(
    (item) => now - Date.parse(item.queuedAt) <= MAX_AGE_MS,
  );
  const dropped = queue.length - fresh.length;
  if (dropped > 0) {
    console.warn(
      `[qab-outbox] ${dropped}건이 24시간을 넘겨 재전송을 포기했습니다.`,
    );
  }
  return fresh;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

/**
 * 실패한 제출을 대기열에 적재한다. **네트워크를 부르지 않는다** — 저장만
 * 한다. 즉시 재시도는 호출부(각자의 기존 로직)와 다음 `flush()` 몫이다.
 */
export function enqueue(
  sessionToken: string,
  results: QabResultInput[],
  manifestVersion?: number,
  completed?: boolean,
  levels?: Partial<Record<QabSubtest, number>>,
): void {
  const queue = pruneExpired(readQueue(), Date.now());
  queue.push({
    id: nextId(),
    sessionToken,
    results,
    manifestVersion,
    completed,
    levels,
    queuedAt: new Date().toISOString(),
  });
  writeQueue(queue);
}

/** 로그아웃 시 통째로 비운다(2-2A). */
export function clear(): void {
  writeQueue([]);
}

/** 대기열에 남은 건수 — 진단·테스트용. */
export function size(): number {
  return readQueue().length;
}

let inFlight: Promise<void> | null = null;

/**
 * 대기열을 앞에서부터 비운다. 이미 도는 flush가 있으면 그 완료를 그대로
 * 같이 기다린다(중복 실행 방지) — 새 flush를 또 시작하지 않는다.
 *
 * 항목 하나가 4xx(다시 보내도 똑같이 실패할 요청 — 예: 서버가 모르는 필드,
 * 유효성 검증 실패)로 거절되면 **그 항목만 버리고** 다음으로 넘어간다.
 * 그러지 않으면 문항 하나가 잘못돼 대기열 전체가 영원히 막힌다. 5xx·네트워크
 * 오류는 이번 flush를 멈춘다 — 남은 항목은 대기열에 그대로 두고 다음
 * 기회(재부팅·재로그인)에 다시 시도한다.
 */
export function flush(submit: QabSubmitFn): Promise<void> {
  if (inFlight) return inFlight;
  const started = run(submit).finally(() => {
    inFlight = null;
  });
  inFlight = started;
  return started;
}

async function run(submit: QabSubmitFn): Promise<void> {
  let queue = pruneExpired(readQueue(), Date.now());
  while (queue.length > 0) {
    const [head, ...rest] = queue;
    try {
      await submit(
        head.sessionToken,
        head.results,
        head.manifestVersion,
        head.completed,
        head.levels,
      );
      queue = rest;
      writeQueue(queue);
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const isClientError =
        status !== undefined && status >= 400 && status < 500;
      if (isClientError) {
        console.warn(
          `[qab-outbox] 재시도해도 실패할 항목이라 버립니다 ` +
            `(status=${status}, sessionToken=${head.sessionToken}).`,
        );
        queue = rest;
        writeQueue(queue);
        continue;
      }
      // 네트워크·5xx — 여기서 멈춘다. 이 항목과 뒤의 항목을 그대로 남긴다.
      return;
    }
  }
}
