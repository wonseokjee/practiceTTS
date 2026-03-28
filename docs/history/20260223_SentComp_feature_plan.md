# 문장 이해 (Sentence Comprehension) 검사 - Feature Implementation Plan

> 작성일: 2026-02-23
> 참조: `docs/history/implementation_plan.md`, `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

---

## 1. 기존 설계 컨텍스트 요약

- **플랫폼:** 웹 앱 (React + TypeScript)
- **타이밍 측정:** `performance.now()` 전략 (검사 1, 3에서 동일 채택)
- **오디오:** 브라우저 기반 (`HTMLAudioElement`)
- **검사 3 재사용:** `useAudioPlayer`, `useTimer`, `HtmlAudioPlayer` 공유 가능
- **파일 경로:** `src/assessments/sentComp/` 하위

---

## 2. 도메인 모델

### 2-1. 핵심 타입 및 엔티티

```typescript
// src/assessments/sentComp/domain/types.ts

export type SentenceType =
  | 'active-passive'
  | 'relative-clause'
  | 'embedded-clause';

/** 값 객체: 선택지 이미지 (불변) */
export interface ChoiceImage {
  readonly imageUrl: string;
  readonly altText: string;    // 스크린리더용 (접근성)
  readonly isCorrect: boolean; // choices 배열에서 정확히 1개만 true
}

/** 엔티티: 자극 문항 */
export interface SentenceComprehensionItem {
  readonly itemId: string;
  readonly sentence: string;
  readonly sentenceAudioUrl: string;
  readonly sentenceType: SentenceType;
  readonly choices: readonly [ChoiceImage, ChoiceImage]; // 정확히 2개 (tuple)
  readonly orderIndex: number;
}

/** 엔티티: 단일 문항 응답 결과 */
export interface SentenceComprehensionResult {
  readonly itemId: string;
  readonly selectedImageIndex: 0 | 1;
  readonly isCorrect: boolean;
  readonly reactionTimeMs: number;
  readonly replayCount: number;
  readonly audioEndTimestamp: number;
  readonly selectionTimestamp: number;
}

/** 값 객체: 구문 유형별 통계 */
export interface SentenceTypeStats {
  readonly total: number;
  readonly correct: number;
  readonly rate: number | null;  // total === 0이면 null
}

/** 값 객체: 최종 채점 결과 */
export interface SentenceComprehensionScore {
  readonly totalItems: number;
  readonly correctCount: number;
  readonly totalScore: number;   // 0~100 (%)
  readonly byType: Record<SentenceType, SentenceTypeStats>;
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}
```

**불변 조건:**
| 객체 | 불변 조건 |
|------|----------|
| `SentenceComprehensionItem` | `choices[0].isCorrect XOR choices[1].isCorrect` (정확히 1개만 true) |
| `SentenceComprehensionResult` | `reactionTimeMs >= 0`, `selectionTimestamp >= audioEndTimestamp` |
| `SentenceComprehensionScore` | `totalScore = round(correctCount / totalItems × 100)` |

### 2-2. 유스케이스 명세

#### UC-1: SubmitSentenceComprehensionAnswer
```
Actor:       환자 (이미지 선택)
사전 조건:   음성이 최소 1회 완료되어 audioEndTimestamp > 0
정상 흐름:
  1. selectionTimestamp = performance.now()
  2. reactionTimeMs = max(0, selectionTimestamp - audioEndTimestamp)
  3. isCorrect = choices[selectedIndex].isCorrect
  4. SentenceComprehensionResult 생성 → Repository.saveResult()
  5. 마지막 문항이면 CalculateScore 호출
