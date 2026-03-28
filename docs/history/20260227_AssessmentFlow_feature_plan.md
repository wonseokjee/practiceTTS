# QAB 검사 흐름(Assessment Flow) Feature Plan

> 작성일: 2026-02-27
> 참조 문서: `docs/history/20260227_AssessmentFlow_implementation_plan.md`
> 작성 기준: 실제 코드 파악 후 구현 가능한 수준의 상세 명세

---

## 1. 목표 및 배경

현재 `App.tsx`는 세션 생성 후 `LocScreen`만 단순 렌더링하는 임시 구조다:

```typescript
// 현재 (App.tsx 18번 줄)
return (
  <div className="App">
    <LocScreen onComplete={handleLocComplete} />
  </div>
);
```

이 Feature Plan은 다음 완전한 검사 흐름을 구현하기 위한 파일 단위 명세를 제공한다:

```
PatientSetupScreen → LocScreen → AssessmentHubScreen → SentCompScreen | WordComprehensionScreen
```

---

## 2. 기존 코드 파악 결과

### 2-1. 파일별 현재 인터페이스

**`App.tsx` (현재 32줄)**
- `AppContent` 컴포넌트: `useSessionContext()`로 `session` 획득, 조건부 렌더링
- `handleLocComplete(resultId: string)`: console.log만 수행, 실질적 처리 없음
- `session === null` → `PatientSetupScreen`, `session !== null` → `LocScreen`
- `App` 컴포넌트: `SessionProvider`로 `AppContent` 래핑

**`LocScreen.tsx` (현재 242줄)**
```typescript
interface LocScreenProps {
  onComplete?: (resultId: string) => void;
  // onProceed 없음 — 추가 필요
}

export function LocScreen({ onComplete }: LocScreenProps)
```
- 198~203번 줄: "다음 검사로 이동" 버튼 — `onClick={actions.proceedToNextAssessment}` 단독 호출
- `proceedToNextAssessment()`는 ViewModel 상태를 `IDLE`로 초기화만 함 (App 레벨 전환 없음)
- `useSessionContext()`에서 `endSession` 직접 호출

**`SentCompScreen.tsx` (현재 183줄)**
```typescript
interface SentCompScreenProps {
  onComplete?: (score: ScoreDTO) => void;
}

// ScoreDTO (sentComp/application/dtos.ts)
interface ScoreDTO {
  readonly totalScore: number;
  readonly correctCount: number;
  readonly totalItems: number;
  readonly byType: Record<string, { total: number; correct: number; rate: number | null }>;
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}
```
- COMPLETED + score !== null 상태에서 `ScoreResultPanel`의 `onProceed`에서 `onComplete?.(score)` 직접 호출
- `endSession`은 내부적으로 `useSessionContext()`에서 직접 획득

**`WordComprehensionScreen.tsx` (현재 290줄)**
```typescript
interface WordComprehensionScreenProps {
  onComplete?: (summary: SessionSummaryDTO) => void;
}

// SessionSummaryDTO (wordComp/application/dtos/SessionSummaryDTO.ts)
interface SessionSummaryDTO {
  readonly totalScore: number;
  readonly percentageScore: number;
  readonly totalItems: number;
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
```
- COMPLETED 상태에서 `SessionSummaryView`의 `onProceed`에서 `onComplete(summary)` 호출
- `endSession`은 `onEndSession` prop으로 내부 `WordComprehensionScreenInner`에 전달됨

**`SessionContext.tsx` (현재 87줄)**
```typescript
interface SessionContextValue {
  session: Session | null;        // { sessionId: string; patientId: string }
  startSession: (patientId: string) => void;
  endSession: () => void;
}

export function useSessionContext(): SessionContextValue
```
- localStorage `practiv_session` 키에 세션 영속화
- `endSession()` 호출 시 localStorage 삭제 + `setSession(null)`

### 2-2. 타입스크립트 제약 확인 (tsconfig.app.json)

