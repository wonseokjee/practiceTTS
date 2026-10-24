import { createHash } from 'crypto';
import * as path from 'path';

/**
 * 동의 녹음 → Colab 학습용 묶음(검토 문서 G4). DB·파일 접근 없는 순수 부분이다.
 * 실행 진입점은 `scripts/export-speech-data.ts`.
 *
 * 제품 결정(검토 문서 3a-4)으로 학습은 Colab에서 하므로, 묶음은 Google 서버로 나간다.
 * 그래서 나가는 것을 학습에 필요한 만큼으로 줄인다:
 *  - 환자 UUID 대신 가명 화자 ID(`spk_` + sha256 앞 12자리). 학습셋 스크립트는 화자 분리에만
 *    화자를 쓰므로 가명이면 충분하다. 같은 salt면 내보낼 때마다 같은 가명이라 split이 흔들리지 않는다.
 *  - 오디오 경로의 환자 폴더도 가명으로 바꾼다(`audio/<가명>/<파일>`).
 *  - 보호자 정정은 내보내는 녹음과 이어지는 행만, 판정 열만.
 */

export interface RecordingRow {
  patient_id: string;
  task: string;
  target_text: string;
  recognized_text: string | null;
  audio_path: string;
  score: number | null;
  duration_ms: number | null;
  clip_id: string | null;
  created_at: Date | string;
}

export interface VerdictRow {
  clip_id: string;
  is_correct: boolean;
  caregiver_corrected: boolean | null;
}

export interface ExportedRecording {
  speaker: string;
  task: string;
  target_text: string;
  recognized_text: string | null;
  audio_path: string;
  score: number | null;
  duration_ms: number | null;
  clip_id: string | null;
  created_at: string;
}

export interface SpeechExportPlan {
  recordings: ExportedRecording[];
  verdicts: VerdictRow[];
  /** 원본(SPEECH_DATA_DIR 기준) → 묶음 안 경로 */
  copies: { from: string; to: string }[];
  speakers: number;
}

export function pseudonymizeSpeaker(patientId: string, salt = ''): string {
  const h = createHash('sha256')
    .update(`${salt}:${patientId.toLowerCase()}`)
    .digest('hex');
  return `spk_${h.slice(0, 12)}`;
}

/** audio_path에서 파일명만 남긴다. `..` 등으로 묶음 밖을 가리키지 못하게 basename만 쓴다. */
function audioFileName(audioPath: string): string {
  return path.posix.basename(audioPath.replace(/\\/g, '/'));
}

/**
 * 내보낼 행과 복사 목록을 만든다. `audioExists`가 false인 녹음은 뺀다
 * (삭제 요구로 파일만 먼저 지워진 경우 등).
 */
export function planSpeechExport(
  recordings: RecordingRow[],
  verdicts: VerdictRow[],
  opts: { salt?: string; audioExists?: (audioPath: string) => boolean } = {},
): SpeechExportPlan & { missingAudio: number } {
  const exists = opts.audioExists ?? (() => true);
  const out: ExportedRecording[] = [];
  const copies: { from: string; to: string }[] = [];
  const clips = new Set<string>();
  const speakers = new Set<string>();
  let missingAudio = 0;

  for (const r of recordings) {
    if (!exists(r.audio_path)) {
      missingAudio += 1;
      continue;
    }
    const speaker = pseudonymizeSpeaker(r.patient_id, opts.salt);
    const to = `audio/${speaker}/${audioFileName(r.audio_path)}`;
    copies.push({ from: r.audio_path, to });
    speakers.add(speaker);
    const clip = r.clip_id ? r.clip_id.toLowerCase() : null;
    if (clip) clips.add(clip);
    out.push({
      speaker,
      task: r.task,
      target_text: r.target_text,
      recognized_text: r.recognized_text,
      audio_path: to,
      score: r.score,
      duration_ms: r.duration_ms,
      clip_id: clip,
      created_at: new Date(r.created_at).toISOString(),
    });
  }

  const linked = verdicts
    .filter(
      (v) =>
        v.caregiver_corrected === true && clips.has(v.clip_id.toLowerCase()),
    )
    .map((v) => ({
      clip_id: v.clip_id.toLowerCase(),
      is_correct: v.is_correct,
      caregiver_corrected: true,
    }));

  return {
    recordings: out,
    verdicts: linked,
    copies,
    speakers: speakers.size,
    missingAudio,
  };
}

export function toJsonl(rows: object[]): string {
  return (
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  );
}