예외:        SentCompError(AUDIO_NOT_PLAYED), SentCompError(ITEM_NOT_FOUND)
```

#### UC-2: ReplaySentenceAudio
```
Actor:       환자 ("다시 듣기" 버튼)
정상 흐름:   replayCount++ → 처음부터 재생 → audioEndTimestamp 최신값으로 갱신
예외:        SentCompError(AUDIO_LOAD_FAILED)
```

#### UC-3: CalculateSentenceComprehensionScore
```
Actor:       시스템 (마지막 문항 제출 후 자동)
정상 흐름:   전체/구문유형별 정답률 + 평균 반응시간/재청취횟수 집계 → Score 저장
```

### 2-3. 레포지토리 인터페이스

```typescript
// src/assessments/sentComp/domain/ISentenceComprehensionRepository.ts
export interface ISentenceComprehensionRepository {
  saveResult(result: SentenceComprehensionResult): Promise<void>;
  getResultsBySession(sessionId: string): Promise<SentenceComprehensionResult[]>;
  saveScore(sessionId: string, score: SentenceComprehensionScore): Promise<void>;
  getScore(sessionId: string): Promise<SentenceComprehensionScore | null>;
}

// src/assessments/sentComp/domain/ISentenceComprehensionItemRepository.ts
export interface ISentenceComprehensionItemRepository {
  loadItems(): Promise<SentenceComprehensionItem[]>;
  findById(itemId: string): Promise<SentenceComprehensionItem | null>;
}

// src/shared/domain/IAudioPlayer.ts (검사 3, 4 공유)
export interface IAudioPlayer {
  load(url: string): Promise<void>;
  /** 재생 완료 시 performance.now() 기준 종료 timestamp를 resolve */
  play(): Promise<number>;
  stop(): void;
  readonly isPlaying: boolean;
  readonly isLoaded: boolean;
}
```

---

## 3. 클린 아키텍처 레이어 설계

```
SentCompScreen
  └── useSentCompViewModel (hook)
        ├── sentCompSessionReducer (FSM)
        ├── SubmitAnswerUseCase
        │     ├── ISentenceComprehensionRepository ←← LocalStorageSentCompRepository
        │     └── ISentenceComprehensionItemRepository ←← JsonSentCompItemRepository
        ├── CalculateScoreUseCase
        │     └── SentenceComprehensionScorer (순수 함수)
        └── useAudioPlayer (공유 훅)
              └── IAudioPlayer ←← HtmlAudioPlayer

의존성 방향: 항상 안쪽(Domain)을 향함
```

---

## 4. 파일 구조 (전체 신규)

```
src/
├── assessments/
│   └── sentComp/
│       ├── domain/
│       │   ├── types.ts                                [NEW] 핵심 타입
│       │   ├── ISentenceComprehensionRepository.ts     [NEW]
│       │   └── ISentenceComprehensionItemRepository.ts [NEW]
│       ├── application/
│       │   ├── useCases/
│       │   │   ├── SubmitAnswerUseCase.ts              [NEW]
│       │   │   ├── ReplayAudioUseCase.ts               [NEW]
│       │   │   └── CalculateScoreUseCase.ts            [NEW]
│       │   ├── SentenceComprehensionScorer.ts          [NEW] 순수 채점 함수
│       │   ├── dtos.ts                                 [NEW]
│       │   └── errors.ts                               [NEW]
│       ├── infrastructure/
│       │   ├── LocalStorageSentCompRepository.ts       [NEW]
│       │   └── JsonSentCompItemRepository.ts           [NEW]
│       └── presentation/
│           ├── SentCompScreen.tsx                      [NEW]
│           ├── sentCompSessionReducer.ts               [NEW] FSM reducer
│           ├── useSentCompViewModel.ts                 [NEW]
│           └── components/
│               ├── SentenceAudioPlayer.tsx             [NEW]
│               ├── ImageChoiceGrid.tsx                 [NEW] 세로 2장 레이아웃
│               ├── ChoiceImageCard.tsx                 [NEW]
│               └── ScoreResultPanel.tsx                [NEW]
├── shared/
│   ├── domain/
│   │   └── IAudioPlayer.ts                            [NEW] 검사 3/4 공유
│   ├── infrastructure/
│   │   └── HtmlAudioPlayer.ts                         [NEW] 검사 3/4 공유
│   ├── hooks/
│   │   ├── useAudioPlayer.ts                          [NEW] 검사 3/4 공유
│   │   └── useTimer.ts                                [NEW] 검사 3/4 공유
│   └── components/
│       ├── AssessmentProgressBar.tsx                  [NEW]
│       └── LoadingOverlay.tsx                         [NEW]
└── assets/
    ├── data/
    │   └── sentCompItems.json                         [NEW] 10문항
    ├── audio/sentComp/                                [NEW] sentComp_01~10.mp3
    └── images/sentComp/                               [NEW] correct/distractor (×10)
