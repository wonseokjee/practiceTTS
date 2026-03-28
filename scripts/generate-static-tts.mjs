/**
 * 정적 TTS 음성 에셋 일괄 생성 스크립트
 *
 * 실행 환경: Node.js 18+ (ESM)
 * 의존성:   microsoft-cognitiveservices-speech-sdk
 *
 * 실행 방법:
 *   node scripts/generate-static-tts.mjs [--dry-run] [--force]
 *
 * 환경변수 (필수):
 *   AZURE_SPEECH_KEY     Azure Cognitive Services Speech API 키
 *   AZURE_SPEECH_REGION  Azure 리전 (예: koreacentral, eastasia)
 *
 * 옵션:
 *   --dry-run  실제 API 호출 없이 생성 대상 목록만 출력
 *   --force    이미 파일이 존재해도 덮어쓰기
 *
 * 설계 원칙:
 *   - 멱등성: 파일 존재 시 API 호출 생략 (--force로 재생성 가능)
 *   - 순차 실행: Azure API Rate Limit 초과 방지
 *   - 실패 격리: 개별 파일 실패 시 나머지 계속 진행
 *   - 포맷: Audio24Khz48KBitRateMonoMp3 (speech 용도 최적)
 */

import sdk from 'microsoft-cognitiveservices-speech-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// 프로젝트 루트의 .env 파일 자동 로드
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── 생성 대상 정의 ────────────────────────────────────────────────────────────

/** @typedef {{ text: string, outputPath: string, category: string }} AudioAsset */

/** @type {AudioAsset[]} */
const AUDIO_ASSETS = [
  // ── LOC 지시문 (1개, 모든 시도에 동일한 지시문 사용) ─────────────────────
  {
    text: '화면을 눌러주세요.',
    outputPath: 'frontend/public/assets/audio/loc/loc_prompt.mp3',
    category: 'LOC',
  },

  // ── SentComp 문장 (10개) ──────────────────────────────────────────────────
  {
    text: '개가 고양이를 쫓고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_01.mp3',
    category: 'SentComp',
  },
  {
    text: '엄마가 아이에게 밥을 먹이고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_02.mp3',
    category: 'SentComp',
  },
  {
    text: '소년이 소녀에게 꽃을 주고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_03.mp3',
    category: 'SentComp',
  },
  {
    text: '선생님이 학생에게 책을 건네주고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_04.mp3',
    category: 'SentComp',
  },
  {
    text: '공을 차는 아이가 웃고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_05.mp3',
    category: 'SentComp',
  },
  {
    text: '책을 읽는 여자가 안경을 쓰고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_06.mp3',
    category: 'SentComp',
  },
  {
    text: '노래하는 남자가 기타를 들고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_07.mp3',
    category: 'SentComp',
  },
  {
    text: '뛰어가는 강아지가 공을 물고 있어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_08.mp3',
    category: 'SentComp',
  },
  {
    text: '아빠는 엄마가 요리를 한다고 생각해요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_09.mp3',
    category: 'SentComp',
  },
  {
    text: '선생님은 학생이 공부를 잘한다고 믿어요.',
    outputPath: 'frontend/public/assets/audio/sentComp/sentComp_10.mp3',
    category: 'SentComp',
  },

  // ── WordComp 단어 (20개) ──────────────────────────────────────────────────
  {
    text: '사과',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_001_target.mp3',
    category: 'WordComp',
  },
  {
    text: '신발',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_002_target.mp3',
    category: 'WordComp',
  },
  {
    text: '의자',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_003_target.mp3',
    category: 'WordComp',
  },
  {
    text: '고양이',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_004_target.mp3',
    category: 'WordComp',
  },
  {
    text: '자동차',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_005_target.mp3',
    category: 'WordComp',
  },
  {
    text: '책',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_006_target.mp3',
    category: 'WordComp',
  },
  {
    text: '냉장고',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_007_target.mp3',
    category: 'WordComp',
  },
  {
    text: '사자',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_008_target.mp3',
    category: 'WordComp',
  },
  {
    text: '바나나',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_009_target.mp3',
    category: 'WordComp',
  },
  {
    text: '병원',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_010_target.mp3',
    category: 'WordComp',
  },
  {
    text: '우유',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_011_target.mp3',
    category: 'WordComp',
  },
  {
    text: '나무',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_012_target.mp3',
    category: 'WordComp',
  },
  {
    text: '가위',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_013_target.mp3',
    category: 'WordComp',
  },
  {
    text: '모자',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_014_target.mp3',
    category: 'WordComp',
  },
  {
    text: '전화기',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_015_target.mp3',
    category: 'WordComp',
  },
  {
    text: '수박',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_016_target.mp3',
    category: 'WordComp',
  },
  {
    text: '비행기',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_017_target.mp3',
    category: 'WordComp',
  },
  {
    text: '거울',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_018_target.mp3',
    category: 'WordComp',
  },
  {
    text: '학교',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_019_target.mp3',
    category: 'WordComp',
  },
  {
    text: '칫솔',
    outputPath: 'frontend/public/assets/audio/wordComp/wc_020_target.mp3',
    category: 'WordComp',
  },
];

