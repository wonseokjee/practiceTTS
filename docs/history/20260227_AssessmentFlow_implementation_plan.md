# QAB 검사 흐름(Assessment Flow) 구현 계획

> 작성일: 2026-02-27
> 참조 문서: `docs/history/implementation_plan.md`, `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

---

## 1. 목표 및 배경

현재 `App.tsx`는 세션 로그인 후 `LocScreen`만 단순 렌더링하는 임시 구조다. 이 구현 계획은 다음의 완전한 검사 흐름을 갖추는 것을 목표로 한다.

- 환자 ID 입력 → LOC 검사(필수 선행) → 검사 허브(Assessment Hub) → 개별 검사 선택 및 완료 → 허브 복귀

---

## 2. 확정된 요구사항 요약

| # | 요구사항 | 세부 내용 |
|---|----------|-----------|
| 1 | 환자 ID 입력 | 기존 `PatientSetupScreen` 재사용, 세션 생성 후 LOC로 자동 진입 |
| 2 | LOC 필수 선행 | 세션 생성 직후 항상 LOC 검사 실행, 완료 전 허브 진입 불가 |
| 3 | 검사 허브 | LOC 완료 후 SentComp, WordComp를 카드 형태로 선택 가능한 허브 화면 |
| 4 | 완료 뱃지 | 각 검사 완료 후 허브 복귀, 완료된 검사는 완료 뱃지 표시 |
| 5 | 세션 종료 | 언제든 접근 가능한 세션 종료 버튼 |

**대상 플랫폼:** 웹 앱 (React + TypeScript)
**대상 사용자:** 언어치료사, 검사 보조자

---

## 3. 화면 전환 상태 다이어그램

```
[앱 시작]
    |
    v
[PatientSetupScreen]  ← session === null
    |  환자 ID 입력 + 검사 시작 버튼 클릭
    v
[LocScreen]           ← appPhase === 'LOC'
    |  LOC 검사 완료 (onComplete 콜백 호출)
    v
[AssessmentHubScreen] ← appPhase === 'HUB'
    |  카드 선택
    +--[SentComp 카드 클릭]--> [SentCompScreen] ← appPhase === 'SENT_COMP'
    |                              | 완료
    |                              v
    |                          [AssessmentHubScreen] (SentComp 완료 뱃지)
    |
    +--[WordComp 카드 클릭]--> [WordComprehensionScreen] ← appPhase === 'WORD_COMP'
                                   | 완료
                                   v
                               [AssessmentHubScreen] (WordComp 완료 뱃지)

* 세션 종료 버튼: 모든 화면에서 접근 가능 → PatientSetupScreen으로 초기화
```

---

## 4. User Review Required

> **중요 결정 사항 — 구현 전 반드시 확인**

### 4-1. LOC 완료 결과 처리 방식
- `LocScreen`의 `onComplete(resultId: string)` 콜백은 `resultId`(문자열)만 반환한다.
- 현재 `proceedToNextAssessment` 액션(LocViewModel 내부)이 상태를 초기화만 하고 있다.
- **결정 필요:** LOC 완료 후 허브 전환 트리거를 `onComplete` 콜백 내부에서 처리할지, `proceedToNextAssessment` 내부에서 처리할지.
  - (권장안) `onComplete` 콜백에서 `appPhase`를 `'HUB'`로 전환한다. `LocScreen` 내부는 수정하지 않는다.

### 4-2. Zustand store vs React 상태 판단

**결론: React 상태(`useState`)만으로 충분하다.**

근거:
- 앱 흐름 상태(`appPhase`)는 `App.tsx` 단 하나의 컴포넌트에서 관리되며 자식으로 prop drilling 없이 전달 가능하다.
- 검사 완료 여부(`completedAssessments`) 역시 허브 화면(AssessmentHubScreen)에만 필요하다.
- SessionContext(이미 존재)가 세션 정보를 전담하고 있으므로 추가 전역 스토어는 불필요하다.
- Zustand는 여러 컴포넌트가 동일 상태를 구독해야 할 때 유효하나, 현재 흐름은 단방향 순차 흐름이므로 오버엔지니어링이 된다.

### 4-3. LOC "다음 검사로 이동" 버튼 처리
- 현재 `LocScreen`의 `ASSESSMENT_COMPLETE` 상태에서 "다음 검사로 이동" 버튼이 `proceedToNextAssessment`를 호출하고 상태를 초기화한다.
- **결정 필요:** 이 버튼을 클릭했을 때 App 레벨 흐름도 함께 변경되어야 한다.
  - (권장안) `LocScreen`의 `proceedToNextAssessment`는 그대로 두고, `onComplete` 콜백이 이미 허브 전환을 실행한 상태이므로 버튼 클릭 시점에 이미 허브가 렌더링되어 있다. 즉, LOC 검사 완료 시점(`ASSESSMENT_COMPLETE` 진입 + `onComplete` 호출)에 바로 허브로 전환한다.
  - 단, 이렇게 하면 LOC 완료 결과 화면(점수 확인)을 못 보고 허브로 넘어갈 수 있다. "다음 검사로 이동" 버튼을 클릭했을 때 허브로 전환하는 방식이 UX상 자연스럽다.
  - **(최종 권장안)** `onComplete`에서 App 레벨 플래그(`locCompleted`)만 `true`로 설정, "다음 검사로 이동" 버튼(`proceedToNextAssessment`) 호출 시 `appPhase`를 `'HUB'`로 전환한다. → `LocScreen`에 `onProceed` prop 추가 필요.

---

## 5. 아키텍처 설계

### 5-1. App 레벨 상태 설계

```typescript
// App.tsx 내부 AppContent 컴포넌트의 상태