```

---

## 5. 핵심 인터페이스 명세

### 애플리케이션 레이어 DTO

```typescript
// src/assessments/sentComp/application/dtos.ts

export interface SubmitAnswerRequestDTO {
  readonly itemId: string;
  readonly selectedImageIndex: 0 | 1;
  readonly audioEndTimestamp: number;
  readonly selectionTimestamp: number;
  readonly replayCount: number;
}

export interface SubmitAnswerResponseDTO {
  readonly isCorrect: boolean;
  readonly reactionTimeMs: number;
  readonly isLastItem: boolean;
}

export interface ScoreDTO {
  readonly totalScore: number;
  readonly correctCount: number;
  readonly totalItems: number;
  readonly byType: Record<string, {
    total: number;
    correct: number;
    rate: number | null;
  }>;
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}
```

### 에러 타입

```typescript
// src/assessments/sentComp/application/errors.ts

export const SentCompErrorCode = {
  ITEM_NOT_FOUND:       'SENT_COMP_ITEM_NOT_FOUND',
  AUDIO_NOT_PLAYED:     'SENT_COMP_AUDIO_NOT_PLAYED',
  AUDIO_LOAD_FAILED:    'SENT_COMP_AUDIO_LOAD_FAILED',
  ITEMS_LOAD_FAILED:    'SENT_COMP_ITEMS_LOAD_FAILED',
  SAVE_FAILED:          'SENT_COMP_SAVE_FAILED',
  DUPLICATE_SUBMISSION: 'SENT_COMP_DUPLICATE_SUBMISSION',
} as const;

export class SentCompError extends Error {
  constructor(
    public readonly code: SentCompErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SentCompError';
  }
}
```

### 채점 순수 함수

```typescript
// src/assessments/sentComp/application/SentenceComprehensionScorer.ts

export function isAnswerCorrect(
  item: SentenceComprehensionItem,
  selectedIndex: 0 | 1,
): boolean

export function calculateReactionTime(
  audioEndTimestamp: number,
  selectionTimestamp: number,
): number   // 음수 방지 보정 포함 (min 0)

export function calculateScore(
  items: SentenceComprehensionItem[],
  results: SentenceComprehensionResult[],
): SentenceComprehensionScore
```

### FSM 상태 타입

```typescript
// src/assessments/sentComp/presentation/sentCompSessionReducer.ts

type SessionPhase =
  | { type: 'LOADING' }
  | { type: 'PLAYING' }
  | { type: 'AWAITING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'SUBMITTING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'FEEDBACK'; isCorrect: boolean; isLastItem: boolean }
  | { type: 'TRANSITIONING' }
  | { type: 'COMPLETED' }
  | { type: 'ERROR'; message: string };
```

### 공유 훅 (검사 3/4)

```typescript
// src/shared/hooks/useAudioPlayer.ts
interface UseAudioPlayerOptions {
  onPlayEnd?: (endTimestamp: number) => void;
  onLoadError?: (error: Error) => void;
}

interface UseAudioPlayerReturn {
  isLoading: boolean;
  isPlaying: boolean;
  loadAudio: (url: string) => Promise<void>;
  playAudio: () => Promise<void>;
  stopAudio: () => void;
}