| 옵션 | 값 | 영향 |
|------|----|------|
| `erasableSyntaxOnly` | `true` | `enum` 사용 불가. `const` 객체 + `typeof` 패턴 사용 |
| `verbatimModuleSyntax` | `true` | `import type` 필수. 타입 only import에 `type` 키워드 필수 |
| `noUnusedLocals` / `noUnusedParameters` | `true` | 미사용 변수/파라미터 컴파일 오류 |
| `strict` | `true` | null 체크, 암묵적 any 금지 |
| import 확장자 | `.js` | 모든 로컬 import에 `.js` 확장자 명시 필수 |

---

## 3. 아키텍처 설계

### 3-1. App 레벨 상태 타입

```typescript
// App.tsx 내부 (컴파일 제약: enum 금지 → string literal union 사용)

type AppPhase =
  | 'LOC'
  | 'HUB'
  | 'SENT_COMP'
  | 'WORD_COMP';

type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}
```

### 3-2. 화면 전환 다이어그램

```
session === null
  └──> PatientSetupScreen

session !== null, appPhase:
  'LOC'       ──> LocScreen
                    onProceed() ──> setAppPhase('HUB')
                    onComplete(resultId) ──> [locCompleted = true 기록용, 선택적]

  'HUB'       ──> AssessmentHubScreen
                    onSelect('sentComp') ──> setAppPhase('SENT_COMP')
                    onSelect('wordComp') ──> setAppPhase('WORD_COMP')

  'SENT_COMP' ──> SentCompScreen
                    onComplete(score) ──> setCompletedAssessments + setAppPhase('HUB')

  'WORD_COMP' ──> WordComprehensionScreen
                    onComplete(summary) ──> setCompletedAssessments + setAppPhase('HUB')
```

### 3-3. 의존성 다이어그램

```
App.tsx (AppContent)
  ├── SessionContext (useSessionContext) ── 세션 정보, endSession
  ├── PatientSetupScreen ── session === null 시 렌더링
  ├── LocScreen ── appPhase === 'LOC'
  │     props: onComplete, onProceed
  ├── AssessmentHubScreen [NEW] ── appPhase === 'HUB'
  │     props: completedAssessments, onSelect
  │     └── AssessmentCard [NEW] (×2)
  │           props: title, subtitle, description, isCompleted, onStart
  ├── SentCompScreen ── appPhase === 'SENT_COMP'
  │     props: onComplete(score: ScoreDTO)
  └── WordComprehensionScreen ── appPhase === 'WORD_COMP'
        props: onComplete(summary: SessionSummaryDTO)
```

---

## 4. 파일별 공개 인터페이스 명세

### 4-1. [MODIFY] `frontend/src/App.tsx`

#### 타입 정의 (파일 상단, 컴포넌트 외부)

```typescript
type AppPhase = 'LOC' | 'HUB' | 'SENT_COMP' | 'WORD_COMP';

type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}
```

#### AppContent 컴포넌트 상태

```typescript
function AppContent() {
  const { session } = useSessionContext();

  const [appPhase, setAppPhase] = useState<AppPhase>('LOC');
  const [completedAssessments, setCompletedAssessments] =
    useState<CompletedAssessments>({ sentComp: false, wordComp: false });

  // ... 핸들러 정의
}
```

#### 핸들러 목록 (시그니처 + 동작)

```typescript
// LOC 검사 완료: resultId 기록 (필요 시 확장)
const handleLocComplete = (resultId: string): void => {
  console.log('LOC 검사 완료. 결과 ID:', resultId);
};

// "다음 검사로 이동" 버튼 클릭: 허브 전환
const handleLocProceed = (): void => {
  setAppPhase('HUB');
};

// 허브에서 검사 선택: 해당 검사 phase로 전환
const handleHubSelect = (id: AssessmentId): void => {
  if (id === 'sentComp') setAppPhase('SENT_COMP');
  else setAppPhase('WORD_COMP');
};

// SentComp 완료: 완료 뱃지 업데이트 + 허브 복귀
const handleSentCompComplete = (_score: ScoreDTO): void => {
  setCompletedAssessments((prev) => ({ ...prev, sentComp: true }));
  setAppPhase('HUB');
};

// WordComp 완료: 완료 뱃지 업데이트 + 허브 복귀
const handleWordCompComplete = (_summary: SessionSummaryDTO): void => {
  setCompletedAssessments((prev) => ({ ...prev, wordComp: true }));
  setAppPhase('HUB');
};
```

