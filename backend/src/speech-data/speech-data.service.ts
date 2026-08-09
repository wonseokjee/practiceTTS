import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { User } from '../auth/entities/user.entity';
import {
  SpeechRecording,
  SpeechTask,
} from './entities/speech-recording.entity';

/**
 * 음성 데이터 보존 서비스 (동의 기반).
 *
 * 자체 ASR 학습을 위해 동의한 환자의 발화를 파일 스토리지 + 메타 DB로 축적한다.
 * 미동의면 아무것도 저장하지 않는다. 삭제 요구 시 화자별 파일·행을 함께 지운다.
 */
@Injectable()
export class SpeechDataService {
  private readonly logger = new Logger(SpeechDataService.name);
  private readonly rootDir: string;
  /** 화자당 보존 상한. 초과분은 가장 오래된 것부터 지운다. 0/음수면 무제한. */
  private readonly maxPerPatient: number;

  constructor(
    @InjectRepository(SpeechRecording)
    private readonly recordings: Repository<SpeechRecording>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    config: ConfigService,
  ) {
    this.rootDir = config.get<string>('SPEECH_DATA_DIR', '../speech-data');
    this.maxPerPatient = Number(
      config.get<string>('SPEECH_DATA_MAX_PER_PATIENT', '500'),
    );
  }

  /** 환자의 보존 동의 상태를 반환한다. */
  async getConsent(
    patientId: string,
  ): Promise<{ consent: boolean; consentAt: Date | null }> {
    const u = await this.users.findOne({
      where: { id: patientId },
      select: { speechDataConsent: true, speechDataConsentAt: true },
    });
    return {
      consent: u?.speechDataConsent ?? false,
      consentAt: u?.speechDataConsentAt ?? null,
    };
  }

  /** 동의를 켜거나 끈다. 끄더라도 기존 보존 데이터는 삭제하지 않는다(삭제는 별도). */
  async setConsent(patientId: string, consent: boolean): Promise<void> {
    await this.users.update(
      { id: patientId },
      {
        speechDataConsent: consent,
        speechDataConsentAt: consent ? new Date() : null,
      },
    );
  }

  /**
   * 발화를 보존한다. **동의한 환자만.** 실패는 조용히 삼킨다(채점 흐름을 막지 않음).
   * 호출부는 fire-and-forget로 호출한다.
   */
  async saveRecording(params: {
    patientId: string;
    task: SpeechTask;
    targetText: string;
    audio: Buffer;
    recognizedText?: string | null;
    score?: number | null;
    durationMs?: number | null;
  }): Promise<void> {
    try {
      const { consent } = await this.getConsent(params.patientId);
      if (!consent) return; // 미동의 → 저장 안 함
      const target = (params.targetText ?? '').trim();
      if (!target || !params.audio?.length) return;

      const rel = path.posix.join(params.patientId, `${randomUUID()}.wav`);
      const abs = path.join(this.rootDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, params.audio);

      try {
        await this.recordings.insert({
          patientId: params.patientId,
          task: params.task,
          targetText: target,
          recognizedText: params.recognizedText ?? null,
          audioPath: rel,
          durationMs: params.durationMs ?? null,
          score: params.score ?? null,
        });
      } catch (insertErr) {
        // 메타 삽입이 실패하면 방금 쓴 파일은 DB 행 없는 고아가 된다(추적 불가한
        // PII + 공간 낭비). 파일을 되돌리고 나서 원래 에러를 다시 던진다.
        await fs.rm(abs, { force: true }).catch(() => undefined);
        throw insertErr;
      }

      // 화자당 보존 상한 초과분을 오래된 것부터 정리(무제한 PII 누적 방지).
      await this.pruneOldest(params.patientId);
    } catch (err) {
      // 보존 실패가 환자 경험을 막아선 안 된다. 경고만 남긴다.
      this.logger.warn(
        `음성 보존 실패(patient=${params.patientId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * 화자당 보존 상한을 넘긴 만큼 **가장 오래된** 발화를 지운다(파일 + 행).
   * 스케줄러 없이 쓰기 시점에 정리해 무제한 누적을 막는다(데이터 최소화).
   */
  private async pruneOldest(patientId: string): Promise<void> {
    if (!Number.isFinite(this.maxPerPatient) || this.maxPerPatient <= 0) return;
    const total = await this.recordings.count({ where: { patientId } });
    if (total <= this.maxPerPatient) return;
    const old = await this.recordings.find({
      where: { patientId },
      order: { createdAt: 'ASC' },
      take: total - this.maxPerPatient,
      select: { id: true, audioPath: true },
    });
    for (const r of old) {
      await fs
        .rm(path.join(this.rootDir, r.audioPath), { force: true })
        .catch(() => undefined);
    }
    await this.recordings.delete(old.map((r) => r.id));
  }

  /** 환자의 보존 데이터를 전부 삭제한다(파일 + 행). 컴플라이언스 삭제 경로. */
  async deleteAll(patientId: string): Promise<{ deleted: number }> {
    const rows = await this.recordings.find({
      where: { patientId },
      select: { id: true },
    });
    // 순서가 중요하다. **파일을 먼저** 지운다.
    //  - 화자 폴더를 통째로 recursive 제거해, 삭제 처리 중 fire-and-forget
    //    saveRecording이 늦게 쓴 파일까지 함께 없앤다.
    //  - fs.rm이 실패하면(권한/잠금) 던진다. 그러면 DB 행을 지우지 않아 재시도
    //    가능한 일관 상태가 남고, API도 거짓 "삭제됨" 대신 실패를 알린다.
    //    (force:true라 폴더가 이미 없어도 던지지 않는다 — 진짜 오류만 던진다.)
    await fs.rm(path.join(this.rootDir, patientId), {
      recursive: true,
      force: true,
    });
    await this.recordings.delete({ patientId });
    return { deleted: rows.length };
  }

  /** 보존된 발화 건수(대시보드/삭제 확인용). */
  async count(patientId: string): Promise<number> {
    return this.recordings.count({ where: { patientId } });
  }
}
