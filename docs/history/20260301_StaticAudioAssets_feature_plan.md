# 정적 음성 에셋 (Pre-generated Static Audio Assets) Feature Plan

> 작성일: 2026-03-01
> 참조:
> - `docs/history/20260301_TTS_Caching_implementation_plan.md` §2.1
> - `docs/history/20260223_LOC_feature_plan.md`
> - `docs/history/20260223_SentComp_feature_plan.md`
> - `docs/history/20260223_WordComp_feature_plan.md`

---

## 1. 목표 및 배경

### 1-1. 목표

런타임 TTS(WebSpeechTtsService, Web Speech API)를 사용하는 LOC 검사의 지시문 3개를, 배포 전 Azure TTS(ko-KR-SunHiNeural)로 미리 생성한 MP3 파일로 교체한다. 동시에 SentComp·WordComp가 참조하지만 실제 파일이 없는 오디오 URL들도 동일 파이프라인으로 일괄 생성한다.

### 1-2. 배경 및 문제

| 검사 | 현재 방식 | 문제점 |
|------|---------|--------|
| LOC | `WebSpeechTtsService` (브라우저 Web Speech API) | 음성 품질이 브라우저/OS 의존, ko-KR 음성 없으면 폴백, 매 재생마다 초기화 오버헤드 |
| SentComp | `sentCompItems.json`의 `sentenceAudioUrl` 참조 | 파일 자체가 존재하지 않아 재생 불가 |
| WordComp | `wordComprehensionItems.json`의 `targetAudioUrl` 참조 | 파일 자체가 존재하지 않아 재생 불가 |

### 1-3. 해결 방향 (§2.1 정적 에셋 전략)

- 빌드/배포 전 `scripts/generate-static-tts.mjs` 를 한 번 실행하여 MP3 파일 일괄 생성
- LOC: `ITtsService` 구현체를 `WebSpeechTtsService` → `StaticFileTtsService` 로 교체
- SentComp/WordComp: 파일을 생성하기만 하면 기존 `IAudioPlayer` 경로가 그대로 동작
- 폴백: 매핑에 없는 텍스트는 `WebSpeechTtsService` 로 자동 위임 (확장성 보장)

---

## 2. 파악된 데이터 현황

### 2-1. LOC 지시문 (3개)

| trialNumber | 텍스트 | 출력 경로 |
|:-----------:|--------|-----------|
| 1 | `손을 들어주세요.` | `frontend/public/assets/audio/loc/loc_trial_1.mp3` |
| 2 | `주먹을 쥐어주세요.` | `frontend/public/assets/audio/loc/loc_trial_2.mp3` |
| 3 | `눈을 감아주세요.` | `frontend/public/assets/audio/loc/loc_trial_3.mp3` |

### 2-2. SentComp 문장 (10개)

| itemId | 텍스트 | 출력 경로 |
|--------|--------|-----------|
| sentComp_01 | `개가 고양이를 쫓고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_01.mp3` |
| sentComp_02 | `엄마가 아이에게 밥을 먹이고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_02.mp3` |
| sentComp_03 | `소년이 소녀에게 꽃을 주고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_03.mp3` |
| sentComp_04 | `선생님이 학생에게 책을 건네주고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_04.mp3` |
| sentComp_05 | `공을 차는 아이가 웃고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_05.mp3` |
| sentComp_06 | `책을 읽는 여자가 안경을 쓰고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_06.mp3` |
| sentComp_07 | `노래하는 남자가 기타를 들고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_07.mp3` |
| sentComp_08 | `뛰어가는 강아지가 공을 물고 있어요` | `frontend/public/assets/audio/sentComp/sentComp_08.mp3` |
| sentComp_09 | `아빠는 엄마가 요리를 한다고 생각해요` | `frontend/public/assets/audio/sentComp/sentComp_09.mp3` |
| sentComp_10 | `선생님은 학생이 공부를 잘한다고 믿어요` | `frontend/public/assets/audio/sentComp/sentComp_10.mp3` |

### 2-3. WordComp 단어 (20개)

`targetAudioUrl` 패턴: `/assets/audio/wordComp/{itemId}_target.mp3`

| itemId | targetWord | 출력 경로 |
|--------|-----------|-----------|
| wc_001 | `사과` | `frontend/public/assets/audio/wordComp/wc_001_target.mp3` |
| wc_002 | `신발` | `frontend/public/assets/audio/wordComp/wc_002_target.mp3` |
| wc_003 | `의자` | `frontend/public/assets/audio/wordComp/wc_003_target.mp3` |
| wc_004 | `고양이` | `frontend/public/assets/audio/wordComp/wc_004_target.mp3` |
| wc_005 | `자동차` | `frontend/public/assets/audio/wordComp/wc_005_target.mp3` |
| wc_006 | `책` | `frontend/public/assets/audio/wordComp/wc_006_target.mp3` |
| wc_007 | `냉장고` | `frontend/public/assets/audio/wordComp/wc_007_target.mp3` |
| wc_008 | `사자` | `frontend/public/assets/audio/wordComp/wc_008_target.mp3` |
| wc_009 | `바나나` | `frontend/public/assets/audio/wordComp/wc_009_target.mp3` |
| wc_010 | `병원` | `frontend/public/assets/audio/wordComp/wc_010_target.mp3` |
| wc_011 | `우유` | `frontend/public/assets/audio/wordComp/wc_011_target.mp3` |
| wc_012 | `나무` | `frontend/public/assets/audio/wordComp/wc_012_target.mp3` |
| wc_013 | `가위` | `frontend/public/assets/audio/wordComp/wc_013_target.mp3` |
| wc_014 | `모자` | `frontend/public/assets/audio/wordComp/wc_014_target.mp3` |
| wc_015 | `전화기` | `frontend/public/assets/audio/wordComp/wc_015_target.mp3` |
| wc_016 | `수박` | `frontend/public/assets/audio/wordComp/wc_016_target.mp3` |
| wc_017 | `비행기` | `frontend/public/assets/audio/wordComp/wc_017_target.mp3` |
| wc_018 | `거울` | `frontend/public/assets/audio/wordComp/wc_018_target.mp3` |
| wc_019 | `학교` | `frontend/public/assets/audio/wordComp/wc_019_target.mp3` |
| wc_020 | `칫솔` | `frontend/public/assets/audio/wordComp/wc_020_target.mp3` |

