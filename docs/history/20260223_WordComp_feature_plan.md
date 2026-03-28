# 단어 이해 (Word Comprehension) 검사 - Feature Implementation Plan

> 작성일: 2026-02-23
> 참조: `docs/history/implementation_plan.md`, `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

---

## 1. 목표 및 배경

청각적으로 제시된 단어를 듣고 해당 이미지를 선택하는 청각적 단어 인지 능력 평가 기능을 클린 아키텍처 원칙에 따라 설계한다.

- QAB 8가지 하위검사 중 검사 3에 해당
- LLM 불필요, STT 불필요 - 브라우저 오디오 재생 및 이미지 선택 인터랙션만으로 구현 가능
- 20문항, 문항당 4지선다(이미지), 오답 유형(의미 착어/음운 착어/무관) 메타데이터 기반 패턴 분석 포함

| 역할 | 기술 |
|------|------|
| 언어/프레임워크 | TypeScript + React (웹) |
| 오디오 재생 | `HTMLAudioElement` + `'ended'` 이벤트 |
| 타이밍 측정 | `performance.now()` |
| 상태 관리 | React 훅 + FSM 패턴 |
| 데이터 저장 | LocalStorage (Phase 1), 서버 API (추후 교체 가능) |

---

## 2. 도메인 모델

### 2-1. 값 객체 (Value Object)

#### DistractorType
오답 유형을 나타내는 열거형. 정답 선택지에는 존재하지 않는다.

| 값 | 의미 | 예시 |
|----|------|------|
| `'semantic'` | 의미 착어 - 같은 의미 범주 | "사과" 문항에서 "배" 선택 |
| `'phonemic'` | 음운 착어 - 유사한 발음 | "사과" 문항에서 "사탕" 선택 |
| `'unrelated'` | 무관 오답 - 전혀 무관한 단어 | "사과" 문항에서 "버스" 선택 |

#### WordComprehensionScore (불변 값 객체)
- `rawScore: 0 | 1` - 정답 1점, 오답 0점
- `isCorrect: boolean`
- `selectedDistractorType: DistractorType | undefined` - 오답 시에만 존재

불변 조건:
- `isCorrect === true`이면 `selectedDistractorType`은 반드시 `undefined`
- `isCorrect === false`이면 `rawScore`는 반드시 `0`

#### ReactionTime (불변 값 객체)
- `audioEndTimestamp: number` - `performance.now()` 기준 음성 종료 시점 (ms)
- `selectionTimestamp: number` - `performance.now()` 기준 선택 시점 (ms)
- `durationMs: number` - `selectionTimestamp - audioEndTimestamp` (항상 양수)

불변 조건: `durationMs >= 0`, 시간 역전 시 `InvalidReactionTimeError` 발생

### 2-2. 엔티티 (Entity)

```typescript
interface WordComprehensionChoice {
  readonly choiceId: string;
  readonly word: string;
  readonly imageUrl: string;
  readonly isCorrect: boolean;
  readonly distractorType: DistractorType | undefined;
}

interface WordComprehensionItem {
  readonly itemId: string;        // 예: "wc_001"
  readonly targetWord: string;    // 예: "사과"
  readonly targetAudioUrl: string;
  readonly category: string;      // 예: "과일" (분석용 메타데이터)
  readonly choices: ReadonlyArray<WordComprehensionChoice>;
}

interface WordComprehensionItemResult {
  readonly itemId: string;
  readonly selectedChoiceId: string;
  readonly selectedWord: string;
  readonly score: WordComprehensionScore;
  readonly reactionTime: ReactionTime;
  readonly replayCount: number;
  readonly completedAt: Date;
}

type SessionStatus = 'in-progress' | 'completed' | 'interrupted';

