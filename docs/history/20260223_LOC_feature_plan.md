# 의식 수준 (Level of Consciousness) 검사 - Feature Implementation Plan

> 작성일: 2026-02-23
> 참조: `docs/history/implementation_plan.md`, `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

---

## 1. 목표 및 배경

QAB 하위검사 1번 "의식 수준(LOC)"을 클린 아키텍처 기반으로 구현한다. LLM/STT 불필요, 순수 타이밍·터치 측정만 사용하는 가장 단순한 검사로 이후 7개 검사의 아키텍처 패턴 템플릿이 된다.

---

## 2. 도메인 모델링

### 엔티티 / 값 객체

| 타입 | 이름 | 설명 |
|------|------|------|
| Value Object | `LocTrial` | 시도 1회 결과. 불변(Object.freeze). |
| Value Object | `LocScore` | 채점 결과 (0\|1\|2\|3). 채점 규칙 내장. |
| Entity | `LocAssessmentResult` | 전체 검사 결과. ID, 세션ID, trials 목록, 최종 점수 보유. |

**`LocTrial` 불변 조건:**
- `trialNumber`는 1, 2, 3만 허용
- `latency = touchTime - audioEndTime` (null 아닌 경우 반드시 일치)
- `touchTime == null`이면 `latency == null`이어야 함

**채점 규칙 (`LocScorer`):**
```
latency == null OR touchInBounds == false → 0점
latency ≤ 3_000ms  → 3점 (정상)
latency ≤ 6_000ms  → 2점 (경도 지연)
latency ≤ 10_000ms → 1점 (중도 지연)
latency > 10_000ms → 0점 (시간 초과)
```

### 유스케이스

| 유스케이스 | Actor | 핵심 흐름 |
|-----------|-------|---------|
| `ConductLocTrial` | 환자 | TTS 재생 → 타이머 시작 → 터치 감지 → LocTrial 생성 |
| `FinishLocAssessment` | 시스템 | trials → LocAssessmentResult 생성 → Repository 저장 |

### 레포지토리 인터페이스

```typescript
// src/assessments/loc/domain/ILocResultRepository.ts
interface ILocResultRepository {
  save(result: LocAssessmentResult): Promise<void>;
  findById(id: string): Promise<LocAssessmentResult | null>;
  findBySessionId(sessionId: string): Promise<LocAssessmentResult | null>;
}

// src/shared/domain/ITtsService.ts
interface ITtsService {
  speak(text: string): Promise<TtsPlaybackResult>;
  cancel(): void;
}
interface TtsPlaybackResult {
  startTime: number;   // performance.now() 기준
  endTime: number;
  durationMs: number;
}
```

---

## 3. 클린 아키텍처 레이어 설계

```
┌──────────────────────────────────────────────────────────────────┐
│  Presentation Layer                                              │
│  LocScreen ← useLocViewModel (FSM 상태 관리, 이벤트 처리)          │
│  LocTouchButton | LocProgressBar | LocAudioIndicator             │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 호출
┌──────────────────────────▼───────────────────────────────────────┐
│  Application Layer                                               │
│  ConductLocTrialUseCase | FinishLocAssessmentUseCase             │
│  LocTrialRequestDTO / LocTrialResponseDTO                        │
│  LocAssessmentError (enum + class)                               │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 인터페이스만 의존
┌──────────────────────────▼───────────────────────────────────────┐
│  Domain Layer  (외부 의존성 0)                                     │
│  LocTrial (VO) | LocAssessmentResult (Entity)                    │
│  LocScorer (Domain Service)                                      │
│  ILocResultRepository | ITtsService (Interfaces)                 │
└──────────────────────────────────────────────────────────────────┘
          ▲                              ▲
          │ 구현                          │ 구현