총 생성 파일: **33개** (LOC 3 + SentComp 10 + WordComp 20)

---

## 3. 도메인 모델링

### 3-1. 값 객체 및 타입 정의

이 Feature는 신규 도메인 엔티티를 추가하지 않는다. 기존 `ITtsService` 인터페이스의 계약을 유지하면서 구현체를 교체하는 패턴이다.

**핵심 타입 (기존, 변경 없음):**

```typescript
// frontend/src/shared/domain/ITtsService.ts (변경 없음)
interface TtsPlaybackResult {
  readonly startTime: number;   // performance.now() 기준
  readonly endTime: number;
  readonly durationMs: number;
}

interface ITtsService {
  speak(text: string): Promise<TtsPlaybackResult>;
  cancel(): void;
}
```

**신규 매니페스트 타입:**

```typescript
// frontend/src/assets/data/staticTtsManifest.ts [NEW]
// 텍스트 → 정적 오디오 파일 URL 매핑 레코드
// key: 정확한 텍스트 문자열 (공백, 마침표 포함)
// value: public/ 기준 절대 경로 (예: "/assets/audio/loc/loc_trial_1.mp3")
export type StaticTtsManifest = Readonly<Record<string, string>>;
```

### 3-2. 유스케이스 분석

새로운 유스케이스는 없다. 기존 유스케이스의 의존성 주입 지점만 교체된다.

| 유스케이스 | 변경 전 | 변경 후 |
|-----------|---------|---------|
| `ConductLocTrialUseCase.playInstruction()` | `WebSpeechTtsService` 주입 | `StaticFileTtsService` 주입 |

`ConductLocTrialUseCase` 자체는 `ITtsService` 인터페이스만 의존하므로 **변경 없음**이 보장된다.

---

## 4. 클린 아키텍처 레이어 설계

### 4-1. 의존성 다이어그램

```
[Composition Root: LocScreen.tsx]
  |
  +--생성--> StaticFileTtsService          [NEW: Infrastructure]
  |            +-- staticTtsManifest       [NEW: Assets/Data]
  |            +-- HtmlAudioPlayer         [기존 재사용]
  |            +-- WebSpeechTtsService     [기존, 폴백용]
  |
  +--주입--> ConductLocTrialUseCase        [기존, 변경 없음]
               +-- ITtsService (interface)  [기존, 변경 없음]

[빌드 타임 스크립트]
  scripts/generate-static-tts.mjs          [NEW: scripts/]
    +-- Azure Cognitive Services SDK (@azure/cognitiveservices-speech-sdk)
    +-- sentCompItems.json                  [읽기 전용]
    +-- wordComprehensionItems.json         [읽기 전용]
    --> frontend/public/assets/audio/**/*.mp3  [출력]
```

### 4-2. 레이어별 설계

#### Infrastructure Layer: StaticFileTtsService

**파일:** `frontend/src/shared/infrastructure/StaticFileTtsService.ts` [NEW]

**책임:**
- `ITtsService` 계약을 구현한다.
- `speak(text)` 호출 시 내부 매니페스트에서 text → URL을 조회한다.
- URL이 존재하면 `HtmlAudioPlayer.load(url)` → `.play()` 로 재생하고, `TtsPlaybackResult` 를 구성한다.
- URL이 존재하지 않으면 `WebSpeechTtsService` 에 위임(폴백)한다.
- `cancel()` 호출 시 현재 재생 중인 `HtmlAudioPlayer.stop()` 과 폴백 서비스의 `cancel()` 을 모두 호출한다.

**공개 인터페이스:**

```typescript
// frontend/src/shared/infrastructure/StaticFileTtsService.ts

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';
import type { StaticTtsManifest } from '../../assets/data/staticTtsManifest.js';

export class StaticFileTtsService implements ITtsService {
  constructor(
    manifest: StaticTtsManifest,
    audioPlayer: IAudioPlayer,
    fallback: ITtsService,
  ) { ... }

  speak(text: string): Promise<TtsPlaybackResult>;
  cancel(): void;
}
```

**설계 원칙 적용:**
- `manifest`, `audioPlayer`, `fallback` 모두 생성자 주입 → 테스트 시 Mock 교체 가능
- `HtmlAudioPlayer`를 직접 `new` 하지 않는다 (의존성 역전)

#### Assets/Data Layer: staticTtsManifest

**파일:** `frontend/src/assets/data/staticTtsManifest.ts` [NEW]

**책임:**
- 텍스트 → 오디오 파일 URL의 단방향 매핑 상수를 export 한다.
- 런타임에 변경되지 않는 불변 상수이다.
- 키: 정확한 텍스트 문자열 (공백, 마침표 포함)

