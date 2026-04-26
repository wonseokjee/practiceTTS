# QAB 6. 따라말하기 (Repetition) 기능 - 클린 아키텍처 리팩토링 완료

> [!TIP]
> **설계 원칙 적용 완수**
> 개발자님의 요청에 따라 `feature-architect.md` 설계 원칙을 준수하여, QAB 6. 따라말하기 검사가 **도메인 주도 설계(DDD) 및 클린 아키텍처**로 완전히 리팩토링 되었습니다. 

## 주요 레이어 분리 결과

### 1. Domain Layer (`domain/`)
- 외부 프레임워크나 브라우저 종속성이 없는 순수 비즈니스 레이어.
- `RepetitionTypes.ts` 내에 `IRepetitionResultRepository`, `IRepetitionItemRepository` 등 의존성 역전을 위한 추상화 인터페이스를 정의했습니다.
- `werCalculator.ts` 도메인 서비스가 순수 계산 로직으로서 안전하게 격리되었습니다.

### 2. Application Layer (`application/`)
- `SubmitRepetitionAnswerUseCase.ts`: 환자의 STT 응답을 도메인에 넘겨 채점하고, 그 결과를 영속성 계층(Repository)에 저장을 위임하는 단일 책임 비즈니스 흐름을 구현했습니다.
- `LoadRepetitionItemsUseCase.ts`: 정렬된 순서대로 평가 문항을 불러오는 독립적인 유스케이스입니다.
- `errors.ts`: 도메인과 애플리케이션 계층 전용 에러(`RepetitionError`)를 클래스의 형태로 계층화했습니다.

### 3. Infrastructure Layer (`infrastructure/`)
- 도메인의 인터페이스를 구현하는 외부 어댑터 레이어입니다.
- `JsonRepetitionItemRepository.ts`: 정적 JSON 데이터를 네트워크 지연을 흉내내어 비동기로 페칭하는 시뮬레이션 구현체입니다.
- `LocalStorageRepetitionResultRepository.ts`: Session ID별로 로컬 스토리지에 데이터를 안전하게 CRUD하는 구현체입니다. (차후 Azure DB 등으로 가장 쉽게 교체되는 지점입니다.)

### 4. Presentation Layer (`presentation/`)
- `useRepetitionViewModel.ts`: 계산 로직이나 저장 로직을 직접 수행하지 않으며, DI(의존성 주입)를 통해 UseCase들을 컴포지트하여 실행(호출)만 하도록 격리되었습니다.
- 상태 머신(`LOADING` → `PLAYING` → `RECORDING` → `SCORING` → `COMPLETED`) 관리는 오로지 UI 진행 관리 용도로만 축소되어 책임이 가벼워졌습니다.

## 테스트 커버리지 확대 (UI 의존성 탈피)
- 기존에는 UI 화면과 강하게 결합되어 있던 점수 계산과 저장 로직이 분리되었습니다.
- `SubmitRepetitionAnswerUseCase.test.ts` 에서 Mock Repository를 주입하여, **리액트 컴포넌트나 브라우저 구동 없이 오로지 비즈니스 로직(STT 처리, WER 변환, DB 저장 처리 확인)만을 100% 테스트** 할 수 있는 단위 테스트 환경을 구축 완료했습니다.