export function useAudioPlayer(options?: UseAudioPlayerOptions): UseAudioPlayerReturn;
```

---

## 6. FSM 전이 규칙

```
LOADING      --[ITEMS_LOADED]-→  PLAYING
LOADING      --[ERROR]-→         ERROR
PLAYING      --[AUDIO_ENDED]-→   AWAITING (audioEndTimestamp 기록)
AWAITING     --[REPLAY]-→        PLAYING (replayCount++)
AWAITING     --[IMAGE_SELECTED]-→ SUBMITTING
SUBMITTING   --[ANSWER_SUBMITTED]-→ FEEDBACK
SUBMITTING   --[ERROR]-→         ERROR
FEEDBACK     --[FEEDBACK_DONE]-→ TRANSITIONING | COMPLETED
TRANSITIONING--[DONE]-→          LOADING (다음 문항)
ERROR        --[RETRY]-→         LOADING
```

---

## 7. 컴포넌트 책임 매트릭스

| 컴포넌트 | 역할 | 금지 사항 |
|---------|------|---------|
| `SentCompScreen` | FSM 상태 보유, 로딩/에러 분기 | 비즈니스 로직 직접 포함 |
| `SentenceAudioPlayer` | 문장 텍스트 표시, 재생 상태 시각화, 다시듣기 버튼 | 오디오 객체 직접 관리 |
| `ImageChoiceGrid` | 2장 이미지 세로 배치, 선택 상태 전달 | 정답 여부 시각 표시 (FEEDBACK 단계 전) |
| `ChoiceImageCard` | 단일 이미지 카드 렌더링 | - |
| `ScoreResultPanel` | 총점 + 구문 유형별 정답률 표시 | - |

---

## 8. 오디오 재생 종료 시점 정밀 캡처

```typescript
// HtmlAudioPlayer.ts - 핵심 구현
async play(): Promise<number> {
  this.audio!.currentTime = 0;
  this._isPlaying = true;

  return new Promise((resolve, reject) => {
    const onEnded = () => {
      this._isPlaying = false;
      // ended 이벤트 핸들러 내에서 즉시 캡처 → 최소 지연
      const endTimestamp = performance.now();
      resolve(endTimestamp);
    };
    this.audio!.addEventListener('ended', onEnded, { once: true });
    this.audio!.addEventListener('error', () => {
      this._isPlaying = false;
      reject(new Error('오디오 재생 오류'));
    }, { once: true });
    this.audio!.play().catch(reject);
  });
}
```

**재청취 시 타임스탬프 갱신:** `onPlayEnd` 콜백 호출마다 `audioEndTimestamp`를 최신값으로 덮어씀. 최종 반응 시간은 **마지막 재생의 종료 시점**부터 측정.

---

## 9. 문항 데이터 구조 (sentCompItems.json)

```json
[
  {
    "itemId": "sentComp_01",
    "sentence": "개가 고양이를 쫓고 있어요",
    "sentenceAudioUrl": "/assets/audio/sentComp/sentComp_01.mp3",
    "sentenceType": "active-passive",
    "choices": [
      { "imageUrl": "/assets/images/sentComp/sentComp_01_correct.webp", "altText": "개가 고양이를 쫓는 장면", "isCorrect": true },
      { "imageUrl": "/assets/images/sentComp/sentComp_01_distractor.webp", "altText": "고양이가 개를 쫓는 장면", "isCorrect": false }
    ],
    "orderIndex": 0
  }
]
```

**10문항 구문 유형 배분 권장안:**
| 유형 | 문항 수 | 예시 |
|------|---------|------|
| active-passive | 4문항 | "A가 B를 쫓는다" vs "A가 B에게 쫓긴다" |
| relative-clause | 4문항 | "선생님이 안은 아이" vs "선생님을 안은 아이" |
| embedded-clause | 2문항 | "엄마가 아이가 자는 것을 본다" vs "아이가 엄마가 자는 것을 본다" |

---

## 10. 에러 처리 전략

| 에러 코드 | 사용자 메시지 |
|---------|------------|
| ITEM_NOT_FOUND | 문항을 불러오지 못했습니다. 다시 시도해주세요. |
| AUDIO_NOT_PLAYED | 음성을 먼저 들어주세요. |
| AUDIO_LOAD_FAILED | 음성 파일을 불러오지 못했습니다. 네트워크를 확인해주세요. |
| ITEMS_LOAD_FAILED | 검사 문항을 불러오지 못했습니다. |
| SAVE_FAILED | 결과 저장에 실패했습니다. 잠시 후 다시 시도해주세요. |
| DUPLICATE_SUBMISSION | 이미 응답한 문항입니다. |

---

## 11. 테스트 전략

### 단위 테스트 (Given-When-Then)

```
TC-01 정답 판별 - 정답 선택
  Given: choices[0].isCorrect=true
  When:  isAnswerCorrect(item, 0)
  Then:  true