```typescript
export type StaticTtsManifest = Readonly<Record<string, string>>;

export const STATIC_TTS_MANIFEST: StaticTtsManifest = {
  '손을 들어주세요.': '/assets/audio/loc/loc_trial_1.mp3',
  '주먹을 쥐어주세요.': '/assets/audio/loc/loc_trial_2.mp3',
  '눈을 감아주세요.': '/assets/audio/loc/loc_trial_3.mp3',
} as const;
```

**분리 이유:**
- 매니페스트(데이터)와 서비스(로직)의 단일 책임 원칙 적용
- 새 음성 파일 추가 시 `staticTtsManifest.ts` 만 수정하면 되고, `StaticFileTtsService` 코드는 건드리지 않아도 된다 (개방-폐쇄 원칙)

#### Presentation Layer: LocScreen (Composition Root 수정)

**파일:** `frontend/src/assessments/loc/presentation/LocScreen.tsx` [MODIFY]

**변경 내용:**
- `WebSpeechTtsService` 인스턴스 생성 코드를 `StaticFileTtsService` 인스턴스 생성으로 교체
- `useEffect(() => { void ttsService.preloadVoice(); }, [ttsService])` 제거 (StaticFileTtsService에는 preloadVoice가 없음)
- `HtmlAudioPlayer` 와 `WebSpeechTtsService` (폴백) 인스턴스를 함께 생성하여 `StaticFileTtsService` 생성자에 전달

**변경 전:**
```typescript
import { WebSpeechTtsService } from '../../../shared/infrastructure/WebSpeechTtsService.js';

const ttsService = useMemo(() => new WebSpeechTtsService(), []);
useEffect(() => { void ttsService.preloadVoice(); }, [ttsService]);
```

**변경 후:**
```typescript
import { StaticFileTtsService } from '../../../shared/infrastructure/StaticFileTtsService.js';
import { HtmlAudioPlayer } from '../../../shared/infrastructure/HtmlAudioPlayer.js';
import { WebSpeechTtsService } from '../../../shared/infrastructure/WebSpeechTtsService.js';
import { STATIC_TTS_MANIFEST } from '../../../assets/data/staticTtsManifest.js';

const ttsService = useMemo(
  () => new StaticFileTtsService(
    STATIC_TTS_MANIFEST,
    new HtmlAudioPlayer(),
    new WebSpeechTtsService(),
  ),
  [],
);
// preloadVoice useEffect 제거
```

**주의:** `ConductLocTrialUseCase`, `useLocViewModel` 는 변경 없음.

#### Scripts Layer: generate-static-tts.mjs

**파일:** `scripts/generate-static-tts.mjs` [NEW]

**책임:**
- Azure Cognitive Services Speech SDK (`microsoft-cognitiveservices-speech-sdk`) 를 사용하여 텍스트를 MP3로 변환한다.
- 출력 디렉토리가 없으면 자동 생성한다.
- 파일이 이미 존재하면 Azure API를 호출하지 않고 건너뛴다 (멱등성).
- 각 파일 생성 후 성공/실패/건너뜀 결과를 콘솔에 출력한다.
- 환경변수 `AZURE_SPEECH_KEY` 와 `AZURE_SPEECH_REGION` 을 요구한다.

---

## 5. 파일 구조 (변경 후)

```
practiveTTS/
├── scripts/
│   └── generate-static-tts.mjs           [NEW] Azure TTS 일괄 생성 스크립트
│
└── frontend/
    ├── public/
    │   └── assets/
    │       └── audio/                     [NEW] 폴더 생성
    │           ├── loc/
    │           │   ├── loc_trial_1.mp3    [NEW] 손을 들어주세요.
    │           │   ├── loc_trial_2.mp3    [NEW] 주먹을 쥐어주세요.
    │           │   └── loc_trial_3.mp3    [NEW] 눈을 감아주세요.
    │           ├── sentComp/
    │           │   ├── sentComp_01.mp3    [NEW]
    │           │   ├── sentComp_02.mp3    [NEW]
    │           │   ├── sentComp_03.mp3    [NEW]
    │           │   ├── sentComp_04.mp3    [NEW]
    │           │   ├── sentComp_05.mp3    [NEW]
    │           │   ├── sentComp_06.mp3    [NEW]
    │           │   ├── sentComp_07.mp3    [NEW]
    │           │   ├── sentComp_08.mp3    [NEW]
    │           │   ├── sentComp_09.mp3    [NEW]
    │           │   └── sentComp_10.mp3    [NEW]
    │           └── wordComp/
    │               ├── wc_001_target.mp3  [NEW]
    │               ├── wc_002_target.mp3  [NEW]
    │               ├── ... (wc_003 ~ wc_019)
    │               └── wc_020_target.mp3  [NEW]
    │
    └── src/
        ├── assets/
        │   └── data/
        │       ├── sentCompItems.json     [변경 없음]
        │       └── staticTtsManifest.ts   [NEW] 텍스트→URL 매핑 상수
        │
        └── shared/
            ├── domain/
            │   ├── ITtsService.ts         [변경 없음]
            │   └── IAudioPlayer.ts        [변경 없음]
            └── infrastructure/
                ├── WebSpeechTtsService.ts [변경 없음, 폴백용으로 유지]
                ├── HtmlAudioPlayer.ts     [변경 없음]
                └── StaticFileTtsService.ts [NEW]

    (수정 대상)
    └── assessments/
        └── loc/
            └── presentation/
                └── LocScreen.tsx          [MODIFY] Composition Root 교체
```