┌─────────┴──────────────┐  ┌───────────┴──────────────────────┐
│  Infrastructure Layer  │  │  Infrastructure Layer (shared)    │
│  LocalStorageLocRepo   │  │  WebSpeechTtsService              │
└────────────────────────┘  └──────────────────────────────────┘
```

---

## 4. 파일 구조 (`[NEW]` 전체)

```
src/
├── assessments/
│   └── loc/
│       ├── domain/
│       │   ├── LocTrial.ts                         [NEW] 값 객체 + createLocTrial 팩토리
│       │   ├── LocScorer.ts                        [NEW] calculateLocScore / calculateFinalLocScore
│       │   ├── LocAssessmentResult.ts              [NEW] 엔티티 + createLocAssessmentResult 팩토리
│       │   └── ILocResultRepository.ts             [NEW] 레포지토리 인터페이스
│       ├── application/
│       │   ├── dto/
│       │   │   └── LocTrialDTO.ts                  [NEW] LocTrialRequestDTO / LocTrialResponseDTO / LocAssessmentResultDTO
│       │   ├── LocAssessmentError.ts               [NEW] LocAssessmentErrorCode (enum) + LocAssessmentError (class)
│       │   ├── ConductLocTrialUseCase.ts           [NEW] TTS 재생 + LocTrial 생성 + DTO 변환
│       │   └── FinishLocAssessmentUseCase.ts       [NEW] 결과 집계 + Repository 저장
│       ├── infrastructure/
│       │   └── LocalStorageLocResultRepository.ts  [NEW] ILocResultRepository 구현 (LocalStorage)
│       └── presentation/
│           ├── useLocViewModel.ts                  [NEW] FSM 상태 관리 훅
│           ├── LocScreen.tsx                       [NEW] 최상위 화면 (Composition Root 포함)
│           └── components/
│               ├── LocTouchButton.tsx              [NEW] 70vh 대형 터치 버튼 (onPointerDown)
│               ├── LocProgressBar.tsx              [NEW] 카운트다운 진행 바
│               └── LocAudioIndicator.tsx           [NEW] TTS 재생 중 표시
├── shared/
│   ├── domain/
│   │   └── ITtsService.ts                         [NEW] TTS 인터페이스 (공유)
│   ├── infrastructure/
│   │   └── WebSpeechTtsService.ts                 [NEW] Web Speech API 구현 (ko-KR, rate 0.85)
│   └── hooks/
│       ├── useTimer.ts                            [NEW] performance.now() 기반 범용 타이머
│       └── useTTS.ts                              [NEW] TTS 재생 상태 관리 훅
```

---

## 5. 핵심 공개 인터페이스 명세

### 도메인 레이어

```typescript
// src/assessments/loc/domain/LocTrial.ts
export type LocScoreValue = 0 | 1 | 2 | 3;

export interface LocTrial {
  readonly trialNumber: 1 | 2 | 3;
  readonly audioEndTime: number;       // performance.now() ms
  readonly touchTime: number | null;
  readonly latency: number | null;
  readonly touchInBounds: boolean;
  readonly score: LocScoreValue;
}

export function createLocTrial(params: {
  trialNumber: 1 | 2 | 3;
  audioEndTime: number;
  touchTime: number | null;
  touchInBounds: boolean;
}): LocTrial; // Object.freeze() 적용된 불변 객체 반환

// src/assessments/loc/domain/LocScorer.ts
export const LOC_SCORE_THRESHOLDS: {
  NORMAL: 3_000;
  MILD_DELAY: 6_000;
  MODERATE_DELAY: 10_000;
};

export function calculateLocScore(
  latency: number | null,
  touchInBounds: boolean
): LocScoreValue;

export function calculateFinalLocScore(
  trials: readonly { score: LocScoreValue }[]
): number;

// src/assessments/loc/domain/LocAssessmentResult.ts
export interface LocAssessmentResult {
  readonly id: string;
  readonly sessionId: string;
  readonly patientId: string;
  readonly trials: readonly LocTrial[];
  readonly finalScore: number;
  readonly completedAt: Date;
  readonly totalDurationMs: number;
}

export function createLocAssessmentResult(params: {
  id: string;
  sessionId: string;
  patientId: string;
  trials: LocTrial[];
  startTime: number;  // performance.now() 기준
}): LocAssessmentResult;
```

### 애플리케이션 레이어

```typescript
// src/assessments/loc/application/LocAssessmentError.ts
export enum LocAssessmentErrorCode {
  TTS_PLAYBACK_FAILED = 'LOC_TTS_PLAYBACK_FAILED',
  STORAGE_FAILED = 'LOC_STORAGE_FAILED',
  INVALID_TRIAL_NUMBER = 'LOC_INVALID_TRIAL_NUMBER',
  ASSESSMENT_ALREADY_COMPLETE = 'LOC_ASSESSMENT_ALREADY_COMPLETE',
}

export class LocAssessmentError extends Error {
  readonly code: LocAssessmentErrorCode;
  readonly cause?: unknown;
}

