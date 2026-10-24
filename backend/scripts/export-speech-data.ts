/**
 * 동의 녹음 → Colab 학습용 묶음 내보내기 (검토 문서 G4).
 *
 * 제품 결정(검토 문서 3a)대로 학습은 Colab에서 한다. 이 명령은 서버의 speech_recordings·
 * 오디오·보호자 정정을 한 폴더로 묶는다. 묶음을 압축해 Drive에 올리고 Colab에서
 * `scripts/asr_eval/build_training_set.py`에 넘긴다.
 *
 *   <out>/recordings.jsonl  가명 화자(speaker)·과제·목표·인식 결과·점수·clip_id·오디오 상대경로
 *   <out>/qab.jsonl         내보낸 녹음과 이어지는 보호자 정정(clip_id, is_correct, caregiver_corrected)
 *   <out>/audio/<가명>/*.wav
 *   <out>/manifest.json     내보낸 시각·건수(전사 없음)
 *
 * 환자 UUID는 묶음에 들어가지 않는다(speech-export.ts). 철회한 환자의 기존 녹음도 남아 있으면
 * 내보낸다(3a-6: 철회해도 기존 녹음은 지우지 않는다). "전부 삭제"한 환자는 행이 없어 빠진다.
 * 묶음에는 전사(환자 발화)가 있으므로 리포 밖에 두고, Colab 사본은 학습이 끝나면 지운다.
 *
 * 실행:
 *   cd backend && npm run export:speech-data -- --out=<리포 밖 빈 폴더> [--salt=<문자열>]
 *   --salt: 가명 화자 ID에 섞는 값. 기본은 SPEECH_EXPORT_SALT, 없으면 빈 값.
 *           같은 값을 계속 써야 내보낼 때마다 화자 가명(=train/dev/test 분리)이 같다.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  planSpeechExport,
  RecordingRow,
  toJsonl,
  VerdictRow,
} from '../src/speech-data/speech-export';

interface Args {
  out: string;
  salt: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const out = get('out');
  if (!out) {
    throw new Error('--out=<폴더>가 필요합니다 (리포 밖, 비어 있는 폴더)');
  }
  return { out, salt: get('salt') ?? process.env.SPEECH_EXPORT_SALT ?? '' };
}

async function exists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

export async function exportSpeechData(
  ds: DataSource,
  opts: { out: string; salt: string; audioRoot: string },
): Promise<{
  recordings: number;
  verdicts: number;
  speakers: number;
  missingAudio: number;
}> {
  const outDir = path.resolve(opts.out);
  const repoRoot = path.resolve(__dirname, '..', '..');
  if (!path.relative(repoRoot, outDir).startsWith('..')) {
    throw new Error(
      `묶음에는 전사가 들어갑니다. 리포 밖 폴더를 고르세요: ${outDir}`,
    );
  }
  if ((await exists(outDir)) && (await fs.readdir(outDir)).length > 0) {
    throw new Error(`비어 있지 않은 폴더입니다: ${outDir}`);
  }

  const recordings = await ds.query<RecordingRow[]>(`
    SELECT patient_id, task, target_text, recognized_text, audio_path,
           score, duration_ms, clip_id, created_at
      FROM speech_recordings
     ORDER BY created_at
  `);
  const verdicts = await ds.query<VerdictRow[]>(`
    SELECT clip_id, is_correct, caregiver_corrected
      FROM qab_results
     WHERE clip_id IS NOT NULL AND caregiver_corrected IS TRUE
  `);

  const present = new Set<string>();
  for (const r of recordings) {
    if (await exists(path.join(opts.audioRoot, r.audio_path))) {
      present.add(r.audio_path);
    }
  }
  const plan = planSpeechExport(recordings, verdicts, {
    salt: opts.salt,
    audioExists: (p) => present.has(p),
  });

  await fs.mkdir(outDir, { recursive: true });
  for (const c of plan.copies) {
    const to = path.join(outDir, c.to);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(path.join(opts.audioRoot, c.from), to);
  }
  await fs.writeFile(
    path.join(outDir, 'recordings.jsonl'),
    toJsonl(plan.recordings),
    'utf8',
  );
  await fs.writeFile(
    path.join(outDir, 'qab.jsonl'),
    toJsonl(plan.verdicts),
    'utf8',
  );
  const summary = {
    recordings: plan.recordings.length,
    verdicts: plan.verdicts.length,
    speakers: plan.speakers,
    missingAudio: plan.missingAudio,
  };
  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        saltUsed: opts.salt !== '',
        ...summary,
      },
      null,
      2,
    ),
    'utf8',
  );
  return summary;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { default: AppDataSource } =
    await import('../src/database/data-source');
  await AppDataSource.initialize();
  try {
    // 앱과 같은 기본값(SpeechDataService): backend 폴더 기준 ../speech-data
    const audioRoot = path.resolve(
      process.env.SPEECH_DATA_DIR || '../speech-data',
    );
    const s = await exportSpeechData(AppDataSource, { ...args, audioRoot });
    console.log(
      `녹음 ${s.recordings}건 · 화자 ${s.speakers}명 · 보호자 정정 ${s.verdicts}건` +
        (s.missingAudio ? ` · 오디오 없음 ${s.missingAudio}건(제외)` : '') +
        `\n→ ${path.resolve(args.out)}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof Error && error.message ? error.message : error,
    );
    process.exit(1);
  });
}