---

## 6. 공개 인터페이스 명세

### 6-1. staticTtsManifest.ts

```typescript
// 파일: frontend/src/assets/data/staticTtsManifest.ts

/**
 * 텍스트 → 정적 오디오 파일 URL 매핑 타입
 *
 * key: 정확한 텍스트 문자열 (공백·마침표 포함, 대소문자 구분)
 * value: Vite public/ 기준 절대 경로 (브라우저에서 직접 fetch 가능)
 */
export type StaticTtsManifest = Readonly<Record<string, string>>;

/**
 * 사전 생성된 정적 오디오 에셋의 텍스트→URL 매핑 상수
 *
 * scripts/generate-static-tts.mjs 로 생성한 파일들에 대응한다.
 * 새 항목 추가: 이 상수에 키-값 쌍 추가 후 스크립트를 재실행한다.
 */
export const STATIC_TTS_MANIFEST: StaticTtsManifest;
```

### 6-2. StaticFileTtsService.ts

```typescript
// 파일: frontend/src/shared/infrastructure/StaticFileTtsService.ts

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';
import type { StaticTtsManifest } from '../../assets/data/staticTtsManifest.js';

/**
 * 정적 오디오 파일 기반 TTS 서비스 구현체
 *
 * speak(text) 호출 시:
 *   1. manifest에서 text → URL 조회
 *   2. URL 존재: HtmlAudioPlayer로 파일 재생 → TtsPlaybackResult 반환
 *   3. URL 없음: fallback(WebSpeechTtsService)에 위임
 *
 * cancel() 호출 시:
 *   audioPlayer.stop() + fallback.cancel() 동시 호출
 *
 * 생성자 파라미터 모두 외부 주입 (테스트 Mock 교체 가능)
 */
export class StaticFileTtsService implements ITtsService {
  constructor(
    manifest: StaticTtsManifest,
    audioPlayer: IAudioPlayer,
    fallback: ITtsService,
  );

  /**
   * 텍스트를 음성으로 재생한다.
   *
   * manifest에 매핑이 존재하면 정적 파일로 재생한다.
   * 매핑이 없으면 fallback TTS 서비스로 위임한다.
   *
   * @param text - 재생할 텍스트 (정확히 매니페스트 키와 일치해야 함)
   * @returns TtsPlaybackResult (startTime, endTime, durationMs)
   * @throws 파일 로드 실패 또는 fallback 재생 실패 시 에러
   */
  speak(text: string): Promise<TtsPlaybackResult>;

  /**
   * 현재 재생 중인 오디오를 즉시 중단한다.
   * audioPlayer.stop()과 fallback.cancel()을 모두 호출한다.
   */
  cancel(): void;
}
```

### 6-3. generate-static-tts.mjs (스크립트 공개 인터페이스)

```
실행 방법:
  node scripts/generate-static-tts.mjs [--dry-run] [--force]

환경변수 (필수):
  AZURE_SPEECH_KEY     Azure Cognitive Services Speech API 키
  AZURE_SPEECH_REGION  Azure 리전 (예: koreacentral, eastasia)

옵션:
  --dry-run  실제 API 호출 없이 생성 대상 목록만 출력
  --force    이미 파일이 존재해도 덮어쓰기 (멱등성 우선 기본값: 건너뜀)

종료 코드:
  0  전체 성공 (또는 dry-run 완료)
  1  하나 이상 파일 생성 실패

출력 형식:
  [SKIP]    loc_trial_1.mp3 - 이미 존재함
  [OK]      loc_trial_2.mp3 - 생성 완료 (1.2s)
  [FAIL]    sentComp_01.mp3 - 오류: <오류 메시지>
  완료: 33개 중 성공 33, 실패 0, 건너뜀 0
```

---

## 7. 사전 생성 스크립트 설계

### 7-1. 스크립트 구조

```javascript
// scripts/generate-static-tts.mjs

/**
 * 정적 TTS 음성 에셋 일괄 생성 스크립트
 *
 * 실행 환경: Node.js 18+ (ESM, --input-type=module 불필요)
 * 의존성:  microsoft-cognitiveservices-speech-sdk (npm install 필요)
 *
 * 설계 원칙:
 * - 멱등성: 파일이 이미 존재하면 API 호출하지 않고 건너뜀
 * - 순차 실행: Azure API Rate Limit 초과 방지 (병렬 금지)
 * - 실패 격리: 개별 파일 실패 시 나머지는 계속 진행
 * - 명시적 오류: 실패 파일 목록을 마지막에 요약 출력
 */

// 생성 대상 정의 형식
const AUDIO_ASSETS = [
  // LOC 지시문
  {
    text: '손을 들어주세요.',
    outputPath: 'frontend/public/assets/audio/loc/loc_trial_1.mp3',
    category: 'LOC',
  },
  // ... (총 33개)
];
```

### 7-2. Azure TTS SDK 사용 방식

```javascript
import sdk from 'microsoft-cognitiveservices-speech-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 텍스트를 Azure TTS로 변환하여 MP3 파일로 저장한다.
 *
 * @param {string} text - 변환할 텍스트
 * @param {string} outputPath - 절대 경로 기준 출력 파일 경로
 * @param {string} speechKey - Azure Speech API 키
 * @param {string} speechRegion - Azure 리전
 * @returns {Promise<void>}
 */
async function synthesizeToFile(text, outputPath, speechKey, speechRegion) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
  speechConfig.speechSynthesisVoiceName = 'ko-KR-SunHiNeural';
  speechConfig.speechSynthesisOutputFormat =
    sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;

  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputPath);
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve();
        } else {
          reject(new Error(
            `합성 실패 [${result.reason}]: ${result.errorDetails ?? '알 수 없는 오류'}`
          ));
        }
      },
      (error) => {
        synthesizer.close();
        reject(new Error(`SDK 오류: ${error}`));
      },
    );
  });
}
```

