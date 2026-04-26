# QAB 6. 따라말하기 (Repetition) Feature Plan

> 문서 작성일: 2026-03-29
> 관련 기획: `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

## 1. 목표 및 배경
단순한 MVP 차원의 스크립트 작성에서 벗어나, `feature-architect` 에이전트의 원칙에 따라 "QAB 6. 따라말하기" 평가 기능을 **도메인 중심의 클린 아키텍처(Clean Architecture)** 로 전면 재설계합니다. 이를 통해 향후 STT 엔진(Web Speech API → Azure STT), 저장소(LocalStorage → Backend DB)로의 교체를 유연하게 지원하고 단위 테스트가 용이한 앱 구조를 확립합니다.

---

## 2. 도메인 모델 (Domain Layer)

### 2-1. 엔티티 (Entity) 및 값 객체 (Value Object)
- **`RepetitionItem` (Value Object)**
  - 필드: `itemId`, `orderIndex`, `stimulusText`, `sentenceAudioUrl`
  - 불변 객체: 특정 문항의 고정된 내용
- **`RepetitionResult` (Entity)**
  - 필드: `itemId`, `stimulusText`, `sttOutput`, `wer(Word Error Rate)`, `score(0|1|2)`, `reactionTimeMs`
  - 의미: 환자가 특정 문항에 응답한 결과
- **`WERCalculator` (Domain Service)**
  - 역할: `stimulusText`와 `sttOutput`을 받아 Levenshtein 거리 기반으로 단어 오류 비율(WER)을 계산하는 순수 수학/비즈니스 함수

### 2-2. 유스케이스 명세 (Use Case)

**SubmitRepetitionAnswerUseCase**
- **Actor:** 환자(시스템)
- **사전 조건:** 오디오 인식이 완료되어 `sttOutput` 문자열이 확보됨
- **정상 흐름:**
  1. `sttOutput`과 원본 `stimulusText`를 `WERCalculator`에 전달
  2. `score(0, 1, 2점)` 산출
  3. `RepetitionResult` 엔티티 생성
  4. `IRepetitionResultRepository`를 통해 로컬 저장 (결과 보존)
- **예외 흐름:**
  - `sttOutput`이 null/empty일 경우, 무반응 오류 처리(0점)
- **사후 조건:** 해당 문항에 대한 채점 결과가 시스템에 영구 보존됨

### 2-3. 레포지토리 인터페이스 정의
```typescript
interface IRepetitionItemRepository {
  loadItems(): Promise<RepetitionItem[]>;
  getItemById(id: string): Promise<RepetitionItem | null>;
}

interface IRepetitionResultRepository {
  saveResult(result: RepetitionResult): Promise<void>;
  getResultsBySession(sessionId: string): Promise<RepetitionResult[]>;
}
```

---

## 3. 클린 아키텍처 레이어 설계

### 3-1. Domain Layer
- 비즈니스 룰, 엔티티, 외부 의존성(인터페이스) 선언 영역.
- React, 외부 API, 브라우저 스펙에 전혀 의존하지 않는 순수 TypeScript 객체.

### 3-2. Application Layer (Usecases, DTOs)
- 파일: `SubmitRepetitionAnswerUseCase.ts`, `LoadRepetitionItemsUseCase.ts`
- 도메인 인터페이스를 조합하여 뷰 모델이 호출할 수 있는 비즈니스 흐름 생성
- 에러 처리: `RepetitionError` 클래스화 (ex. `STT_FAILED`, `SAVE_FAILED`)

### 3-3. Infrastructure Layer
- 파일: `JsonRepetitionItemRepository.ts` (정적 JSON 로드)
- 파일: `LocalStorageRepetitionResultRepository.ts` (로컬스토리지 저장)
- 외부 의존성 래핑: 향후 Azure STT 연결을 대비해 인프라 단에서 `ISpeechRecognitionService` 인터페이스의 구현체 추가 가능성 고려

### 3-4. Presentation Layer
- 파일: `useRepetitionViewModel.ts`
  - 역할: FSM 상태 통제 (`LOADING`, `PLAYING`, `RECORDING`, `SCORING`, `COMPLETED`), Use Case 실행, DTO 변환
- 파일: `RepetitionScreen.tsx`
  - 역할: 상태를 입력받아 조건부 UI(순수 컴포넌트)만 렌더링

---

## 4. 의존성 다이어그램

```text
RepetitionScreen (View)
  └── useRepetitionViewModel (Hook - 상태 관리)
        ├── LoadRepetitionItemsUseCase
        │     └── IRepetitionItemRepository ←← JsonRepetitionItemRepository (Impl)
        │
        └── SubmitRepetitionAnswerUseCase
              ├── WERCalculator (Domain Logic)
              └── IRepetitionResultRepository ←← LocalStorageRepetitionResultRepository (Impl)
```

---

## 5. 테스트 전략 (Testing Strategy)

### 5-1. 단위 테스트 (Unit Test) - 커버리지 100% 목표
- **대상:** `WERCalculator.test.ts`, `SubmitRepetitionAnswerUseCase.test.ts`
- **전략:** 외부 저장소는 Mock/Stub로 주입하고, UseCase가 정상적으로 점수를 환산하여 Save()를 호출하는지 검증
- **예시 (Given-When-Then):**
  - *Given*: 완벽히 일치하는 STT 문자열이 주어졌을 때
  - *When*: `SubmitRepetitionAnswerUseCase`를 실행하면
  - *Then*: WER가 0점으로 산출되고, Repository의 `saveResult`가 Score=2 값으로 호출되어야 한다.

### 5-2. 통합/E2E 테스트 접근 방식
- **대상:** `LocalStorageRepetitionResultRepository`
- **전략:** 실제 로컬스토리지 환경(jsdom)에서 데이터가 직렬화/역직렬화 되어 저장되는지 확인

---

## 6. 확장성 시나리오 평가 및 SOLID 점검
- **S (단일 책임):** ViewModel은 상태관리만, UseCase는 흐름 제어만, Calculator는 연산만 분리됨.
- **O (개방-폐쇄):** STT 엔진이 바뀌거나 DB가 바뀌어도 Domain/Application은 한 줄도 변경되지 않음. 인터페이스의 새 구현체만 생성하면 됨.
- **D (의존성 역전):** UseCase 모듈은 `LocalStorage`를 직접 참조하지 않고 `IRepetitionResultRepository` 인터페이스만 본다. (준수 완료)

---

## 7. Open Questions & User Review Required

> [!CAUTION]
> **User Review Required**
> 본 프로젝트의 클린 아키텍처 패턴을 온전히 적용하면 폴더 구조와 파일이 상당히 많아지며(Repository 구현, UseCase 클래스 등), 기존에 임시 작성한 MVP 레벨의 `RepetitionScreen.tsx` 등의 로직을 전부 UseCase 호출 방식으로 구조를 변경해야 합니다.
> 
> **질문:**
> 현재 작성된 MVP 코드를 전부 폐기(또는 수정)하고 위 클린 아키텍처 설계에 맞춰 도메인 → 애플리케이션 → 인프라 → 프레젠테이션 순서로 코드를 다시 작성/리팩토링 해도 될까요? 승인해주시면 리팩토링 및 파일 작성을 시작합니다.
