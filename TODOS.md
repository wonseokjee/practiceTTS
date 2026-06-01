# TODOS

## 보호자 단일 계정 모델 리뷰 (2026-05-31)

### TODO-007: Quiz 컨트롤러(Phase 3)에 `@EffectivePatientId()` 적용

**What:** 데일리 퀴즈 Phase 3에서 Quiz 컨트롤러를 신설할 때, `req.user.id`를 직접 환자로 쓰지 말고 `@EffectivePatientId()` 데코레이터(보호자 단일 계정 모델에서 신설)를 처음부터 사용.
**Why:** training 컨트롤러는 이번 PR에서 effective patientId로 전환되지만, Quiz 컨트롤러는 아직 미구현. 같은 규칙을 적용하지 않으면 보호자가 환자 모드에서 퀴즈 API 호출 시 본인(caregiver) id로 조회되어 빈 데이터/오동작, 또는 타 환자 접근 보안 구멍 발생.
**Pros:** 보안 일관성. 환자 데이터 접근 경계를 토큰 기준 단일 규칙으로 통일.
**Cons:** 없음(신규 코드에 규칙 적용일 뿐).
**Context:** `backend/src/auth/decorators/effective-patient-id.decorator.ts` + `effective-patient-id.util.ts`(본 PR 신설). 데일리 퀴즈 Phase 1 plan §1-2에도 언급됨. Quiz 컨트롤러의 모든 환자 데이터 핸들러에 적용.
**Depends on:** 보호자 단일 계정 모델 PR(effective patientId 데코레이터) 선행 + 데일리 퀴즈 Phase 3 착수 시.

---

## LOC_feature_plan 브랜치 리뷰 (2026-03-28)

### TODO-001: useLocViewModel → useReducer 기반 Reducer로 리팩토링

**What:** `useLocViewModel.ts`의 FSM을 SentComp/WordComp와 동일한 `useReducer` Reducer 패턴으로 교체
**Why:** SentComp는 `sentCompSessionReducer.ts`, WordComp는 `wordCompSessionReducer.ts`를 사용하지만 LOC만 `useState` + 7개 ref로 FSM을 직접 구현. 코드베이스 협업 시 두 가지 FSM 패턴 파악 부담.
**Pros:** 코드베이스 전체 일관성 확보. 다음 검사 구현 시 Reducer 패턴을 표준으로 적용 가능.
**Cons:** 현재 FSM은 완전 동작 중 + 테스트 65/65 통과. 리팩토링 후 회귀 테스트 통과 여부 확인 필요.
**Context:** SentComp/WordComp의 Reducer 패턴을 먼저 분석하여 공통 Reducer 구조 설계 후 LOC에 적용. `useLocViewModel.test.ts` 10개 테스트가 리팩토링 안전망 역할.
**Depends on:** ✅ 완료 — 이번 PR(LOC_feature_plan)에서 `locSessionReducer.ts` 신규 생성 + `useLocViewModel.ts` 전면 재작성으로 구현 완료. 88/88 테스트 통과.

---

### TODO-002: `LocTrialResponseDTO`에 `isNoResponse: boolean` 필드 추가

**What:** DTO에 무반응(latency=null)과 시간 초과(latency>10000ms) 구분 필드 추가
**Why:** score=0이 '10초 이후 반응'인지 '무반응'인지를 DTO만으로 구분 불가 → 임상 데이터 분석 시 동일한 0점으로 두 케이스가 뭉쳐져 임상적 구별 불가.
**Pros:** 임상 기록 명확성. 향후 데이터 분석 시 무반응률 vs 지연 반응률 분리 가능.
**Cons:** DTO 변경 시 `LocScreen.tsx` TrialResultRow 렌더링 + `ConductLocTrialUseCase.ts` + `FinishLocAssessmentUseCase.ts` 수정 필요.
**Context:** `latencyMs: null`이 현재 무반응과 황동(area-out-of-bounds) 두 경우 모두 null로 저장됨. `isNoResponse = touchTime === null`로 단순 판단 가능.
**Depends on:** 독립적. 이번 PR 이후 별도 PR에서 수행.