### 7-3. 멱등성 처리

```javascript
/**
 * 단일 에셋 처리 (멱등성 포함)
 */
async function processAsset(asset, options) {
  const { outputPath, text, category } = asset;
  const absolutePath = path.resolve(projectRoot, outputPath);

  // 파일 존재 여부 확인
  const exists = await fs.access(absolutePath)
    .then(() => true)
    .catch(() => false);

  if (exists && !options.force) {
    return { status: 'SKIP', path: outputPath };
  }

  if (options.dryRun) {
    return { status: 'DRY_RUN', path: outputPath, text, category };
  }

  // 출력 디렉토리 생성 (없으면)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  // Azure TTS 호출
  await synthesizeToFile(text, absolutePath, speechKey, speechRegion);

  return { status: 'OK', path: outputPath };
}
```

### 7-4. 에러 처리 전략

| 상황 | 처리 방법 |
|------|----------|
| `AZURE_SPEECH_KEY` 미설정 | 즉시 종료 (exit code 1), 안내 메시지 출력 |
| 개별 파일 합성 실패 | 실패 기록 후 다음 파일 계속 진행 |
| 출력 디렉토리 생성 실패 | 해당 파일 실패로 기록 |
| 전체 완료 후 실패 있음 | 실패 목록 요약 출력, exit code 1 반환 |
| `--dry-run` | API 호출 없이 대상 목록만 출력, exit code 0 |

### 7-5. 실행 방법

```bash
# 1. SDK 설치 (스크립트 디렉토리 또는 프로젝트 루트에서)
npm install microsoft-cognitiveservices-speech-sdk

# 2. 환경변수 설정
export AZURE_SPEECH_KEY="your-key-here"
export AZURE_SPEECH_REGION="koreacentral"

# 3. 대상 목록 확인 (dry-run)
node scripts/generate-static-tts.mjs --dry-run

# 4. 실제 생성
node scripts/generate-static-tts.mjs

# 5. 강제 재생성 (이미 있는 파일 덮어쓰기)
node scripts/generate-static-tts.mjs --force
```

---

## 8. StaticFileTtsService 상세 구현 명세

### 8-1. speak() 내부 흐름

```
speak(text)
  │
  ├─ manifest[text] 조회
  │   │
  │   ├─ URL 있음
  │   │   ├── startTime = performance.now()
  │   │   ├── audioPlayer.load(url)  → 실패 시 reject
  │   │   ├── endTime_raw = await audioPlayer.play()  → 실패 시 reject
  │   │   └── resolve({ startTime, endTime: endTime_raw, durationMs: endTime_raw - startTime })
  │   │
  │   └─ URL 없음 (폴백)
  │       └── return fallback.speak(text)  ← ITtsService 계약 그대로 위임
  │
  └─ (에러 발생 시 그대로 상위로 전파)
```

### 8-2. TtsPlaybackResult 구성 방법

`HtmlAudioPlayer.play()` 는 `ended` 이벤트에서 `performance.now()` 를 반환한다.
`StaticFileTtsService` 는 `play()` 호출 직전에 `startTime = performance.now()` 를 기록하고,
`play()` 의 반환값을 `endTime` 으로 사용한다.

```typescript
const startTime = performance.now();
await this.audioPlayer.load(url);
const endTime = await this.audioPlayer.play();
return Object.freeze<TtsPlaybackResult>({
  startTime,
  endTime,
  durationMs: endTime - startTime,
});
```

**주의:** `load()` 시간은 `startTime` 측정 전에 포함되지 않는다. `startTime` 은 재생 시작 직전 시각이다. 이는 `ConductLocTrialUseCase.playInstruction()` 이 `endTime` 만 사용하는 현재 구조와 호환된다.

### 8-3. cancel() 구현

```typescript
cancel(): void {
  this.audioPlayer.stop();
  this.fallback.cancel();
}
```

현재 어떤 경로(정적 파일 or 폴백)로 재생 중인지와 무관하게 두 곳을 모두 정지한다. 이는 안전하다 — `HtmlAudioPlayer.stop()` 은 audio가 null 이어도 `_isPlaying` 만 false로 처리하고, `WebSpeechTtsService.cancel()` 도 `speaking` 상태가 아니면 no-op이다.

---

## 9. 에러 처리 전략

### 9-1. 레이어별 에러 타입

```
Infrastructure Layer (StaticFileTtsService):
  - 오디오 파일 로드 실패 (HtmlAudioPlayer가 throw한 Error 그대로 전파)
  - 폴백 TTS 실패 (WebSpeechTtsService가 reject한 Error 그대로 전파)

Application Layer (ConductLocTrialUseCase):
  - 기존 처리 그대로:
    TtsPlaybackFailed → LocAssessmentError(TTS_PLAYBACK_FAILED)

Presentation Layer (useLocViewModel):
  - 기존 처리 그대로:
    LocAssessmentError → errorMessage 상태로 UI에 표시
```

### 9-2. 정적 파일 로드 실패 시 동작