type AppPhase =
  | 'LOC'           // LOC 검사 (세션 생성 직후)
  | 'HUB'           // 검사 허브
  | 'SENT_COMP'     // 문장 이해 검사 진행 중
  | 'WORD_COMP';    // 단어 이해 검사 진행 중

type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}

// 상태
const [appPhase, setAppPhase] = useState<AppPhase>('LOC');
const [completedAssessments, setCompletedAssessments] = useState<CompletedAssessments>({
  sentComp: false,
  wordComp: false,
});
```

### 5-2. 화면 렌더링 분기 (App.tsx AppContent)

```typescript
// session === null → PatientSetupScreen (기존 유지)

// session !== null:
if (appPhase === 'LOC') return <LocScreen onComplete={...} onProceed={...} />;
if (appPhase === 'HUB') return <AssessmentHubScreen ... />;
if (appPhase === 'SENT_COMP') return <SentCompScreen onComplete={...} />;
if (appPhase === 'WORD_COMP') return <WordComprehensionScreen onComplete={...} />;
```

### 5-3. 콜백 흐름

```
LocScreen.onComplete(resultId)
  → AppContent: locCompleted = true (내부 플래그, 옵션)

LocScreen.onProceed()         ← "다음 검사로 이동" 버튼
  → AppContent: setAppPhase('HUB')

AssessmentHubScreen.onSelect('sentComp')
  → AppContent: setAppPhase('SENT_COMP')

SentCompScreen.onComplete(score)
  → AppContent: setCompletedAssessments({ ...prev, sentComp: true })
               setAppPhase('HUB')

AssessmentHubScreen.onSelect('wordComp')
  → AppContent: setAppPhase('WORD_COMP')

WordComprehensionScreen.onComplete(summary)
  → AppContent: setCompletedAssessments({ ...prev, wordComp: true })
               setAppPhase('HUB')
```

---

## 6. 컴포넌트별 Proposed Changes

### 파일 변경 목록

```
frontend/src/
├── App.tsx                                          [MODIFY] 검사 흐름 상태 및 분기 로직 추가
├── assessments/
│   └── loc/presentation/
│       └── LocScreen.tsx                            [MODIFY] onProceed prop 추가
└── shared/
    └── hub/
        ├── AssessmentHubScreen.tsx                  [NEW]    검사 허브 화면
        └── AssessmentCard.tsx                       [NEW]    개별 검사 카드 컴포넌트
```

---

### [MODIFY] `frontend/src/App.tsx`

**변경 내용:**
- `AppContent` 내에 `appPhase: AppPhase` 상태 추가
- `completedAssessments` 상태 추가
- `handleLocComplete`: `resultId` 기록용 (필요 시 확장)
- `handleLocProceed`: `setAppPhase('HUB')` 호출
- `handleHubSelect(id: AssessmentId)`: 해당 검사 phase로 전환
- `handleSentCompComplete`: 완료 뱃지 업데이트 + HUB 복귀
- `handleWordCompComplete`: 완료 뱃지 업데이트 + HUB 복귀
- 렌더링 분기: `appPhase`에 따라 화면 조건부 렌더링

**변경 전후 비교:**
```typescript
// Before
return <LocScreen onComplete={handleLocComplete} />;