TC-02 정답 판별 - 오답 선택
  Given: choices[0].isCorrect=true
  When:  isAnswerCorrect(item, 1)
  Then:  false

TC-03 반응 시간 - 정상
  Given: audioEnd=1000, selection=2500
  When:  calculateReactionTime(1000, 2500)
  Then:  1500

TC-04 반응 시간 - 음수 방지
  Given: audioEnd=1100, selection=1000
  When:  calculateReactionTime(1100, 1000)
  Then:  0

TC-05 전체 채점 - 전문항 정답
  Given: 10문항, 모두 isCorrect=true
  Then:  { totalScore: 100, correctCount: 10 }

TC-06 구문 유형별 집계
  Given: active-passive 4문항(3정답), relative-clause 4문항(2정답), embedded-clause 2문항(1정답)
  Then:  byType['active-passive'].rate=0.75, byType['relative-clause'].rate=0.50, totalScore=60

TC-07 해당 유형 문항 없음
  Given: embedded-clause 0문항
  Then:  byType['embedded-clause'].rate = null

TC-08 UseCase - 오디오 미재생 제출
  Given: dto.audioEndTimestamp = 0
  Then:  throw SentCompError(AUDIO_NOT_PLAYED)

TC-09 UseCase - 존재하지 않는 itemId
  Given: itemRepo.findById('bad_id') → null
  Then:  throw SentCompError(ITEM_NOT_FOUND)
```

### 통합 테스트

```
TC-10 LocalStorage 저장/조회
  3개 Result → saveResult×3 → getResultsBySession → 3개 동일 반환

TC-11 JSON 문항 로드
  유효한 JSON → loadItems() → 10개 반환, 각 choices.length===2, isCorrect 정확히 1개
```

### E2E 테스트 (Cypress)

```
TC-12 전체 완주: LOADING→PLAYING→AWAITING→이미지선택 (×10) →COMPLETED → ScoreResultPanel 확인
TC-13 재청취: AWAITING→다시듣기→PLAYING→종료→AWAITING + audioEndTimestamp 갱신 확인
TC-14 재생 중 선택 차단: PLAYING 상태에서 이미지 클릭 → 상태 변화 없음
```

### 테스트 더블 전략

| 의존성 | 전략 | 이유 |
|--------|------|------|
| `HtmlAudioPlayer` | Mock | 브라우저 Audio API 단위 테스트 불가 |
| Repository | Stub (In-Memory) | 저장소 독립적으로 채점 로직만 검증 |
| ItemRepository | Stub | items 배열 직접 반환 |
| `performance.now()` | Stub (결정론적 값) | 타이밍 재현 가능성 확보 |

---

## 12. SOLID 준수 점검

| 원칙 | 준수 | 근거 |
|------|:----:|------|
| S - 단일 책임 | O | Scorer(채점만), HtmlAudioPlayer(재생만), Repository(저장만) |
| O - 개방-폐쇄 | O | SentenceType 추가 시 `SENTENCE_TYPES` 배열 확장만으로 대응, 기존 로직 무변경 |
| L - 리스코프 치환 | O | LocalStorage/API Repository 구현체 완전 대체 가능 |
| I - 인터페이스 분리 | O | IAudioPlayer(재생), Repository(저장), ItemRepository(로딩) 별도 인터페이스 |
| D - 의존성 역전 | O | UseCase는 구현체 미참조, 인터페이스만 주입 |

---

## 13. 위험 요소 분석

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| 모바일 브라우저 자동재생 차단 | 높음 | 높음 | 첫 사용자 터치 후 재생 시작; 명시적 "재생" 버튼 제공 |
| `ended` 이벤트와 실제 출력 간 시차 | 보통 | 보통 | 임상적 허용 오차(~50ms) 명시; 필요 시 Web Audio API 교체 |
| 이미지/오디오 에셋 로드 지연 | 보통 | 높음 | 현재 문항 재생 중 다음 문항 assets prefetch |
| 이미지 위치 편향(position bias) | 높음 | 높음 | 정답 이미지 상/하 위치를 문항마다 교차 배치 또는 랜덤화 |
| 자극 에셋 저작권 | 높음 | 높음 | QAB 원본 사용 전 저작권 확인; MVP는 자체 제작 이미지 |

---

## 14. 구현 체크리스트

```
### Domain Layer
- [ ] types.ts: 핵심 타입 정의
- [ ] ISentenceComprehensionRepository.ts
- [ ] ISentenceComprehensionItemRepository.ts
- [ ] shared/domain/IAudioPlayer.ts (검사 3 공동 작업)