interface WordComprehensionSession {
  readonly sessionId: string;
  readonly patientId: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly itemResults: ReadonlyArray<WordComprehensionItemResult>;
  readonly totalItems: number;   // 20
  readonly status: SessionStatus;
}
```

불변 조건:
- `choices.length === 4`, 정답 선택지는 정확히 1개
- `status === 'completed'`이면 `completedAt !== null`

### 2-3. 유스케이스 정의

#### UC-01: StartWordComprehensionSession
```
사전 조건: patientId 유효, 문항 데이터 로드됨
정상 흐름: UUID 생성 → 선택지 Fisher-Yates shuffle → 세션 생성/저장 → 첫 문항 DTO 반환
예외:      ItemLoadError, InvalidPatientError
```

#### UC-02: SubmitItemAnswer
```
사전 조건: 세션 'in-progress', 현재 문항 음성 재생 완료(AWAITING_RESPONSE 상태)
정상 흐름: 정답 판정 → ReactionTime 생성 → ItemResult 추가 → 마지막이면 completed 처리
예외:      SessionNotFoundError, AlreadyAnsweredError, InvalidChoiceError
```

#### UC-03: ReplayAudio
```
사전 조건: AWAITING_RESPONSE 상태, 재생 중 아님
정상 흐름: replayCount++ → 재재생 → audioEndTimestamp 갱신
```

#### UC-04: CalculateSessionSummary
```
사전 조건: status === 'completed'
정상 흐름: 총점/오답 패턴/평균 반응시간 집계 → WordComprehensionSummary 반환
```

### 2-4. 레포지토리 인터페이스

```typescript
// src/assessments/wordComp/domain/repositories/IWordComprehensionRepository.ts
interface IWordComprehensionRepository {
  saveSession(session: WordComprehensionSession): Promise<void>;
  loadSession(sessionId: string): Promise<WordComprehensionSession | null>;
  saveItemResult(sessionId: string, result: WordComprehensionItemResult): Promise<void>;
  completeSession(sessionId: string, completedAt: Date): Promise<void>;
}

// src/assessments/wordComp/domain/repositories/IWordComprehensionItemRepository.ts
interface IWordComprehensionItemRepository {
  loadAll(): Promise<WordComprehensionItem[]>;
  loadById(itemId: string): Promise<WordComprehensionItem | null>;
}

// src/assessments/wordComp/domain/services/IAudioPlayer.ts
interface IAudioPlayer {
  play(audioUrl: string): Promise<void>;
  stop(): void;
  onEnded(callback: (endTimestamp: number) => void): void;
  offEnded(): void;
  readonly isPlaying: boolean;
}
```

---

## 3. 클린 아키텍처 레이어 설계

```
┌──────────────────────────────────────────────┐
│            Presentation Layer                │
│  WordComprehensionScreen                     │
│  AudioPlayerBar / ImageChoiceGrid / ...      │
│  useWordComprehensionViewModel (Hook)        │
├──────────────────────────────────────────────┤
│            Application Layer                 │
│  StartWordComprehensionSessionUseCase        │
│  SubmitItemAnswerUseCase                     │
│  ReplayAudioUseCase                          │
│  CalculateSessionSummaryUseCase              │
│  DTOs (StartSession / SubmitAnswer / Summary)│
├──────────────────────────────────────────────┤
│              Domain Layer                    │
│  Entities: Item, ItemResult, Session         │
│  Value Objects: Score, ReactionTime, Type    │
│  Interfaces: IRepository, IAudioPlayer       │
│  Services: Scorer, Summarizer                │
│  Errors: DomainError                         │
├──────────────────────────────────────────────┤
│          Infrastructure Layer                │
│  LocalStorageWordComprehensionRepository     │
│  JsonWordComprehensionItemRepository         │
│  HtmlAudioPlayerAdapter                      │
│  wordComprehensionItems.json                 │
└──────────────────────────────────────────────┘
         의존성 방향: 위 → 아래 (단방향)