#### 렌더링 분기 (JSX)

```typescript
if (session === null) {
  return <PatientSetupScreen />;
}

if (appPhase === 'LOC') {
  return (
    <LocScreen
      onComplete={handleLocComplete}
      onProceed={handleLocProceed}
    />
  );
}

if (appPhase === 'HUB') {
  return (
    <AssessmentHubScreen
      completedAssessments={completedAssessments}
      onSelect={handleHubSelect}
    />
  );
}

if (appPhase === 'SENT_COMP') {
  return <SentCompScreen onComplete={handleSentCompComplete} />;
}

return <WordComprehensionScreen onComplete={handleWordCompComplete} />;
```

#### import 추가 목록

```typescript
import { useState } from 'react';
import { SentCompScreen } from './assessments/sentComp/presentation/SentCompScreen.js';
import { WordComprehensionScreen } from './assessments/wordComp/presentation/screens/WordComprehensionScreen.js';
import { AssessmentHubScreen } from './shared/hub/AssessmentHubScreen.js';
import type { ScoreDTO } from './assessments/sentComp/application/dtos.js';
import type { SessionSummaryDTO } from './assessments/wordComp/application/dtos/SessionSummaryDTO.js';
```

---

### 4-2. [MODIFY] `frontend/src/assessments/loc/presentation/LocScreen.tsx`

#### 변경 최소화 원칙

`LocScreen.tsx` 수정은 다음 두 곳으로 한정한다:
1. `LocScreenProps` 인터페이스에 `onProceed` prop 추가
2. 198~203번 줄 버튼 `onClick` 핸들러에서 `onProceed?.()` 호출 추가

#### 변경 전후 비교 (정확한 줄 기준)

**변경 1: `LocScreenProps` (25~27번 줄)**

```typescript
// 변경 전 (25~27번 줄)
interface LocScreenProps {
  onComplete?: (resultId: string) => void;
}

// 변경 후
interface LocScreenProps {
  onComplete?: (resultId: string) => void;
  onProceed?: () => void;
}
```

**변경 2: 함수 시그니처 (58번 줄)**

```typescript
// 변경 전
export function LocScreen({ onComplete }: LocScreenProps) {

// 변경 후
export function LocScreen({ onComplete, onProceed }: LocScreenProps) {
```

**변경 3: "다음 검사로 이동" 버튼 (197~203번 줄)**

```typescript
// 변경 전
<button
  type="button"
  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
  onClick={actions.proceedToNextAssessment}
>
  다음 검사로 이동
</button>

// 변경 후
<button
  type="button"
  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
  onClick={() => {
    actions.proceedToNextAssessment();
    onProceed?.();
  }}
>
  다음 검사로 이동
</button>
```

#### 변경 근거

- `proceedToNextAssessment()`는 ViewModel 내부 상태(`assessmentState → 'IDLE'`, `trialResults → []` 등)를 초기화하는 역할을 유지한다.
- `onProceed?.()`는 그 직후 App 레벨 `appPhase`를 `'HUB'`로 전환하는 외부 콜백이다.
- 이 순서(ViewModel 초기화 → App 전환)는 LocScreen이 언마운트되기 전 상태를 정리하므로 안전하다.
- ViewModel, UseCase, Repository 등 하위 코드는 일절 수정하지 않는다.

---

### 4-3. [NEW] `frontend/src/shared/hub/AssessmentHubScreen.tsx`

#### Props 인터페이스

```typescript
// AssessmentHubScreen.tsx 내부 타입 정의
// (App.tsx와 동일한 타입을 재선언하지 않고 props로만 수신)

type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}

interface AssessmentHubScreenProps {
  completedAssessments: CompletedAssessments;
  onSelect: (id: AssessmentId) => void;
}
```

#### 공개 export