// After
if (appPhase === 'LOC') return <LocScreen onComplete={handleLocComplete} onProceed={handleLocProceed} />;
if (appPhase === 'HUB') return <AssessmentHubScreen completedAssessments={completedAssessments} onSelect={handleHubSelect} />;
if (appPhase === 'SENT_COMP') return <SentCompScreen onComplete={handleSentCompComplete} />;
if (appPhase === 'WORD_COMP') return <WordComprehensionScreen onComplete={handleWordCompComplete} />;
```

---

### [MODIFY] `frontend/src/assessments/loc/presentation/LocScreen.tsx`

**변경 내용:**
- `LocScreenProps`에 `onProceed?: () => void` prop 추가
- "다음 검사로 이동" 버튼의 `onClick`에서 `actions.proceedToNextAssessment()` 호출 후 `onProceed?.()` 호출

**변경 전후 비교:**
```typescript
// Before
interface LocScreenProps {
  onComplete?: (resultId: string) => void;
}

// After
interface LocScreenProps {
  onComplete?: (resultId: string) => void;
  onProceed?: () => void;
}

// 버튼 클릭 핸들러 변경
onClick={() => {
  actions.proceedToNextAssessment();
  onProceed?.();
}}
```

---

### [NEW] `frontend/src/shared/hub/AssessmentHubScreen.tsx`

**역할:** LOC 완료 후 진입하는 검사 선택 허브 화면

**Props 인터페이스:**
```typescript
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

**UI 구성:**
```
┌─────────────────────────────────────────┐
│  QAB 검사 허브                  [세션종료] │  ← 헤더 (환자 ID 표시)
│  환자: P-2026-001                         │
├─────────────────────────────────────────┤
│                                           │
│  LOC 검사 완료 ✓ (배경 회색, 비활성)       │  ← 완료된 LOC 표시 (선택 불가)
│                                           │
│  ┌──────────────────┐ ┌────────────────┐  │
│  │  문장 이해        │ │  단어 이해      │  │  ← 선택 가능한 검사 카드
│  │  SentComp        │ │  WordComp      │  │
│  │  검사 4          │ │  검사 3        │  │
│  │                  │ │                │  │
│  │  [시작하기]       │ │  [시작하기]    │  │  ← 미완료: 파란 버튼
│  └──────────────────┘ └────────────────┘  │  ← 완료 시: "완료 ✓" 뱃지 표시
│                                           │
└─────────────────────────────────────────┘
```

**렌더링 로직:**
- `completedAssessments.sentComp === true` → SentComp 카드에 완료 뱃지, 버튼 비활성화 또는 "재검사" 표시
- `completedAssessments.wordComp === true` → WordComp 카드에 완료 뱃지 표시
- 모든 검사 완료 시 "모든 검사 완료" 메시지 표시 (세션 종료 유도)

---

### [NEW] `frontend/src/shared/hub/AssessmentCard.tsx`

**역할:** 허브 화면의 개별 검사 카드 UI 컴포넌트

**Props 인터페이스:**
```typescript
interface AssessmentCardProps {
  title: string;          // "문장 이해"
  subtitle: string;       // "QAB 검사 4번"
  description: string;    // "복잡한 구문 이해력 평가"
  isCompleted: boolean;
  onStart: () => void;
}
```

**UI 상태:**
- `isCompleted === false`: 파란 테두리, "시작하기" 버튼 (파란색)
- `isCompleted === true`: 초록 테두리, "완료 ✓" 뱃지, "다시 하기" 버튼 (회색)

---

## 7. 기술 스택 및 의존성

| 항목 | 결정 | 근거 |
|------|------|------|
| 상태 관리 | React `useState` (App.tsx 로컬) | 단방향 순차 흐름, 전역 공유 불필요, Zustand 오버엔지니어링 |
| 세션 관리 | 기존 `SessionContext` 재사용 | 이미 구현 완료, localStorage 영속화 포함 |
| 라우팅 | 없음 (조건부 렌더링) | React Router 미도입 상태, URL 기반 네비게이션 불필요 |
| UI | Tailwind CSS | 기존 프로젝트 설정 유지 |
| 새 의존성 | 없음 | 신규 패키지 설치 불필요 |

---

## 8. 파일/폴더 구조 (변경 후)

```
frontend/src/
├── App.tsx                                  [MODIFY]
├── assessments/
│   ├── loc/presentation/
│   │   ├── LocScreen.tsx                    [MODIFY] onProceed prop 추가
│   │   └── useLocViewModel.ts               [유지]
│   ├── wordComp/presentation/screens/
│   │   └── WordComprehensionScreen.tsx      [유지]
│   └── sentComp/presentation/
│       └── SentCompScreen.tsx               [유지]
└── shared/
    ├── session/
    │   ├── SessionContext.tsx               [유지]
    │   └── PatientSetupScreen.tsx           [유지]
    └── hub/                                 [NEW 디렉터리]
        ├── AssessmentHubScreen.tsx          [NEW]
        └── AssessmentCard.tsx              [NEW]
```