// src/assessments/loc/application/dto/LocTrialDTO.ts
export interface LocTrialRequestDTO {
  trialNumber: 1 | 2 | 3;
  audioEndTime: number;
  touchTime: number | null;
  touchX: number;
  touchY: number;
  buttonBounds: { x: number; y: number; width: number; height: number };
}

export interface LocTrialResponseDTO {
  trialNumber: number;
  latencyMs: number | null;
  touchInBounds: boolean;
  score: 0 | 1 | 2 | 3;
  scoreLabel: '정상' | '경도 지연' | '중도 지연' | '무반응';
  isComplete: boolean;
}

export interface LocAssessmentResultDTO {
  id: string;
  finalScore: number;
  trials: LocTrialResponseDTO[];
  totalDurationMs: number;
}
```

### 프레젠테이션 레이어

```typescript
// src/assessments/loc/presentation/useLocViewModel.ts
export type LocAssessmentState =
  | 'IDLE' | 'TTS_PLAYING' | 'AWAITING_TOUCH'
  | 'TOUCH_DETECTED' | 'TRIAL_COMPLETE' | 'ASSESSMENT_COMPLETE';

export interface LocViewState {
  assessmentState: LocAssessmentState;
  currentTrialNumber: number;
  remainingSeconds: number;
  trialResults: LocTrialResponseDTO[];
  finalScore: number | null;
  errorMessage: string | null;
  isTtsPlaying: boolean;
  isButtonEnabled: boolean;
}

export interface LocViewModelActions {
  startAssessment: () => Promise<void>;
  handleButtonTouch: (event: React.PointerEvent<HTMLButtonElement>) => void;
  proceedToNextAssessment: () => void;
}

export function useLocViewModel(
  conductTrialUseCase: ConductLocTrialUseCase,
  finishAssessmentUseCase: FinishLocAssessmentUseCase,
  onComplete: (resultId: string) => void
): { viewState: LocViewState; actions: LocViewModelActions };
```

---

## 6. FSM (유한 상태 기계) 설계

```
상태 전이 다이어그램:

  IDLE
    │ [startAssessment()]
    ▼
  TTS_PLAYING ─── [TTS 실패] ──► IDLE (errorMessage 표시)
    │ [TTS onend]
    ▼
  AWAITING_TOUCH ─── [10초 타임아웃] ──► TOUCH_DETECTED (touchTime=null)
    │ [onPointerDown]
    ▼
  TOUCH_DETECTED
    │ [처리 완료]
    ▼
  TRIAL_COMPLETE
    ├─ [trialNumber < 3] ──► TTS_PLAYING (다음 시도)
    └─ [trialNumber = 3 OR score = 3] ──► ASSESSMENT_COMPLETE
```

**핵심 전이 규칙:**
- `TTS_PLAYING` 상태에서만 `AWAITING_TOUCH`로 전이 가능 (TTS 재생 전 터치 무시)
- `AWAITING_TOUCH` 상태에서만 `handleButtonTouch()` 유효 처리
- 중복 터치 방지: `touchHandledRef` 플래그로 첫 번째 `pointerdown`만 처리

---

## 7. 타이밍 측정 전략

```
원칙: 모든 구간 측정은 performance.now()만 사용. Date.now() 사용 금지.

측정 지점:
  T1 = performance.now()  ← TTS utterance.onend 콜백 내부 (= audioEndTime)
  T2 = performance.now()  ← onPointerDown 핸들러 첫 줄 (= touchTime)
  latency = T2 - T1

포인터 이벤트 선택 근거:
  onPointerDown: mousedown + touchstart 통합, 최초 접촉 시 발생 (touchend보다 최소 150ms 빠름)
  → 실어증 환자의 반응 시간 측정에 적합

TTS 딜레이 허용 오차:
  utterance.onend는 실제 오디오 출력 후 ~10-50ms 뒤 발생 가능.
  임상적 의미가 없는 수준으로 허용.
  추후 필요 시 BROWSER_AUDIO_OFFSET_MS 상수로 보정 가능.
```

---

## 8. 에러 처리 전략

```
계층별 에러 타입:

[Domain]      순수 Error('메시지') - 불변 조건 위반 시
[Application] LocAssessmentError(code, message, cause) - 유스케이스 실패 시
[Infra]       내부 Error → Application에서 LocAssessmentError로 래핑
[Presentation] LocAssessmentError.code → 사용자 메시지 매핑:
  TTS_PLAYBACK_FAILED → "음성 안내 재생 실패. 기기 음량을 확인해주세요."
  STORAGE_FAILED      → "저장 실패. 계속 진행합니다." (비중단 에러)
  그 외               → "오류 발생. 다시 시도해주세요."