```typescript
export function AssessmentHubScreen({
  completedAssessments,
  onSelect,
}: AssessmentHubScreenProps): React.JSX.Element
```

#### 렌더링 조건 및 로직

1. **헤더 영역**
   - `useSessionContext()`에서 `session.patientId`, `endSession` 획득
   - 환자 ID 표시 + 세션 종료 버튼

2. **LOC 완료 배너** (항상 표시, 비활성)
   - "LOC (의식 수준) 검사" + "완료" 텍스트
   - `bg-gray-100 text-gray-400` 스타일로 비활성 표현

3. **검사 카드 목록**
   - `AssessmentCard` 컴포넌트 2개 렌더링:
     - SentComp: `isCompleted={completedAssessments.sentComp}`, `onStart={() => onSelect('sentComp')}`
     - WordComp: `isCompleted={completedAssessments.wordComp}`, `onStart={() => onSelect('wordComp')}`

4. **전체 완료 메시지** (조건부)
   - `completedAssessments.sentComp && completedAssessments.wordComp` 가 `true`일 때만 렌더링
   - "모든 검사가 완료되었습니다. 세션을 종료해 주세요." 메시지 표시

#### 내부 데이터 상수 (파일 내부)

```typescript
interface HubAssessmentConfig {
  id: AssessmentId;
  title: string;
  subtitle: string;
  description: string;
}

const ASSESSMENT_CONFIGS: HubAssessmentConfig[] = [
  {
    id: 'sentComp',
    title: '문장 이해',
    subtitle: 'QAB 하위검사 4번',
    description: '복잡한 구문 이해력 평가',
  },
  {
    id: 'wordComp',
    title: '단어 이해',
    subtitle: 'QAB 하위검사 3번',
    description: '단어 수준의 청각적 이해 평가',
  },
];
```

---

### 4-4. [NEW] `frontend/src/shared/hub/AssessmentCard.tsx`

#### Props 인터페이스

```typescript
interface AssessmentCardProps {
  title: string;          // 예: "문장 이해"
  subtitle: string;       // 예: "QAB 하위검사 4번"
  description: string;    // 예: "복잡한 구문 이해력 평가"
  isCompleted: boolean;
  onStart: () => void;
}
```

#### 공개 export

```typescript
export function AssessmentCard({
  title,
  subtitle,
  description,
  isCompleted,
  onStart,
}: AssessmentCardProps): React.JSX.Element
```

#### 렌더링 상태별 Tailwind 클래스

| 상태 | 카드 테두리 | 버튼 스타일 | 버튼 텍스트 |
|------|-------------|-------------|-------------|
| `isCompleted === false` | `border-blue-200` | `bg-blue-500 hover:bg-blue-600 text-white` | 시작하기 |
| `isCompleted === true` | `border-green-200 bg-green-50` | `bg-gray-200 text-gray-500 cursor-default` | 완료 |

완료 상태에서 버튼은 `disabled` 속성을 설정하지 않고 `onClick` 핸들러를 제거하여 재검사 진입을 차단한다 (완료 후 재검사는 현재 스코프 외).

완료 뱃지 렌더링:
```typescript
{isCompleted && (
  <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
    완료
  </span>
)}
```

---

## 5. 파일 구조 (변경 후)

```
frontend/src/
├── App.tsx                                          [MODIFY] 상태 및 분기 추가
├── assessments/
│   ├── loc/presentation/
│   │   ├── LocScreen.tsx                            [MODIFY] onProceed prop 추가
│   │   └── useLocViewModel.ts                       [유지]
│   ├── sentComp/presentation/
│   │   └── SentCompScreen.tsx                       [유지]
│   └── wordComp/presentation/screens/
│       └── WordComprehensionScreen.tsx              [유지]
└── shared/
    ├── session/
    │   ├── SessionContext.tsx                       [유지]
    │   └── PatientSetupScreen.tsx                   [유지]
    ├── hub/                                         [NEW 디렉터리]
    │   ├── AssessmentHubScreen.tsx                  [NEW]
    │   └── AssessmentCard.tsx                       [NEW]
    └── components/                                  [유지]
        ├── AssessmentProgressBar.tsx
        └── LoadingOverlay.tsx
```