```

---

## 4. 파일 구조 (전체 신규)

```
src/
└── assessments/
    └── wordComp/
        ├── domain/
        │   ├── entities/
        │   │   ├── WordComprehensionItem.ts               [NEW]
        │   │   ├── WordComprehensionSession.ts            [NEW]
        │   │   └── WordComprehensionItemResult.ts         [NEW]
        │   ├── valueObjects/
        │   │   ├── DistractorType.ts                      [NEW]
        │   │   ├── WordComprehensionScore.ts              [NEW]
        │   │   └── ReactionTime.ts                        [NEW]
        │   ├── repositories/
        │   │   ├── IWordComprehensionRepository.ts        [NEW]
        │   │   └── IWordComprehensionItemRepository.ts    [NEW]
        │   ├── services/
        │   │   ├── IAudioPlayer.ts                        [NEW]
        │   │   ├── WordComprehensionScorer.ts             [NEW] 순수 함수
        │   │   └── WordComprehensionSummarizer.ts         [NEW] 순수 함수
        │   └── errors/
        │       └── WordComprehensionDomainError.ts        [NEW]
        ├── application/
        │   ├── useCases/
        │   │   ├── StartWordComprehensionSessionUseCase.ts [NEW]
        │   │   ├── SubmitItemAnswerUseCase.ts              [NEW]
        │   │   ├── ReplayAudioUseCase.ts                   [NEW]
        │   │   └── CalculateSessionSummaryUseCase.ts       [NEW]
        │   ├── dtos/
        │   │   ├── WordComprehensionItemDTO.ts             [NEW] 정답 은닉
        │   │   ├── WordComprehensionChoiceDTO.ts           [NEW]
        │   │   ├── StartSessionRequestDTO.ts               [NEW]
        │   │   ├── StartSessionResponseDTO.ts              [NEW]
        │   │   ├── SubmitAnswerRequestDTO.ts               [NEW]
        │   │   ├── SubmitAnswerResponseDTO.ts              [NEW]
        │   │   └── SessionSummaryDTO.ts                    [NEW]
        │   └── errors/
        │       └── WordComprehensionAppError.ts            [NEW]
        ├── infrastructure/
        │   ├── repositories/
        │   │   ├── LocalStorageWordComprehensionRepository.ts [NEW]
        │   │   └── JsonWordComprehensionItemRepository.ts     [NEW]
        │   ├── audio/
        │   │   └── HtmlAudioPlayerAdapter.ts               [NEW]
        │   └── data/
        │       └── wordComprehensionItems.json             [NEW] 20문항
        └── presentation/
            ├── screens/
            │   └── WordComprehensionScreen.tsx             [NEW]
            ├── components/
            │   ├── AudioPlayerBar.tsx                      [NEW]
            │   ├── ImageChoiceGrid.tsx                     [NEW] 2x2 Grid
            │   ├── ImageChoiceCard.tsx                     [NEW]
            │   ├── ItemProgressBar.tsx                     [NEW]
            │   └── SessionSummaryView.tsx                  [NEW]
            └── hooks/
                └── useWordComprehensionViewModel.ts        [NEW]
```

**총 신규 파일: 35개**

---

## 5. 핵심 인터페이스 명세

### DTO 설계 (정답 정보 은닉)

```typescript
// UI에 전달되는 문항 데이터 - 정답 여부 미포함
interface WordComprehensionChoiceDTO {
  choiceId: string;
  word: string;
  imageUrl: string;
  // isCorrect, distractorType 미노출
}

interface SubmitAnswerRequestDTO {
  sessionId: string;
  itemId: string;
  choiceId: string;
  audioEndTimestamp: number;  // performance.now() 기준
  selectionTimestamp: number;
}

interface SubmitAnswerResponseDTO {
  isCorrect: boolean;
  sessionStatus: 'in-progress' | 'completed';
  nextItem: WordComprehensionItemDTO | null;
  currentScore: number;
  itemIndex: number;
}
```

### 도메인 서비스

```typescript
// WordComprehensionScorer.ts
export function scoreItem(
  selectedChoice: WordComprehensionChoice
): WordComprehensionScore;

// WordComprehensionSummarizer.ts
export interface WordComprehensionSummary {
  readonly totalScore: number;
  readonly percentageScore: number;
  readonly distractorPattern: {
    readonly semanticErrorCount: number;
    readonly phonemicErrorCount: number;
    readonly unrelatedErrorCount: number;
    readonly semanticErrorRate: number;
    readonly phonemicErrorRate: number;
    readonly unrelatedErrorRate: number;
  };
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}

export function summarizeSession(
  session: WordComprehensionSession
): WordComprehensionSummary;
```

### ViewModel 훅

```typescript
type ItemPhase =
  | 'LOADING' | 'AUDIO_PLAYING' | 'AWAITING_RESPONSE'
  | 'SUBMITTING' | 'SHOWING_RESULT' | 'LOADING_NEXT' | 'COMPLETED';

interface WordComprehensionViewState {
  phase: ItemPhase;
  currentItemIndex: number;         // 0-based
  totalItems: number;               // 20
  currentItem: WordComprehensionItemDTO | null;
  isSelectable: boolean;            // phase === 'AWAITING_RESPONSE'일 때만 true
  isAudioPlaying: boolean;
  replayCount: number;
  lastAnswerCorrect: boolean | null;
  summary: SessionSummaryDTO | null;
  error: string | null;
}

interface WordComprehensionViewActions {
  onChoiceSelected: (choiceId: string) => void;
  onReplayRequested: () => void;
  onRetry: () => void;
}

