/**
 * LOC 검사 결과 저장소 - LocalStorage 구현체
 *
 * ILocResultRepository 인터페이스를 구현한다.
 * Date 타입은 ISO 문자열로 직렬화/역직렬화한다.
 * 저장 실패 시 에러를 throw한다 (Application 계층에서 STORAGE_FAILED로 래핑).
 *
 * 다른 저장소(원격 DB 등)로 교체 시 이 파일만 수정하면 된다.
 */

import type { ILocResultRepository } from '../domain/ILocResultRepository.js';
import type { LocAssessmentResult } from '../domain/LocAssessmentResult.js';
import type { LocTrial } from '../domain/LocTrial.js';
import { createLocTrial } from '../domain/LocTrial.js';

const STORAGE_KEY = 'loc_assessment_results';

/** LocalStorage에 저장되는 직렬화 형식 */
interface SerializedLocTrial {
  trialNumber: 1 | 2 | 3;
  audioEndTime: number;
  touchTime: number | null;
  latency: number | null;
  touchInBounds: boolean;
  score: 0 | 1 | 2 | 3;
}

interface SerializedLocAssessmentResult {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  patientId: string;
  trials: SerializedLocTrial[];
  finalScore: number;
  completedAt: string; // ISO 8601 문자열
  totalDurationMs: number;
}

export class LocalStorageLocResultRepository implements ILocResultRepository {
  async save(result: LocAssessmentResult): Promise<void> {
    try {
      const all = this.loadAll();
      all[result.id] = this.serialize(result);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
      throw new Error(
        `LocalStorage 저장 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async findById(id: string): Promise<LocAssessmentResult | null> {
    try {
      const all = this.loadAll();
      const raw = all[id];
      return raw ? this.deserialize(raw) : null;
    } catch (err) {
      throw new Error(
        `LocalStorage 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async findBySessionId(sessionId: string): Promise<LocAssessmentResult | null> {
    try {
      const all = this.loadAll();
      const entry = Object.values(all).find(
        (r) => r.sessionId === sessionId,
      );
      return entry ? this.deserialize(entry) : null;
    } catch (err) {
      throw new Error(
        `LocalStorage 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private loadAll(): Record<string, SerializedLocAssessmentResult | Omit<SerializedLocAssessmentResult, 'schemaVersion'>> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, SerializedLocAssessmentResult | Omit<SerializedLocAssessmentResult, 'schemaVersion'>>;
  }

  /** 도메인 엔티티 → 직렬화 형식 변환 */
  private serialize(result: LocAssessmentResult): SerializedLocAssessmentResult {
    return {
      schemaVersion: 1,
      id: result.id,
      sessionId: result.sessionId,
      patientId: result.patientId,
      trials: result.trials.map((trial) => this.serializeTrial(trial)),
      finalScore: result.finalScore,
      completedAt: result.completedAt.toISOString(),
      totalDurationMs: result.totalDurationMs,
    };
  }

  private serializeTrial(trial: LocTrial): SerializedLocTrial {
    return {
      trialNumber: trial.trialNumber,
      audioEndTime: trial.audioEndTime,
      touchTime: trial.touchTime,
      latency: trial.latency,
      touchInBounds: trial.touchInBounds,
      score: trial.score,
    };
  }

  /** 직렬화 형식 → 도메인 엔티티 변환 (schemaVersion 없는 기존 데이터도 허용) */
  private deserialize(raw: SerializedLocAssessmentResult | Omit<SerializedLocAssessmentResult, 'schemaVersion'>): LocAssessmentResult {
    const trials: LocTrial[] = raw.trials.map((t) =>
      createLocTrial({
        trialNumber: t.trialNumber,
        audioEndTime: t.audioEndTime,
        touchTime: t.touchTime,
        touchInBounds: t.touchInBounds,
      }),
    );

    // LocAssessmentResult는 createLocAssessmentResult로 재생성하지 않고
    // 저장된 값을 그대로 복원한다 (totalDurationMs, completedAt 보존을 위해)
    const result: LocAssessmentResult = Object.freeze({
      id: raw.id,
      sessionId: raw.sessionId,
      patientId: raw.patientId,
      trials: Object.freeze(trials) as readonly LocTrial[],
      finalScore: raw.finalScore,
      completedAt: new Date(raw.completedAt),
      totalDurationMs: raw.totalDurationMs,
    });

    return result;
  }
}