### Application Layer
- [ ] dtos.ts: SubmitAnswerRequestDTO, SubmitAnswerResponseDTO, ScoreDTO
- [ ] errors.ts: SentCompErrorCode, SentCompError
- [ ] SentenceComprehensionScorer.ts: isAnswerCorrect, calculateReactionTime, calculateScore
- [ ] SubmitAnswerUseCase.ts
- [ ] ReplayAudioUseCase.ts
- [ ] CalculateScoreUseCase.ts

### Infrastructure Layer
- [ ] shared/infrastructure/HtmlAudioPlayer.ts (검사 3 공동 작업)
- [ ] LocalStorageSentCompRepository.ts
- [ ] JsonSentCompItemRepository.ts
- [ ] assets/data/sentCompItems.json (10문항)

### Presentation Layer
- [ ] shared/hooks/useAudioPlayer.ts (검사 3 공동 작업)
- [ ] shared/hooks/useTimer.ts (검사 3 공동 작업)
- [ ] sentCompSessionReducer.ts: FSM reducer
- [ ] useSentCompViewModel.ts: ViewModel 훅
- [ ] SentenceAudioPlayer.tsx
- [ ] ImageChoiceGrid.tsx
- [ ] ChoiceImageCard.tsx
- [ ] ScoreResultPanel.tsx
- [ ] SentCompScreen.tsx

### Tests
- [ ] 단위: SentenceComprehensionScorer.ts (TC-01~TC-07)
- [ ] 단위: SubmitAnswerUseCase.ts (TC-08, TC-09)
- [ ] 통합: LocalStorageSentCompRepository (TC-10)
- [ ] 통합: JsonSentCompItemRepository (TC-11)
- [ ] E2E: 전체 완주 (TC-12)
- [ ] E2E: 재청취 기능 (TC-13)
- [ ] E2E: 재생 중 선택 차단 (TC-14)

### Assets (별도 작업)
- [ ] 10문항 음성 파일 (sentComp_01~10.mp3)
- [ ] 20장 이미지 (각 문항당 correct/distractor)
```

---

## 15. User Review Required

> [!IMPORTANT]
> 1. **이미지 위치 고정 vs 랜덤 배치:** JSON `orderIndex: 0`이 항상 상단. QAB 원본에서 위치 고정 여부 확인 필요. 권장: 위치 편향 제거를 위해 랜덤 배치.
> 2. **즉각 피드백 표시 여부:** FEEDBACK 상태(0.5초 시각 피드백) 계획 중. QAB 원본 피드백 방침 확인 필요.
> 3. **오디오 자동 재생 vs 수동 버튼:** 자동 재생이 임상 표준이나 모바일 브라우저 정책 충돌 가능.
> 4. **이미지 에셋 포맷:** `webp` vs `jpg/png`, 최소 해상도 및 스타일(사진/일러스트) 결정 필요.
> 5. **검사 3(WordComp) 공유 훅 동기화:** 검사 3 설계 완성 후 `useAudioPlayer`, `useTimer` 인터페이스 최종 통합 검토.
