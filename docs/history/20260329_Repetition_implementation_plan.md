# QAB 6. 따라말하기 (Repetition) 구현 계획

> 문서 작성일: 2026-03-29
> 관련 기획: `docs/history/20260223_LLM없이구현가능한검사_implementation_plan.md`

## 개요
환자가 들은 단어 또는 문장을 듣고 그대로 따라 말하게 하여 음운 부호화 및 청각-운동 통합 능력을 평가합니다. LLM에 의존하지 않고 STT(Speech-to-Text)와 WER(Word Error Rate) 비교 알고리즘을 사용하여 독립적으로 동작합니다.

> [!IMPORTANT]
> **User Review Required**
> 1. **STT 엔진 선택:** 기획서(`wsji9-unknown-design-20260327-201318.md`)에 따르면 뇌졸중 환자의 구음장애(dysarthria) 특성상 **Azure STT (ko-KR)** 가 권장됩니다. 이번 구현에서 바로 Azure API를 연동할지, 개발 편의성을 위해 1차적으로 브라우저 Web Speech API로 구현 후 성능에 따라 교체할지 결정이 필요합니다.
> 2. **검사 문항 세트:** 단어 10문항, 문장 10문항의 오디오(TTS) 에셋이 필요합니다. 이 오디오 파일들을 앱 내부 정적 자산(`assets/`)으로 포함시킬지, 백엔드에서 실시간 생성하여 가져올지 확정이 필요합니다.

---

## Proposed Changes

### 1. Presentation 계층 (UI & 상태 관리)

#### [NEW] `frontend/src/assessments/repetition/presentation/RepetitionScreen.tsx`
- **역할:** "STEP 1: 듣기"와 "STEP 2: 따라말하기" 페이즈 전환에 따른 렌더링을 담당합니다.
- **UI 요소:** 오디오 중심의 고대비 화면. 녹음 대기 중 타이머(진행 바)와 VAD(음성 감지) 상태 시각화.
- **인터랙션:** 환자의 수동 조작(버튼 터치) 없이 타이머와 오디오 이벤트에 의해 자동으로 페이즈가 순환됩니다.

#### [NEW] `frontend/src/assessments/repetition/presentation/useRepetitionViewModel.ts`
- **역할:** 비즈니스 로직과 UI 상태를 분리하는 ViewModel.
- **주요 상태:** 현재 문항 정보, 진행 단계(`playing`, `recording`, `scoring`(STT 분석 중)), 남은 시간 등.
- **주요 동작:** 
  - **하이브리드 타이머 통제 (Issue 2A 반영):** 최대 15초 제한 시간 + 발화 중 5초 지속 침묵(Silence) 시 조기 종료 지원.
  - VAD 기반 녹음 시작/중지 제어, STT 결과 수신 후 `cerCalculator` 호출 및 채점 저장.
  - **분석 중 안전장치 (Issue 3A 반영):** STT 대기 중 중복 터치를 막는 로딩("분석 중...") 블로킹 처리.

### 2. Domain / Infrastructure 계층 (채점 로직)

#### [NEW] `frontend/src/assessments/repetition/domain/cerCalculator.ts`
- **역할:** STT로 변환된 발화 텍스트와 정답 텍스트의 특수기호/공백을 100% 제거(정규화)한 후 글자 단위(Character)로 비교합니다. (Issue 1A 반영)
- **알고리즘 (글자 단위 Levenshtein 거리 활용):** 
  - `Character Error Rate(CER)` 계산: `(Substitutions + Deletions + Insertions) / Total Characters`
  - 채점 기준: `CER == 0` (2점: 완벽 반복), `CER <= 0.25` (1점: 경미한 오류), 그 외 (0점: 심각한 오류)

#### [NEW] `frontend/src/assessments/repetition/domain/RepetitionTypes.ts`
- **역할:** 결과 저장용 인터페이스 선언 (`RepetitionResult`, `StimulusItem` 등).

### 3. Shared 계층 (공통 훅)

#### [MODIFY] `frontend/src/shared/hooks/useVAD.ts`
- **역할:** 발화 시작 및 종료를 감지하기 위한 Voice Activity Detection 로직의 보완.
- **구현:** Web Audio API 기반 오디오 에너지 측정 시 메인 스레드 부하를 줄이기 위해 연산 주기(Throttling)를 100ms로 제한합니다. (Issue 3A 반영)

---

## 🏆 엔진 리뷰 요약 (Review Readiness)
- [x] **Scope:** 단일 `Repetition` 모듈로 개발 안정성 확보 (완료)
- [x] **Architecture:** 띄어쓰기 한계를 극복한 글자 단위(CER) 정규화 채점으로 치명적 채점 오차 방지 보장
- [x] **Code Quality:** 긴 침묵(5초)에 대한 배려를 상태 수명주기에 완벽히 포함한 하이브리드 제어
- [x] **Performance:** VAD 100ms 과부하 제한 및 STT 로딩 블로킹 UI 추가
- [x] **Test Review:** 11개 분기점 커버리지의 TDD 접근 확립

## Verification Plan

### Automated Tests
- `werCalculator.test.ts`를 작성하여 다양한 삽입, 삭제, 대치 케이스별로 WER 수치와 점수가 올바르게 환산되는지 단위 테스트 진행 (Jest/Vitest).

### Manual Verification
- 실제 마이크 접근 권한을 허용하고 앱을 구동합니다.
- 제시된 TTS 문항에 대해 정상 발화, 일부 단어 누락, 완전히 틀린 단어를 말해보며 STT가 이를 어떻게 인지하여 0~2점으로 채점하는지 화면에서 직접 확인합니다.