---

## 9. 구현 작업 체크리스트 (task.md용)

```
- [ ] [쉬움] 1. App.tsx 리팩토링
  - [ ] AppPhase 타입 정의 (LOC | HUB | SENT_COMP | WORD_COMP)
  - [ ] CompletedAssessments 타입 및 초기 상태 추가
  - [ ] 각 검사 완료 콜백 핸들러 구현
  - [ ] appPhase 기반 조건부 렌더링 분기 구현

- [ ] [쉬움] 2. LocScreen.tsx 수정
  - [ ] LocScreenProps에 onProceed prop 추가
  - [ ] "다음 검사로 이동" 버튼 onClick에 onProceed 호출 추가

- [ ] [보통] 3. AssessmentHubScreen.tsx 신규 구현
  - [ ] 헤더 (환자 ID, 세션 종료 버튼)
  - [ ] 검사 카드 목록 렌더링 (SentComp, WordComp)
  - [ ] LOC 완료 표시 영역 (비활성)
  - [ ] 모든 검사 완료 시 완료 메시지

- [ ] [쉬움] 4. AssessmentCard.tsx 신규 구현
  - [ ] 카드 UI (완료/미완료 상태 구분)
  - [ ] 완료 뱃지 렌더링
  - [ ] 시작/다시하기 버튼
```

---

## 10. Verification Plan

### 자동화 테스트 (Vitest)

```bash
# 프론트엔드 테스트 실행
cd c:/AI/practiveTTS/frontend
npm test
```

**테스트 대상:**
- `App.tsx`의 `appPhase` 상태 전환 로직 단위 테스트
- `AssessmentHubScreen` 렌더링 테스트 (completedAssessments prop에 따른 UI 변화)
- `AssessmentCard` 완료 뱃지 표시 여부 테스트

### 수동 검증 절차

1. **기본 흐름 검증**
   - [ ] 앱 실행 → PatientSetupScreen 표시 확인
   - [ ] 환자 ID 입력 후 "검사 시작" → LocScreen 자동 진입 확인
   - [ ] LOC 검사 완료 후 "다음 검사로 이동" → AssessmentHubScreen 진입 확인
   - [ ] 허브에서 "문장 이해" 선택 → SentCompScreen 진입 확인
   - [ ] SentComp 완료 → 허브 복귀 + SentComp 완료 뱃지 표시 확인
   - [ ] 허브에서 "단어 이해" 선택 → WordComprehensionScreen 진입 확인
   - [ ] WordComp 완료 → 허브 복귀 + WordComp 완료 뱃지 표시 확인

2. **세션 종료 검증**
   - [ ] LOC 화면에서 세션 종료 → PatientSetupScreen 복귀 확인
   - [ ] 허브 화면에서 세션 종료 → PatientSetupScreen 복귀 확인
   - [ ] 개별 검사 화면에서 세션 종료 → PatientSetupScreen 복귀 확인

3. **상태 유지 검증**
   - [ ] SentComp 완료 후 허브 복귀 시 완료 뱃지 유지 확인
   - [ ] 페이지 새로고침 후 세션 복원(localStorage) 동작 확인
   - [ ] 새로고침 시 appPhase 초기화(LOC로 재시작) 동작 확인

4. **엣지 케이스**
   - [ ] LOC 완료 전 URL 직접 접근 시도(해당 없음, 라우터 미사용이므로 자동 방어됨)
   - [ ] 세션 없는 상태에서 앱 진입 → PatientSetupScreen 표시 확인

---

## 11. 위험 요소 및 주의사항

| 위험 | 설명 | 대응 방안 |
|------|------|-----------|
| LocScreen 수정 최소화 | onProceed prop 추가 외 기존 로직 변경 금지 | 기존 ViewModel, UseCase 코드 무수정 |
| appPhase 새로고침 초기화 | localStorage에 appPhase를 저장하지 않으므로 새로고침 시 LOC 재시작 | 의도된 동작(임상 검사 특성상 재시작이 안전) |
| SentComp/WordComp onComplete 타입 불일치 | 두 검사의 onComplete 시그니처가 다름 (ScoreDTO vs SessionSummaryDTO) | App.tsx에서 각 타입을 개별 핸들러로 수용 |
| 완료 후 재검사 허용 여부 | 완료된 검사를 다시 시작할 수 있게 할지 여부 | AssessmentCard에 "다시 하기" 버튼 제공, completedAssessments 초기화 허용 |