1. `HtmlAudioPlayer.load(url)` 이 reject → `StaticFileTtsService.speak()` 이 reject
2. `ConductLocTrialUseCase.playInstruction()` 이 `LocAssessmentError(TTS_PLAYBACK_FAILED)` 로 래핑
3. `useLocViewModel` 이 errorMessage 상태에 "음성 안내 재생에 실패했습니다." 를 설정
4. UI: 에러 배너 표시

**개선 고려 사항 (현재 계획에서 제외):** 정적 파일 로드 실패 시 자동으로 폴백(WebSpeechTtsService)을 사용하는 이중 폴백 전략. 현재는 명시적으로 실패시키고 UI에 알리는 것이 더 안전하다고 판단.

---

## 10. 테스트 전략

### 10-1. 단위 테스트: StaticFileTtsService

**파일:** `frontend/src/shared/infrastructure/StaticFileTtsService.test.ts` [NEW]

#### Given-When-Then 케이스

**케이스 1: 매니페스트에 있는 텍스트 재생 성공**
```
Given: manifest = { '손을 들어주세요.': '/assets/audio/loc/loc_trial_1.mp3' }
      audioPlayer.load() → 즉시 resolve
      audioPlayer.play() → endTime(1500)으로 resolve
When:  service.speak('손을 들어주세요.') 호출
Then:  - audioPlayer.load('/assets/audio/loc/loc_trial_1.mp3') 가 호출됨
       - audioPlayer.play() 가 호출됨
       - fallback.speak() 는 호출되지 않음
       - 반환값 { startTime: number, endTime: 1500, durationMs: number } 형태
       - startTime <= endTime
```

**케이스 2: 매니페스트에 없는 텍스트 → 폴백 위임**
```
Given: manifest = {} (빈 객체)
      fallback.speak('알 수 없는 텍스트') → { startTime: 100, endTime: 1200, durationMs: 1100 } resolve
When:  service.speak('알 수 없는 텍스트') 호출
Then:  - audioPlayer.load() 는 호출되지 않음
       - fallback.speak('알 수 없는 텍스트') 가 호출됨
       - 반환값은 fallback의 결과 그대로
```

**케이스 3: 오디오 파일 로드 실패 → 에러 전파**
```
Given: manifest = { '손을 들어주세요.': '/assets/audio/loc/loc_trial_1.mp3' }
      audioPlayer.load() → new Error('오디오 파일 로드 실패') reject
When:  service.speak('손을 들어주세요.') 호출
Then:  - Promise가 reject됨
       - reject 사유: '오디오 파일 로드 실패' 포함
       - audioPlayer.play() 는 호출되지 않음
```

**케이스 4: cancel() - 정적 파일 재생 중**
```
Given: audioPlayer가 재생 중 (isPlaying = true)
When:  service.cancel() 호출
Then:  - audioPlayer.stop() 이 호출됨
       - fallback.cancel() 이 호출됨
```

**케이스 5: cancel() - 폴백 재생 중 (매핑 없는 텍스트)**
```
Given: fallback이 speak() 중
When:  service.cancel() 호출
Then:  - audioPlayer.stop() 이 호출됨 (no-op이더라도)
       - fallback.cancel() 이 호출됨
```

### 10-2. 단위 테스트: staticTtsManifest (정합성 검증)

**파일:** `frontend/src/assets/data/staticTtsManifest.test.ts` [NEW]

```
Given: STATIC_TTS_MANIFEST 상수
When:  LOC trialNumber 1|2|3 의 텍스트를 키로 조회
Then:  각각 '/assets/audio/loc/loc_trial_{N}.mp3' 형태의 URL이 반환됨

When:  모든 값(URL)을 순회
Then:  모든 URL이 '/assets/audio/' 로 시작하고 '.mp3' 로 끝남
```

### 10-3. 통합 테스트 (수동 검증 절차)

실제 파일 재생은 브라우저 환경이 필요하므로 수동 검증으로 대체한다.

**검증 절차:**
1. `node scripts/generate-static-tts.mjs --dry-run` → 33개 항목이 정확히 출력되는지 확인
2. `node scripts/generate-static-tts.mjs` → 33개 파일 생성 확인
3. `npm run dev` → LOC 검사 실행 → 지시문 3개 음성이 Azure TTS 품질로 재생되는지 확인
4. LOC: audioEndTime이 정상적으로 기록되고 latency 계산이 동작하는지 확인
5. SentComp: 문장 오디오가 정상 재생되는지 확인
6. WordComp: 단어 오디오가 정상 재생되는지 확인

### 10-4. 테스트 더블 전략

| 대상 | 전략 | 이유 |
|------|------|------|
| `IAudioPlayer` (StaticFileTtsService 테스트) | **Mock** | 실제 오디오 하드웨어 없이 load/play/stop 호출 여부 검증 |
| `ITtsService` fallback (StaticFileTtsService 테스트) | **Mock** | 폴백 위임 검증, 반환값 제어 |
| Azure TTS API (스크립트 테스트) | **Mock** (SDK mocking) | 실제 API 비용 발생 방지 |

---

## 11. 위험 요소 및 주의사항