---

## 6. 에러 처리 전략

### 6-1. 레이어별 에러 처리 분리

이 기능은 UI 흐름 제어 레이어(Presentation)만 변경한다. 도메인/애플리케이션/인프라 레이어의 에러 처리는 각 기존 ViewModel에 위임되며 변경하지 않는다.

### 6-2. App.tsx의 에러 방어

`handleSentCompComplete`, `handleWordCompComplete`에서는 받은 score/summary 타입을 강제 검증하지 않는다. 이미 각 검사의 ViewModel이 유효한 완료 상태에서만 콜백을 호출하도록 설계되어 있기 때문이다.

### 6-3. session === null 방어

`AssessmentHubScreen`은 `useSessionContext()`를 사용하므로, `App.tsx`에서 `session !== null`이 보장된 상태에서만 렌더링된다 (App.tsx의 `session === null → PatientSetupScreen` 분기가 선행 방어).

---

## 7. 테스트 전략

### 7-1. 단위 테스트 대상 및 파일 위치

```
frontend/src/
├── App.test.tsx                        [NEW] 상태 전환 로직 검증
└── shared/hub/
    ├── AssessmentHubScreen.test.tsx    [NEW] 렌더링 조건 검증
    └── AssessmentCard.test.tsx         [NEW] 완료 뱃지 및 버튼 상태 검증
```

테스트 프레임워크: **Vitest + @testing-library/react**

### 7-2. App.tsx 상태 전환 테스트

**테스트 케이스 1: LOC → 허브 전환**
```
Given: session이 존재하고 appPhase가 'LOC'인 상태에서
When:  LocScreen의 onProceed 콜백이 호출되면
Then:  appPhase가 'HUB'로 전환되어 AssessmentHubScreen이 렌더링된다
```

**테스트 케이스 2: SentComp 완료 후 허브 복귀**
```
Given: appPhase가 'SENT_COMP'이고 completedAssessments.sentComp가 false인 상태에서
When:  SentCompScreen의 onComplete 콜백이 ScoreDTO와 함께 호출되면
Then:  completedAssessments.sentComp가 true로 업데이트되고
       appPhase가 'HUB'로 전환된다
```

**테스트 케이스 3: WordComp 완료 후 허브 복귀**
```
Given: appPhase가 'WORD_COMP'이고 completedAssessments.wordComp가 false인 상태에서
When:  WordComprehensionScreen의 onComplete 콜백이 SessionSummaryDTO와 함께 호출되면
Then:  completedAssessments.wordComp가 true로 업데이트되고
       appPhase가 'HUB'로 전환된다
```

**테스트 케이스 4: 허브 → 검사 선택**
```
Given: appPhase가 'HUB'인 상태에서
When:  AssessmentHubScreen의 onSelect('sentComp') 콜백이 호출되면
Then:  appPhase가 'SENT_COMP'으로 전환된다

When:  AssessmentHubScreen의 onSelect('wordComp') 콜백이 호출되면
Then:  appPhase가 'WORD_COMP'으로 전환된다
```

**테스트 케이스 5: 세션 없음 → PatientSetupScreen**
```
Given: session이 null인 상태에서
When:  AppContent가 렌더링되면
Then:  PatientSetupScreen이 렌더링되고 LocScreen은 렌더링되지 않는다
```

### 7-3. AssessmentHubScreen 렌더링 테스트

**테스트 케이스 1: 두 검사 모두 미완료**
```
Given: completedAssessments = { sentComp: false, wordComp: false }로 렌더링될 때
When:  화면이 마운트되면
Then:  SentComp 카드와 WordComp 카드가 모두 "시작하기" 버튼을 가진다
       "모든 검사 완료" 메시지가 렌더링되지 않는다
```

**테스트 케이스 2: SentComp 완료 뱃지 표시**
```
Given: completedAssessments = { sentComp: true, wordComp: false }로 렌더링될 때
When:  화면이 마운트되면
Then:  SentComp 카드에 "완료" 뱃지가 표시된다
       WordComp 카드에는 "완료" 뱃지가 없다
       "모든 검사 완료" 메시지가 렌더링되지 않는다
```