function useWordComprehensionViewModel(
  patientId: string
): [WordComprehensionViewState, WordComprehensionViewActions]
```

---

## 6. FSM 상태 전이

```
LOADING           → AUDIO_PLAYING     : 이미지 로딩 완료 + 자동 오디오 재생
AUDIO_PLAYING     → AWAITING_RESPONSE : 'ended' 이벤트 (audioEndTimestamp 기록)
AWAITING_RESPONSE → SUBMITTING        : 이미지 카드 pointerdown (selectionTimestamp 기록)
AWAITING_RESPONSE → AUDIO_PLAYING     : "다시 듣기" 탭 (replayCount++)
SUBMITTING        → SHOWING_RESULT    : SubmitItemAnswerUseCase 완료
SHOWING_RESULT    → LOADING_NEXT      : setTimeout 1.5초
LOADING_NEXT      → AUDIO_PLAYING     : 다음 문항 준비 완료
LOADING_NEXT      → COMPLETED         : 마지막 문항(20번째) 완료 시
```

---

## 7. 타이밍 측정 전략

```
[타임라인]
                       "ended" 이벤트
HTMLAudioElement.play() ─────────────────── pointerdown 이벤트
        |                    |                     |
        t=0            audioEndTimestamp     selectionTimestamp
                             |←── durationMs ──────|

핵심 규칙:
- HtmlAudioPlayerAdapter의 'ended' 핸들러 첫 줄에서 performance.now() 캡처
- ImageChoiceCard의 onPointerDown 핸들러 첫 줄에서 performance.now() 캡처
  (click 이벤트 대신 pointerdown 사용 → 약 100~300ms 단축)

재청취 시: audioEndTimestamp를 null로 초기화 → 재종료 시 최신값으로 갱신
```

**오디오 프리로드 전략:**
```
문항 N 재생 중:
  - 문항 N 오디오: 즉시 play()
  - 문항 N 이미지 4장: loading="eager"
  - 문항 N+1 오디오: new Audio(url).load() 백그라운드 prefetch
  - 문항 N+1 이미지: Image() 객체 생성으로 prefetch
```

---

## 8. 인프라 구현 핵심 코드

### HtmlAudioPlayerAdapter - 종료 시점 정밀 캡처

```typescript
class HtmlAudioPlayerAdapter implements IAudioPlayer {
  async play(audioUrl: string): Promise<void> {
    this.stop();
    this.audio = new Audio(audioUrl);

    this.audio.addEventListener('ended', () => {
      // performance.now()를 이벤트 핸들러 첫 줄에서 즉시 캡처
      const endTimestamp = performance.now();
      this.endedCallback?.(endTimestamp);
    });

    await this.audio.play();
    // iOS Safari: 사용자 제스처 컨텍스트에서만 호출 가능
  }
}
```

### 문항 데이터 JSON 구조

```json
{
  "version": "1.0.0",
  "totalItems": 20,
  "items": [
    {
      "itemId": "wc_001",
      "targetWord": "사과",
      "targetAudioUrl": "/assets/audio/wordComp/wc_001_target.mp3",
      "category": "과일",
      "choices": [
        { "choiceId": "wc_001_c1", "word": "사과", "imageUrl": "/assets/images/wordComp/apple.webp", "isCorrect": true, "distractorType": null },
        { "choiceId": "wc_001_c2", "word": "배", "imageUrl": "/assets/images/wordComp/pear.webp", "isCorrect": false, "distractorType": "semantic" },
        { "choiceId": "wc_001_c3", "word": "사탕", "imageUrl": "/assets/images/wordComp/candy.webp", "isCorrect": false, "distractorType": "phonemic" },
        { "choiceId": "wc_001_c4", "word": "버스", "imageUrl": "/assets/images/wordComp/bus.webp", "isCorrect": false, "distractorType": "unrelated" }
      ]
    }
  ]
}
```

---

## 9. 에러 처리 전략

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  WC_APP_ITEM_LOAD_FAILED:  '문항 데이터를 불러오지 못했습니다. 다시 시도해주세요.',
  WC_APP_AUDIO_PLAY_FAILED: '음성을 재생할 수 없습니다. 기기 음량을 확인해주세요.',
  WC_SESSION_NOT_FOUND:     '검사 세션을 찾을 수 없습니다. 검사를 다시 시작해주세요.',
  WC_INVALID_CHOICE:        '선택된 항목을 처리할 수 없습니다. 다시 시도해주세요.',
  DEFAULT:                  '오류가 발생했습니다. 다시 시도해주세요.',
};
```

에러 전파: `Infrastructure 예외 → Application에서 래핑 → ViewModel에서 메시지 변환 → UI 에러 화면`

---