### 11-1. 위험 요소 분석

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| Azure Speech Key 미관리 (secrets 노출) | 낮음 | 높음 | `.env` 파일로 관리, `.gitignore` 에 추가. CI/CD에서는 환경변수로 주입 |
| MP3 파일을 git에 커밋 (repo 비대화) | 높음 | 보통 | `frontend/public/assets/audio/` 를 `.gitignore` 에 추가. 빌드 파이프라인에서 스크립트 실행 |
| 텍스트 키 불일치 (공백/마침표 오타) | 보통 | 높음 | `staticTtsManifest.test.ts` 에서 키 패턴 검증. 스크립트의 AUDIO_ASSETS 와 manifest를 동일 출처로 관리 |
| HtmlAudioPlayer 동시 재생 (load 중 cancel) | 낮음 | 보통 | `HtmlAudioPlayer.load()` 가 `cleanupAudio()` 를 먼저 호출하는 기존 구조로 안전하게 처리됨 |
| 브라우저 오디오 정책 (autoplay 차단) | 보통 | 높음 | 기존 SentComp/WordComp와 동일 패턴. 사용자 인터랙션(검사 시작 버튼) 후 재생하므로 안전 |
| Azure API Rate Limit 초과 (스크립트 병렬 실행) | 낮음 | 보통 | 스크립트를 순차 실행으로 설계. 개당 약 1~2초 간격 |

### 11-2. 핵심 주의사항

**MP3 파일 Git 관리 정책:**

`frontend/public/assets/audio/` 디렉토리는 빌드 타임 산출물로 취급한다. 두 가지 전략 중 선택 필요:

- **전략 A (권장):** `.gitignore` 에 추가 → CI/CD 파이프라인에서 스크립트 자동 실행
  - 장점: 저장소 용량 관리, API Key 노출 위험 없음
  - 단점: CI/CD 파이프라인에 Azure Key 환경변수 설정 필요

- **전략 B (단순):** git에 포함 → 한 번 생성 후 커밋
  - 장점: CI/CD 불필요, 오프라인 개발 가능
  - 단점: 파일 변경 시 재생성/재커밋 필요, 저장소 약 5-10MB 증가

**현재 권장: 전략 B (파일 커밋)**. 프로젝트 규모상 CI/CD 파이프라인 구축 전이므로, 생성 후 커밋하는 방식이 실용적이다. 나중에 CI/CD 구성 시 전략 A로 전환한다.

**startTime 측정 정확도:**

`StaticFileTtsService.speak()` 에서 `startTime` 은 `audioPlayer.load()` 완료 후, `audioPlayer.play()` 호출 직전에 기록한다. 따라서 load 시간은 측정 범위에 포함되지 않는다. 최초 호출 시 네트워크 지연이 있을 수 있으나, HTTP 캐시(브라우저)가 이후 호출을 처리한다.

---

## 12. SOLID 원칙 준수 점검

| 원칙 | 준수 여부 | 근거 |
|------|:--------:|------|
| **S** (단일 책임) | 준수 | `StaticFileTtsService`: 매핑 조회 + 재생 조율만. `staticTtsManifest.ts`: 데이터 정의만. `generate-static-tts.mjs`: 파일 생성만 |
| **O** (개방-폐쇄) | 준수 | 새 음성 파일 추가 시 `staticTtsManifest.ts` 에 키-값 추가만. `StaticFileTtsService` 코드 수정 불필요 |
| **L** (리스코프 치환) | 준수 | `StaticFileTtsService` 는 `ITtsService` 계약을 완전히 이행. `ConductLocTrialUseCase` 에서 `WebSpeechTtsService` 와 완전히 교체 가능 |
| **I** (인터페이스 분리) | 준수 | `ITtsService` (speak, cancel 2개), `IAudioPlayer` (load, play, stop, isPlaying, isLoaded)로 적절히 분리됨 |
| **D** (의존성 역전) | 준수 | `StaticFileTtsService` 는 `IAudioPlayer` 인터페이스에 의존. `HtmlAudioPlayer` 구체 클래스를 직접 참조하지 않음 |

---

## 13. 확장성 시나리오 평가

| 시나리오 | 현재 설계의 대응 | 필요 작업 |
|---------|---------------|---------|
| LOC 지시문 텍스트 변경 | `staticTtsManifest.ts` 키 수정 + 스크립트 재실행 | 낮은 비용 |
| 새 검사 지시문 추가 | `AUDIO_ASSETS` 배열에 항목 추가 + `manifest` 에 키-값 추가 | 낮은 비용 |
| TTS 엔진 교체 (Azure → ElevenLabs) | 스크립트 내부 `synthesizeToFile` 함수만 교체. 프론트엔드 코드 무변경 | 중간 비용 |
| CDN으로 파일 이전 | `STATIC_TTS_MANIFEST` URL 값을 CDN URL로 변경. 그 외 무변경 | 낮은 비용 |
| 폴백 제거 (완전 정적화) | `StaticFileTtsService` 생성자에서 `fallback` 파라미터 제거. 매핑 없으면 에러로 처리 | 낮은 비용 |
| 동적 TTS 추가 (§2.2) | 별도 `DynamicTtsService` 구현. Composition Root에서 조합 | 현재 설계 영향 없음 |

---

## 14. 구현 체크리스트

### Phase 0: 사전 생성 스크립트

- [ ] [보통] `scripts/` 폴더 생성
- [ ] [어려움] `scripts/generate-static-tts.mjs` 구현
  - [ ] Azure Speech SDK 연동 (`synthesizeToFile` 함수)
  - [ ] `AUDIO_ASSETS` 배열 정의 (LOC 3 + SentComp 10 + WordComp 20)
  - [ ] 멱등성 처리 (파일 존재 시 건너뜀)
  - [ ] `--dry-run`, `--force` CLI 옵션 파싱
  - [ ] 출력 디렉토리 자동 생성 (`mkdir -p` 방식)
  - [ ] 순차 실행 (Rate Limit 방지)
  - [ ] 성공/실패/건너뜀 카운트 요약 출력
  - [ ] 환경변수 미설정 시 즉시 종료 처리