**테스트 케이스 3: 두 검사 모두 완료 시 완료 메시지**
```
Given: completedAssessments = { sentComp: true, wordComp: true }로 렌더링될 때
When:  화면이 마운트되면
Then:  "모든 검사가 완료되었습니다" 메시지가 렌더링된다
```

**테스트 케이스 4: 검사 카드 선택 시 onSelect 호출**
```
Given: completedAssessments = { sentComp: false, wordComp: false }로 렌더링될 때
When:  SentComp 카드의 "시작하기" 버튼을 클릭하면
Then:  onSelect('sentComp')가 호출된다
```

### 7-4. AssessmentCard 단위 테스트

**테스트 케이스 1: 미완료 상태 렌더링**
```
Given: isCompleted=false로 AssessmentCard가 렌더링될 때
When:  화면이 마운트되면
Then:  "시작하기" 버튼이 렌더링된다
       "완료" 뱃지가 렌더링되지 않는다
       파란색 버튼 클래스가 적용된다
```

**테스트 케이스 2: 완료 상태 렌더링**
```
Given: isCompleted=true로 AssessmentCard가 렌더링될 때
When:  화면이 마운트되면
Then:  "완료" 뱃지가 렌더링된다
       "시작하기" 버튼 텍스트가 "완료"로 변경된다
       버튼이 비활성 스타일을 가진다
```

**테스트 케이스 3: onStart 콜백 호출**
```
Given: isCompleted=false로 AssessmentCard가 렌더링될 때
When:  "시작하기" 버튼을 클릭하면
Then:  onStart 콜백이 1회 호출된다
```

### 7-5. LocScreen onProceed 통합 테스트

**테스트 케이스: onProceed 호출 시점 검증**
```
Given: LocScreen이 onProceed mock 함수와 함께 렌더링되고
       assessmentState가 'ASSESSMENT_COMPLETE'인 상태에서
When:  "다음 검사로 이동" 버튼을 클릭하면
Then:  proceedToNextAssessment (ViewModel 초기화)가 먼저 호출되고
       이후 onProceed()가 호출된다
```

### 7-6. 테스트 더블 전략

| 대상 | 더블 종류 | 이유 |
|------|-----------|------|
| `useSessionContext()` | Mock | SessionProvider 의존성 제거, session 값 제어 필요 |
| `LocScreen` (App 테스트) | Mock (vi.mock) | 내부 TTS/UseCase 의존성 격리 |
| `SentCompScreen` (App 테스트) | Mock (vi.mock) | 내부 API 의존성 격리 |
| `WordComprehensionScreen` (App 테스트) | Mock (vi.mock) | 내부 API 의존성 격리 |
| `AssessmentHubScreen` | 실제 컴포넌트 | 순수 Props 기반 렌더링, 외부 의존성 없음 |
| `AssessmentCard` | 실제 컴포넌트 | 순수 Props 기반 렌더링, 외부 의존성 없음 |

---

## 8. SOLID 원칙 준수 점검

### S - 단일 책임 (Single Responsibility)

| 컴포넌트 | 책임 | 판정 |
|----------|------|------|
| `AppContent` | 앱 전체 흐름 상태 관리 및 화면 분기 | 통과 |
| `AssessmentHubScreen` | 허브 레이아웃 렌더링 및 선택 이벤트 위임 | 통과 |
| `AssessmentCard` | 단일 검사 카드 UI 상태 표현 | 통과 |
| `LocScreen` | LOC 검사 Composition Root + 렌더링 | 통과 (onProceed 추가 후에도 역할 변화 없음) |

### O - 개방-폐쇄 (Open-Closed)

새 검사(예: `MotorSpeech`)를 추가할 때:
- `AppPhase`에 `'MOTOR_SPEECH'` 추가
- `CompletedAssessments`에 `motorSpeech: boolean` 추가
- `AssessmentHubScreen`의 `ASSESSMENT_CONFIGS` 배열에 항목 추가
- `App.tsx`에 분기 1개 추가