```

---

## 9. 테스트 전략

### 단위 테스트 - 도메인 레이어 (목표: 100%)

**`LocScorer.test.ts` 핵심 케이스 (Given-When-Then):**

```
# 경계값 테스트
Given latency = null, touchInBounds = true  →  score = 0
Given latency = 3000, touchInBounds = true  →  score = 3  (경계값 포함)
Given latency = 3001, touchInBounds = true  →  score = 2  (경계 초과)
Given latency = 6000, touchInBounds = true  →  score = 2
Given latency = 10000, touchInBounds = true →  score = 1
Given latency = 10001, touchInBounds = true →  score = 0
Given latency = 1000, touchInBounds = false →  score = 0  (영역 외 터치)
```

**`LocTrial.test.ts` 핵심 케이스:**
```
Given audioEndTime = 0                  →  Error throw
Given touchTime = null                  →  latency = null, score = 0
Given 생성된 객체에 직접 할당 시도      →  TypeError (Object.freeze)
```

**`LocAssessmentResult.test.ts` 핵심 케이스:**
```
Given trials = []                              →  Error throw
Given trials = [score:1, score:3, score:2]     →  finalScore = 3 (최고 점수 채택)
```

### 단위 테스트 - 애플리케이션 레이어 (목표: 90%)

| 의존성 | 전략 | 이유 |
|--------|------|------|
| ITtsService | Mock | 오디오 하드웨어 없이 endTime 제어 |
| ILocResultRepository | Stub | save() 고정 응답으로 격리 |
| localStorage | jsdom Fake | 실제 브라우저 없이 동작 |

---

## 10. SOLID 준수 점검

| 원칙 | 결과 | 근거 |
|------|:----:|------|
| S - 단일 책임 | 준수 | LocScorer(채점만), LocTrial(데이터만), ViewModel(상태 관리만), Screen(렌더링만) |
| O - 개방-폐쇄 | 준수 | 채점 기준 변경 시 `LOC_SCORE_THRESHOLDS` 상수만 수정 |
| L - 리스코프 치환 | 준수 | LocalStorage → InMemory Repository 교체 시 유스케이스 동작 동일 |
| I - 인터페이스 분리 | 준수 | `ITtsService`는 speak/cancel 2개만 정의 |
| D - 의존성 역전 | 준수 | 유스케이스는 인터페이스에만 의존. Composition Root에서만 조립 |

---

## 11. 위험 요소 분석

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| Web Speech API 한국어 품질 저하 | 보통 | 높음 | `WebSpeechTtsService` 교체만으로 다른 TTS API 적용 가능 |
| TTS onend 이벤트 딜레이 (~50ms) | 높음 | 낮음 | 임상적 허용 오차 범위. `BROWSER_AUDIO_OFFSET_MS` 보정 상수 추가 가능 |
| 모바일 pointerdown 이벤트 취소 | 보통 | 보통 | 실 기기 테스트 필요 |
| LocalStorage 5MB 용량 한계 | 낮음 | 보통 | 인프라 레이어만 교체하여 원격 저장소로 전환 가능 |
| 탭 전환 시 TTS 중단 | 보통 | 낮음 | `visibilitychange` 이벤트로 검사 일시정지 처리 예정 |

---

## 12. User Review Required

> [!IMPORTANT]
> 1. **finalScore 산출 방식:** 현재 설계는 3회 중 **최고 점수** 채택. 임상 프로토콜상 **평균** 또는 **최초 성공 점수**를 사용하는지 확인 필요.
> 2. **조기 종료 조건:** 현재 만점(3점) 달성 시 나머지 시도를 생략. 반드시 3회 모두 진행해야 하는지 확인 필요.
> 3. **TTS 재생 중 버튼 표시:** TTS 재생 중 버튼을 비활성화 상태로 미리 표시할지, TTS 종료 후에만 나타나게 할지 결정 필요.
> 4. **세션/환자 ID 관리:** `sessionId`, `patientId` 세션 관리 모듈 설계와 연계 필요.
> 5. **접근성 요구사항:** 고대비 모드, 진동 피드백 등 추가 접근성 요구사항 명시 필요.