- [ ] [보통] `npm install microsoft-cognitiveservices-speech-sdk` (scripts 폴더 또는 루트)
- [ ] [보통] `.env.example` 파일에 `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` 항목 추가
- [ ] [쉬움] `node scripts/generate-static-tts.mjs --dry-run` 으로 33개 항목 확인
- [ ] [어려움] 실제 Azure Key로 스크립트 실행 → 33개 MP3 파일 생성 확인

### Phase 1: 프론트엔드 Infrastructure

- [ ] [쉬움] `frontend/src/assets/data/staticTtsManifest.ts` 생성
  - [ ] `StaticTtsManifest` 타입 정의
  - [ ] `STATIC_TTS_MANIFEST` 상수 정의 (LOC 3개 텍스트→URL 매핑)
- [ ] [보통] `frontend/src/shared/infrastructure/StaticFileTtsService.ts` 구현
  - [ ] 생성자: `manifest`, `audioPlayer`, `fallback` 주입 방식
  - [ ] `speak()`: 매핑 조회 → 정적 재생 or 폴백 위임
  - [ ] `cancel()`: audioPlayer.stop() + fallback.cancel() 동시 호출
  - [ ] `TtsPlaybackResult` 정확한 구성 (startTime, endTime, durationMs)
  - [ ] `erasableSyntaxOnly` 제약 준수 (enum 미사용)
  - [ ] `verbatimModuleSyntax` 준수 (`import type` 명시)
  - [ ] 로컬 import에 `.js` 확장자 명시

### Phase 2: Composition Root 교체

- [ ] [쉬움] `frontend/src/assessments/loc/presentation/LocScreen.tsx` 수정
  - [ ] `WebSpeechTtsService` import → `StaticFileTtsService` import 교체
  - [ ] `HtmlAudioPlayer`, `STATIC_TTS_MANIFEST` import 추가
  - [ ] `useMemo` 내부: `StaticFileTtsService` 인스턴스 생성으로 교체
  - [ ] `preloadVoice()` 관련 `useEffect` 제거
  - [ ] 미사용 import 제거 (`noUnusedLocals` 오류 방지)

### Phase 3: 테스트

- [ ] [보통] `frontend/src/assets/data/staticTtsManifest.test.ts` 작성
  - [ ] LOC 텍스트 3개 조회 정합성 검증
  - [ ] URL 패턴 형식 검증 (`/assets/audio/` 시작, `.mp3` 종료)
- [ ] [보통] `frontend/src/shared/infrastructure/StaticFileTtsService.test.ts` 작성
  - [ ] 케이스 1: manifest hit → 정적 파일 재생
  - [ ] 케이스 2: manifest miss → fallback 위임
  - [ ] 케이스 3: 파일 로드 실패 → 에러 전파
  - [ ] 케이스 4~5: cancel() 동작 검증
  - [ ] Mock: `IAudioPlayer`, `ITtsService` (fallback)

### Phase 4: 통합 확인

- [ ] [보통] `npm run build` (TypeScript 오류 없음 확인)
- [ ] [보통] `npm test` (기존 LOC 테스트 포함 전체 통과 확인)
- [ ] [보통] 브라우저 수동 확인: LOC 지시문 3개 Azure TTS 품질로 재생
- [ ] [보통] 브라우저 수동 확인: SentComp 문장 오디오 재생
- [ ] [보통] 브라우저 수동 확인: WordComp 단어 오디오 재생
- [ ] [쉬움] `.gitignore` 정책 결정 및 적용 (audio 파일 포함 or 제외)

---

## 15. User Review Required (미결 결정 사항)

### 결정 1: MP3 파일 Git 커밋 여부

**질문:** `frontend/public/assets/audio/` 의 MP3 파일 33개를 git에 포함할 것인가?

- **전략 A (파일 커밋):** 생성 후 git add. 저장소 약 5-10MB 증가. 가장 단순.
- **전략 B (gitignore):** `.gitignore` 추가. CI/CD 파이프라인에서 스크립트 자동 실행 필요.

**권장:** 현재 단계에서는 전략 A(파일 커밋). 추후 CI/CD 구성 시 전략 B로 전환.

---

### 결정 2: `microsoft-cognitiveservices-speech-sdk` 설치 위치

**질문:** 스크립트 실행용 SDK를 어디에 설치할 것인가?

- **옵션 A:** 프로젝트 루트에 `package.json` + `node_modules` 생성
- **옵션 B:** `scripts/` 폴더에 별도 `package.json` 생성
- **옵션 C:** `backend/` 에서 실행 (NestJS 환경 활용)

**권장:** 옵션 A (프로젝트 루트 `package.json`). 가장 단순하며 스크립트 실행 경로가 명확하다.

---

### 결정 3: 정적 파일 재생 실패 시 자동 폴백 여부

**질문:** `StaticFileTtsService.speak()` 에서 파일 로드 실패 시, `WebSpeechTtsService` 로 자동 재시도할 것인가?

- **옵션 A (현재 설계):** 에러 전파 → UI에 오류 메시지 표시
- **옵션 B:** 파일 로드 실패 시 자동으로 폴백 TTS 재생

**권장:** 옵션 A. 배포 환경에서 파일이 반드시 존재해야 하므로, 실패 시 명시적으로 알리는 것이 디버깅에 유리하다.