기존 카드(`AssessmentCard`) 컴포넌트 수정 불필요. **부분 통과** (App.tsx 수정은 불가피하나 허브 컴포넌트는 확장에 열려 있음).

### L - 리스코프 치환 (Liskov Substitution)

`AssessmentCard`는 `isCompleted` prop만으로 두 상태를 처리하므로 치환 대상 없음. 해당 없음.

### I - 인터페이스 분리 (Interface Segregation)

`AssessmentHubScreenProps`에 불필요한 메서드 없음. `AssessmentCardProps`에 불필요한 prop 없음. **통과**.

### D - 의존성 역전 (Dependency Inversion)

- `AppContent`는 `LocScreen`, `AssessmentHubScreen`, `SentCompScreen`, `WordComprehensionScreen`의 구체 구현에 의존한다.
- 이는 Presentation 레이어 최상단 컴포넌트(Composition Root)의 의도된 설계다.
- 각 개별 검사 컴포넌트는 도메인/애플리케이션 인터페이스에 의존하므로 레이어 전체 관점에서 의존성 역전이 적용되어 있다. **통과**.

---

## 9. 위험 요소 및 주의사항

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| `noUnusedParameters` 위반 | 높음 | 컴파일 오류 | `handleSentCompComplete(_score)`, `handleWordCompComplete(_summary)` — 파라미터 앞에 `_` 접두사 사용하여 미사용 의도 명시 |
| `verbatimModuleSyntax` 위반 | 중간 | 컴파일 오류 | `ScoreDTO`, `SessionSummaryDTO` import 시 `import type` 키워드 반드시 사용 |
| `div className="App"` 래퍼 제거 | 낮음 | 스타일 깨짐 | 기존 `<div className="App">` 래퍼를 제거하고 각 화면 컴포넌트가 `min-h-screen`을 독립 관리 |
| `appPhase` 새로고침 초기화 | 낮음 | 의도된 동작 | localStorage에 저장하지 않음. 임상 검사 재시작이 안전하므로 의도된 동작 |
| SentComp `onComplete` 이중 호출 | 중간 | 중복 상태 업데이트 | `SentCompScreen` 내부 83~85번 줄에서 `onComplete?.(score)`를 직접 호출하고 있음. App.tsx의 `handleSentCompComplete`가 `setAppPhase('HUB')`를 호출하면 SentCompScreen이 언마운트되므로 중복 호출 문제 없음 |

---

## 10. 확장성 시나리오 평가

### 시나리오 1: 새 검사 추가 (예: MotorSpeech)

**변경 범위:**
- `App.tsx`: `AppPhase`에 `'MOTOR_SPEECH'` 추가, `CompletedAssessments`에 `motorSpeech: boolean` 추가, 핸들러 1개 + 분기 1개 추가
- `AssessmentHubScreen.tsx`: `ASSESSMENT_CONFIGS` 배열에 항목 1개 추가, Props 타입 확장
- `AssessmentCard.tsx`: 변경 없음

**평가:** 변경 파일이 최소화되어 있으며 기존 코드 수정 범위가 예측 가능하다.

### 시나리오 2: LOC 결과를 허브에서 표시

**변경 범위:**
- `App.tsx`: `handleLocComplete`에서 `locResultId` 상태 저장 추가
- `AssessmentHubScreen.tsx`: `locResultId?: string` prop 추가 및 LOC 완료 배너에 점수 표시 추가

**평가:** `handleLocComplete`가 이미 `resultId`를 수신하므로 상태 추가 외 구조 변경 없음.

### 시나리오 3: 검사 순서 강제 (WordComp 먼저 완료 후 SentComp 활성화)

**변경 범위:**
- `AssessmentHubScreen.tsx`의 카드 활성화 조건 로직 추가
- `AssessmentCard.tsx`에 `isDisabled?: boolean` prop 추가

**평가:** 현재 설계에서 카드 활성화 여부는 `isCompleted`만 기준으로 하므로, `isDisabled` prop 확장이 필요하다. 구조 변경은 최소화된다.