---

### TODO-004: LocTouchButton 이모지 → SVG 아이콘 또는 텍스트 전용 교체

**What:** `LocTouchButton.tsx`의 `👆`(활성) / `🔇`(비활성) 이모지를 SVG 아이콘 또는 텍스트만으로 교체
**Why:** 이모지는 렌더링이 플랫폼마다 다르고(특히 iOS vs Android), 의료 도구에서 캐주얼한 느낌을 줌. AI Slop 패턴 (#7: 이모지를 디자인 요소로 사용).
**Pros:** 시각적 일관성 확보, 의료 앱다운 신뢰도, 크기/색상 제어 가능.
**Cons:** SVG 아이콘 선택/제작 필요. 실 기기(태블릿/iPad)에서 이모지와 텍스트 가독성 비교 테스트 필요.
**Context:** 활성: 원형 점 또는 손 모양 SVG. 비활성: 빈 원형 또는 텍스트만. 실 기기 테스트 없이는 SVG 크기/위치가 부자연스러울 수 있음.
**Depends on:** 독립적. 실 기기 테스트 환경 필요.

---

### TODO-005: Tailwind 임의값 → 테마 토큰 연결

**What:** 코드 전반의 `bg-[#2D6A56]`, `text-[#6B6560]` 등 arbitrary values를 Tailwind v4 `@theme` 커스텀 토큰(`bg-primary`, `text-muted` 등)으로 통일
**Why:** DESIGN.md에 Tailwind v4 CSS 변수(`--color-primary`, `--color-muted` 등)를 정의했지만 실제 코드는 hex 값 직접 사용. 색상 변경 시 전체 검색/교체 필요.
**Pros:** 색상 변경 시 `index.css`만 수정. IDE 자동완성 지원. 코드 가독성 향상.
**Cons:** `tailwind.config.ts` 또는 `index.css`의 `@theme` 블록과 실제 Tailwind 클래스 매핑 작업 필요. 전체 컴포넌트 일괄 교체 스코프.
**Context:** SentComp/WordComp 컴포넌트들도 동일 패턴 사용 중이므로 프로젝트 전체 적용 필요. LOC만 먼저 적용 시 일관성 더 저하될 수 있음.
**Depends on:** 독립적. 전체 프론트엔드 정리 PR에서 수행 권장.

---

### ~~TODO-003: STORAGE_FAILED 시 사용자 경고 표시~~ ✅ 완료

`LocScreen.tsx:197-202`에 `warningMessage` 배너 구현됨 (2026-03-29, LOC_feature_plan 브랜치).

---

### TODO-006: 탭 전환 시 TTS 중단 및 검사 일시정지 처리

**What:** `visibilitychange` 이벤트 감지 시 TTS 취소 + 진행 중인 타이머 정지. 탭 복귀 시 현재 시도를 재시작하거나 에러 메시지 표시.
**Why:** 탭 전환 후 돌아왔을 때 검사가 AWAITING_TOUCH 상태로 멈춰있을 수 있음. 타이머는 계속 돌고 있어 무응답 처리될 수 있음. 실어증 환자가 실수로 다른 앱을 탭하면 검사가 조용히 망가짐.
**Pros:** 사용자 경험 명확성 — 탭 전환 후 상태를 알 수 있음. 잘못된 타임아웃 측정 방지.
**Cons:** `document.addEventListener('visibilitychange', ...)` 추가 + useLocViewModel의 정리 로직 확장 필요. 상태 복구 전략 결정 필요 (현재 시도 재시작 vs 전체 재시작).
**Context:** 위험 요소 분석표에 "탭 전환 시 TTS 중단 — 보통 발생 가능성, 낮음 영향도, 처리 예정"으로 명시됨. `useLocViewModel.ts`의 cleanup useEffect에 추가하는 것이 자연스러운 위치.
**Depends on:** 독립적.