## 10. 테스트 전략

### 단위 테스트 - 도메인 레이어 (커버리지 목표: 100%)

```
WordComprehensionScorer:
  정답 선택지(isCorrect:true)             → isCorrect=true, rawScore=1
  의미 착어 오답(distractorType:'semantic') → isCorrect=false, rawScore=0, type='semantic'

WordComprehensionSummarizer:
  20문항, 정답 15개 / semantic 3, phonemic 1, unrelated 1
    → totalScore=15, percentageScore=75, semanticErrorRate=0.6
  전부 정답  → percentageScore=100, 모든 errorCount=0
  전부 오답  → percentageScore=0

ReactionTime:
  audioEndTimestamp=1000, selectionTimestamp=2500  → durationMs=1500
  시간 역전 (selection < audioEnd)                → throws INVALID_REACTION_TIME
```

### 단위 테스트 - 애플리케이션 레이어 (목표: 90%)

```
SubmitItemAnswerUseCase:
  정답 choiceId, 첫 문항    → isCorrect=true, status='in-progress', nextItem!=null
  정답 choiceId, 20번째 문항 → status='completed', nextItem=null
  유효하지 않은 choiceId    → throws INVALID_CHOICE
  이미 답변 완료된 itemId   → throws ALREADY_ANSWERED
```

| 의존성 | 테스트 더블 | 이유 |
|--------|-----------|------|
| `HtmlAudioPlayerAdapter` | Mock | onEnded 콜백 수동 트리거 필요 |
| Repository | Fake (In-Memory Map) | 격리된 저장소로 속도/독립성 확보 |
| `JsonWordComprehensionItemRepository` | Stub | 고정 테스트 문항 반환 |

### E2E 테스트 (Cypress)
```
시나리오 1: 전체 완주 - 20문항 완료 → 요약 화면 + 총점 표시 확인
시나리오 2: 재청취 - AWAITING 중 재청취 → replayCount++ → 새 audioEndTimestamp 갱신 확인
시나리오 3: 재생 중 선택 차단 - AUDIO_PLAYING 상태에서 이미지 탭 → 상태 변화 없음 확인
```

---

## 11. SOLID 준수 점검

| 원칙 | 상태 | 근거 |
|------|:----:|------|
| S - 단일 책임 | 준수 | Scorer(채점만), Summarizer(집계만), HtmlAudioPlayer(재생만), ViewModel(FSM + UC 조합만) |
| O - 개방-폐쇄 | 준수 | DistractorType 추가 시 union 확장만. 기존 채점 로직 무변경 |
| L - 리스코프 치환 | 준수 | LocalStorage/InMemory/API Repository 모두 인터페이스 완전 대체 가능 |
| I - 인터페이스 분리 | 준수 | 세션 저장/문항 조회 인터페이스 분리. IAudioPlayer는 재생 기능만 |
| D - 의존성 역전 | 준수 | UseCase는 구현체 미참조, 생성자 주입으로 인터페이스에만 의존 |

---

## 12. 위험 요소 분석

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| `ended` 이벤트 타이밍 iOS Safari 편차 | 보통 | 높음 | 핸들러 첫 줄에서 즉시 캡처. 실기기 별도 테스트 |
| 이미지 로딩 지연으로 음성 종료 전 미표시 | 낮음 | 보통 | 이미지 프리로드 완료 후 오디오 재생 (`Promise.all`) |
| 모바일 `pointerdown` 스크롤 이벤트 충돌 | 보통 | 보통 | `e.preventDefault()` + `touch-action: none` |
| 20문항 JSON 로딩 실패 | 낮음 | 높음 | retry 로직(최대 3회) + 명확한 에러 화면 |

---

## 13. User Review Required

> [!IMPORTANT]
> 1. **정답/오답 피드백 표시 정책:** `SHOWING_RESULT` 상태(1.5초 피드백) 포함. 임상 프로토콜상 피드백 없이 진행해야 하는지 확인 필요.
> 2. **선택지 무작위화 범위:** 매 검사마다 새로 무작위화(학습 효과 방지) vs 첫 무작위화 고정(반복 측정 신뢰도) 결정 필요.
> 3. **음성/이미지 에셋 준비:** TTS API로 음성 생성 vs 직접 녹음, 이미지 자체 제작 vs 공개 도메인 활용 결정 필요.
> 4. **세션 중단 복구 정책:** 브라우저 종료 후 진행 중 세션(예: 10문항 완료) 재개 vs 처음부터 재시작 결정 필요.