---

## 11. 구현 체크리스트

```
## Assessment Flow 구현 체크리스트

### Presentation Layer — 신규 컴포넌트

- [ ] [쉬움] AssessmentCard.tsx 신규 구현
  - [ ] AssessmentCardProps 인터페이스 정의
  - [ ] isCompleted=false: 파란 테두리 + "시작하기" 버튼
  - [ ] isCompleted=true: 초록 테두리 + "완료" 뱃지 + 비활성 버튼
  - [ ] onStart 콜백 연결

- [ ] [보통] AssessmentHubScreen.tsx 신규 구현
  - [ ] AssessmentHubScreenProps 인터페이스 정의
  - [ ] ASSESSMENT_CONFIGS 상수 정의
  - [ ] useSessionContext()로 patientId, endSession 획득
  - [ ] 헤더 (환자 ID + 세션 종료 버튼)
  - [ ] LOC 완료 배너 (비활성 표시)
  - [ ] AssessmentCard 목록 렌더링 (×2)
  - [ ] 전체 완료 메시지 (조건부)

### Presentation Layer — 기존 파일 수정

- [ ] [쉬움] LocScreen.tsx 수정
  - [ ] LocScreenProps에 onProceed?: () => void 추가 (25~27번 줄)
  - [ ] 함수 시그니처에 onProceed 구조분해 추가 (58번 줄)
  - [ ] "다음 검사로 이동" 버튼 onClick에 onProceed?.() 추가 (197~203번 줄)

- [ ] [보통] App.tsx 수정
  - [ ] AppPhase, AssessmentId, CompletedAssessments 타입 정의
  - [ ] useState로 appPhase, completedAssessments 상태 추가
  - [ ] 5개 핸들러 구현 (handleLocComplete, handleLocProceed, handleHubSelect,
        handleSentCompComplete, handleWordCompComplete)
  - [ ] appPhase 기반 조건부 렌더링 분기 구현
  - [ ] ScoreDTO, SessionSummaryDTO import type 추가
  - [ ] AssessmentHubScreen, SentCompScreen, WordComprehensionScreen import 추가

### Tests

- [ ] [쉬움] AssessmentCard.test.tsx — 3개 케이스
- [ ] [보통] AssessmentHubScreen.test.tsx — 4개 케이스
- [ ] [보통] App.test.tsx — 5개 케이스 (상태 전환)
- [ ] [보통] LocScreen onProceed 통합 테스트 — 1개 케이스
```

---

## 12. User Review Required (미결 결정 사항)

### 12-1. `div className="App"` 래퍼 처리

현재 `App.tsx` 17번 줄:
```tsx
return (
  <div className="App">
    <LocScreen onComplete={handleLocComplete} />
  </div>
);
```

변경 후 각 화면 컴포넌트(`LocScreen`, `AssessmentHubScreen` 등)가 `min-h-screen`을 독립 관리하므로, 이 `<div className="App">` 래퍼를 제거하고 화면 컴포넌트를 직접 반환하는 것이 자연스럽다.

**확인 필요:** `App` 또는 `AppContent` 수준에서 전역 CSS 적용이 필요한 경우가 있는지 확인.

### 12-2. 완료된 검사의 재진입 허용 여부

현재 설계에서 `isCompleted=true` 상태의 카드 버튼은 비활성 처리한다. "다시 하기" 버튼을 제공할 경우 `completedAssessments`를 해당 검사에 대해 `false`로 재설정하고 해당 phase로 전환하는 핸들러가 필요하다.

**확인 필요:** 임상 현장에서 재검사가 필요한 상황이 있는지 여부.

### 12-3. `handleSentCompComplete`의 `_score` 파라미터 활용 계획

현재 설계에서는 `_score`를 받아 버리고 `sentComp: true`만 설정한다. 향후 LOC 점수처럼 허브에서 요약 표시가 필요한 경우 `lastSentCompScore` 상태를 추가해야 한다.

**확인 필요:** 허브 화면에서 이전 검사 점수를 표시할 요구사항이 있는지 여부.
