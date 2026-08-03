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

  constructor(
    @InjectRepository(SpeechRecording)
    private readonly recordings: Repository<SpeechRecording>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    config: ConfigService,
  ) {
    this.rootDir = config.get<string>('SPEECH_DATA_DIR', '../speech-data');
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

      await this.recordings.insert({
        patientId: params.patientId,
        task: params.task,
        targetText: target,
        audioPath: rel,
        durationMs: params.durationMs ?? null,
        score: params.score ?? null,
      });
    } catch (err) {
      // 보존 실패가 환자 경험을 막아선 안 된다. 경고만 남긴다.
      this.logger.warn(
        `음성 보존 실패(patient=${params.patientId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** 환자의 보존 데이터를 전부 삭제한다(파일 + 행). 컴플라이언스 삭제 경로. */
  async deleteAll(patientId: string): Promise<{ deleted: number }> {
    const rows = await this.recordings.find({
      where: { patientId },
      select: { id: true, audioPath: true },
    });
    for (const r of rows) {
      try {
        await fs.rm(path.join(this.rootDir, r.audioPath), { force: true });
      } catch (err) {
        this.logger.warn(`파일 삭제 실패(${r.audioPath}): ${String(err)}`);
      }
    }
    await this.recordings.delete({ patientId });
    // 화자 폴더도 정리(비어 있으면).
    try {
      await fs.rmdir(path.join(this.rootDir, patientId));
    } catch {
      // 남은 파일이 있거나 폴더가 없으면 무시.
    }
    return { deleted: rows.length };
  }

  /** 보존된 발화 건수(대시보드/삭제 확인용). */
  async count(patientId: string): Promise<number> {
    return this.recordings.count({ where: { patientId } });
  }
}