// ─── Azure TTS 합성 ───────────────────────────────────────────────────────────

/**
 * 텍스트를 Azure TTS(ko-KR-SunHiNeural)로 변환하여 MP3 파일로 저장한다.
 *
 * @param {string} text - 변환할 텍스트
 * @param {string} absoluteOutputPath - 절대 경로 출력 파일
 * @param {string} speechKey - Azure Speech API 키
 * @param {string} speechRegion - Azure 리전
 * @returns {Promise<void>}
 */
function synthesizeToFile(text, absoluteOutputPath, speechKey, speechRegion) {
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
    speechConfig.speechSynthesisVoiceName = 'ko-KR-SunHiNeural';
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;

    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(absoluteOutputPath);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve();
        } else {
          reject(
            new Error(
              `합성 실패 [reason=${result.reason}]: ${result.errorDetails ?? '알 수 없는 오류'}`,
            ),
          );
        }
      },
      (error) => {
        synthesizer.close();
        reject(new Error(`SDK 오류: ${String(error)}`));
      },
    );
  });
}

// ─── 단일 에셋 처리 ───────────────────────────────────────────────────────────

/**
 * @typedef {{ status: 'OK' | 'SKIP' | 'DRY_RUN' | 'FAIL', path: string, durationMs?: number, error?: string }} AssetResult
 */

/**
 * @param {AudioAsset} asset
 * @param {{ dryRun: boolean, force: boolean, speechKey: string, speechRegion: string }} options
 * @returns {Promise<AssetResult>}
 */
async function processAsset(asset, options) {
  const absolutePath = path.resolve(PROJECT_ROOT, asset.outputPath);

  // 파일 존재 여부 확인
  const exists = await fs
    .access(absolutePath)
    .then(() => true)
    .catch(() => false);

  if (exists && !options.force) {
    return { status: 'SKIP', path: asset.outputPath };
  }

  if (options.dryRun) {
    return { status: 'DRY_RUN', path: asset.outputPath };
  }

  // 출력 디렉토리 생성
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const startMs = Date.now();
  await synthesizeToFile(asset.text, absolutePath, options.speechKey, options.speechRegion);
  const durationMs = Date.now() - startMs;

  return { status: 'OK', path: asset.outputPath, durationMs };
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const speechKey = process.env.AZURE_SPEECH_KEY ?? '';
  const speechRegion = process.env.AZURE_SPEECH_REGION ?? '';

  // 환경변수 검증 (dry-run 제외)
  if (!dryRun) {
    if (!speechKey) {
      console.error('[ERROR] 환경변수 AZURE_SPEECH_KEY 가 설정되지 않았습니다.');
      console.error('        export AZURE_SPEECH_KEY="your-key-here"');
      process.exit(1);
    }
    if (!speechRegion) {
      console.error('[ERROR] 환경변수 AZURE_SPEECH_REGION 이 설정되지 않았습니다.');
      console.error('        export AZURE_SPEECH_REGION="koreacentral"');
      process.exit(1);
    }
  }

  console.log(`\n정적 TTS 음성 에셋 생성 스크립트`);
  console.log(`총 대상: ${AUDIO_ASSETS.length}개`);
  console.log(`포맷: Audio24Khz48KBitRateMonoMp3 (ko-KR-SunHiNeural)`);
  if (dryRun) console.log(`모드: DRY-RUN (API 호출 없음)`);
  if (force) console.log(`모드: FORCE (기존 파일 덮어쓰기)`);
  console.log('─'.repeat(60));

  /** @type {AssetResult[]} */
  const results = [];

  for (const asset of AUDIO_ASSETS) {
    try {
      const result = await processAsset(asset, { dryRun, force, speechKey, speechRegion });
      results.push(result);

      const filename = path.basename(result.path);
      switch (result.status) {
        case 'OK':
          console.log(`[OK]      ${filename.padEnd(30)} (${(result.durationMs ?? 0) / 1000}s)`);
          break;
        case 'SKIP':
          console.log(`[SKIP]    ${filename.padEnd(30)} 이미 존재함`);
          break;
        case 'DRY_RUN':
          console.log(`[DRY-RUN] ${filename.padEnd(30)} "${asset.text}" → ${asset.outputPath}`);
          break;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ status: 'FAIL', path: asset.outputPath, error: errorMsg });
      console.error(`[FAIL]    ${path.basename(asset.outputPath).padEnd(30)} ${errorMsg}`);
    }
  }

  // 결과 요약
  const ok = results.filter((r) => r.status === 'OK').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const dryRunCount = results.filter((r) => r.status === 'DRY_RUN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;

  console.log('─'.repeat(60));
  if (dryRun) {
    console.log(`\n완료(DRY-RUN): ${dryRunCount}개 생성 예정`);
  } else {
    console.log(`\n완료: ${AUDIO_ASSETS.length}개 중 성공 ${ok}, 실패 ${fail}, 건너뜀 ${skip}`);
  }

  if (fail > 0) {
    console.error('\n실패한 파일:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => console.error(`  - ${r.path}: ${r.error ?? ''}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
