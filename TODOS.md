# TODOS

## 보호자 단일 계정 모델 리뷰 (2026-05-31)

### ~~TODO-007: Quiz 컨트롤러에 `@EffectivePatientId()` 적용~~ ✅ 완료 (검증: quiz.controller.ts에 8곳 적용됨)

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

### ~~TODO-002: `LocTrialResponseDTO`에 `isNoResponse` 추가~~ ✅ 재정의 후 완료 (2026-07-19, 9471be0)

**What:** DTO에 무반응(latency=null)과 시간 초과(latency>10000ms) 구분 필드 추가
**Why:** score=0이 '10초 이후 반응'인지 '무반응'인지를 DTO만으로 구분 불가 → 임상 데이터 분석 시 동일한 0점으로 두 케이스가 뭉쳐져 임상적 구별 불가.
**Pros:** 임상 기록 명확성. 향후 데이터 분석 시 무반응률 vs 지연 반응률 분리 가능.
**Cons:** DTO 변경 시 `LocScreen.tsx` TrialResultRow 렌더링 + `ConductLocTrialUseCase.ts` + `FinishLocAssessmentUseCase.ts` 수정 필요.
**Context:** `latencyMs: null`이 현재 무반응과 황동(area-out-of-bounds) 두 경우 모두 null로 저장됨. `isNoResponse = touchTime === null`로 단순 판단 가능.
**재정의 사유(2026-07-19):** 원래 전제가 코드와 달랐다. ① 영역 외 터치는
latency=null이 아니라 실제 값이 기록된다. ② 무반응 여부는 이미 `latencyMs === null`로
구분되므로 `isNoResponse`는 복제다. 실제 결함은 따로 있었다 — `getLocScoreLabel`이
score만 받아 **영역 외 터치도 '무반응'으로 기록**했다. 라벨이 touchInBounds를 함께
보게 고쳤다. 남은 과제: `TOUCH_TIMEOUT_MS`(10s)와 `MODERATE_DELAY`(10s)가 같아
'시간 초과' 채점 분기가 도달 불가다(임상 판단 필요).

**Depends on:** 완료.

---

### ~~TODO-004: LocTouchButton 이모지 → SVG 아이콘 교체~~ ✅ 완료 (2026-07-19, 94ac6a3)

**What:** `LocTouchButton.tsx`의 `👆`(활성) / `🔇`(비활성) 이모지를 SVG 아이콘 또는 텍스트만으로 교체
**Why:** 이모지는 렌더링이 플랫폼마다 다르고(특히 iOS vs Android), 의료 도구에서 캐주얼한 느낌을 줌. AI Slop 패턴 (#7: 이모지를 디자인 요소로 사용).
**Pros:** 시각적 일관성 확보, 의료 앱다운 신뢰도, 크기/색상 제어 가능.
**Cons:** SVG 아이콘 선택/제작 필요. 실 기기(태블릿/iPad)에서 이모지와 텍스트 가독성 비교 테스트 필요.
**Context:** 활성: 원형 점 또는 손 모양 SVG. 비활성: 빈 원형 또는 텍스트만. 실 기기 테스트 없이는 SVG 크기/위치가 부자연스러울 수 있음.
**Depends on:** 독립적. 실 기기 테스트 환경 필요.

---

### TODO-005: Tailwind 임의값 → 테마 토큰 연결

**상태: 디자인 결정 대기 (2026-07-19 감사 완료)**

**What:** 코드 전반의 `bg-[#2D6A56]` 같은 arbitrary values를 Tailwind v4 `@theme` 토큰으로 통일
**Why:** DESIGN.md가 CSS 변수를 정의했지만 실제 코드는 hex 직접 사용. 색상 변경 시 전체 검색/교체 필요.

**감사 결과 — 기계적 치환이 불가능한 이유:**

총 980곳 / 고유 54종 · 시스템 내 546곳(56%) · 시스템 밖 434곳(44%)

| 색상 | 사용 | 상태 |
|---|---:|---|
| `#2D6A56` | 193 | DESIGN.md `--color-primary` |
| `#6B6560` | 71 | DESIGN.md `--color-muted` |
| `#1A1916` | 61 | DESIGN.md `--color-text` |
| `#5C6661` | 61 | 시스템 밖 — muted 계열 |
| `#EBF4F0` | 55 | DESIGN.md `--color-primary-light` |
| `#9AA09B` | 54 | 시스템 밖 — muted 계열 |
| `#C94040` | 48 | DESIGN.md `--color-danger` |
| `#E8E4DC` | 48 | DESIGN.md `--color-border` |
| `#1F5240` | 46 | 시스템 밖 — primary 계열 |
| `#1F2A26` | 42 | 시스템 밖 — text 계열 |
| `#E07B54` | 37 | DESIGN.md `--color-accent` |
| `#7A2E15` | 30 | 시스템 밖 — accent 계열 |
| `#F7F6F3` | 29 | DESIGN.md `--color-bg` |
| `#D4D8D4` | 29 | 시스템 밖 — border/surface 계열 |
| `#FBE9E2` | 23 | 시스템 밖 — accent 계열 |
| `#C5C8C5` | 23 | 시스템 밖 — border/surface 계열 |
| `#A8AFA9` | 16 | 시스템 밖 — muted 계열 |
| `#E5E5E0` | 12 | 시스템 밖 — border/surface 계열 |
| `#EBEAE6` | 9 | 시스템 밖 — border/surface 계열 |
| `#F2F1EC` | 8 | 시스템 밖 — border/surface 계열 |
| `#7A7E7A` | 8 | 시스템 밖 — muted 계열 |
| `#FBFBFA` | 7 | 시스템 밖 — border/surface 계열 |
| `#8A5A1A` | 4 | 시스템 밖 |
| `#E8A23C` | 4 | DESIGN.md `--color-warning` |
| `#E0A984` | 4 | 시스템 밖 — accent 계열 |
| `#FCF3EC` | 4 | 시스템 밖 — accent 계열 |
| `#9FD0BC` | 4 | 시스템 밖 |
| `#5C5870` | 4 | 시스템 밖 |
| `#DCEBE4` | 3 | 시스템 밖 |
| `#C8E6D9` | 3 | 시스템 밖 |
| `#7A4A20` | 3 | 시스템 밖 |
| `#F0EEF5` | 3 | 시스템 밖 |
| `#6B5BA8` | 3 | 시스템 밖 |
| `#9A7A50` | 3 | 시스템 밖 |
| `#F2F1ED` | 3 | 시스템 밖 — border/surface 계열 |
| `#B5602F` | 2 | 시스템 밖 |
| `#C96A45` | 2 | 시스템 밖 |
| `#F5F3FA` | 2 | 시스템 밖 |
| `#D9D5E0` | 2 | 시스템 밖 |
| `#F0F1F0` | 2 | 시스템 밖 |
| `#D9EAE3` | 2 | 시스템 밖 |
| `#D5E9E1` | 1 | 시스템 밖 |
| `#C4DDD3` | 1 | 시스템 밖 |
| `#F3F4F6` | 1 | 시스템 밖 |
| `#3A2E5C` | 1 | 시스템 밖 |
| `#FBFAFE` | 1 | 시스템 밖 |
| `#E8E4F0` | 1 | 시스템 밖 |
| `#564A88` | 1 | 시스템 밖 |
| `#F3D9C4` | 1 | 시스템 밖 |
| `#E8C9A8` | 1 | 시스템 밖 |
| `#CBB79A` | 1 | 시스템 밖 |
| `#9AA890` | 1 | 시스템 밖 |
| `#FFFFFF` | 1 | 시스템 밖 |
| `#EFEEE9` | 1 | 시스템 밖 |

1. **시맨틱 토큰이 `index.css`에 아예 없다.** `@theme` 블록은 Tailwind blue scale을
   세이지 그린으로 리맵할 뿐 `--color-primary`/`--color-muted` 등은 정의되지 않았다.
   DESIGN.md의 표는 문서에만 있고 코드에 반영된 적이 없다.
2. **코드의 색이 54종인데 DESIGN.md는 9종만 정의한다.** 나머지 44%(434곳)는
   시스템에 없는 근사색이다 — muted 계열만 4종, border 계열 7종, accent 계열 4종.
3. 따라서 남은 44%를 어느 토큰으로 합칠지는 **디자인 결정**이다. 고령 사용자를
   전제한 의료 앱이라 대비·가독성에 영향이 있어 임의로 정하면 위험하다.

**진행 방법(결정 후):**
- (a) 위 표의 "시스템 밖" 색을 어느 토큰으로 흡수할지 정한다
      (primary-dark, accent-light, muted-strong 등 토큰 추가 여부 포함)
- (b) `index.css`의 `@theme`에 확정된 토큰을 정의한다
- (c) 전 컴포넌트 치환 후 주요 화면 스크린샷으로 의도한 변화만 났는지 확인한다

**Depends on:** 디자인 결정. 결정 없이 56%만 치환하면 `bg-primary`와
`bg-[#1F5240]`이 섞인 혼합 상태가 되어 오히려 일관성이 떨어진다.

---

### ~~TODO-003: STORAGE_FAILED 시 사용자 경고 표시~~ ✅ 완료

`LocScreen.tsx:197-202`에 `warningMessage` 배너 구현됨 (2026-03-29, LOC_feature_plan 브랜치).

---

### ~~TODO-006: 탭 전환 시 TTS 중단 및 검사 일시정지 처리~~ ✅ 완료 (2026-07-19, 80bd57d)

**What:** `visibilitychange` 이벤트 감지 시 TTS 취소 + 진행 중인 타이머 정지. 탭 복귀 시 현재 시도를 재시작하거나 에러 메시지 표시.
**Why:** 탭 전환 후 돌아왔을 때 검사가 AWAITING_TOUCH 상태로 멈춰있을 수 있음. 타이머는 계속 돌고 있어 무응답 처리될 수 있음. 실어증 환자가 실수로 다른 앱을 탭하면 검사가 조용히 망가짐.
**Pros:** 사용자 경험 명확성 — 탭 전환 후 상태를 알 수 있음. 잘못된 타임아웃 측정 방지.
**Cons:** `document.addEventListener('visibilitychange', ...)` 추가 + useLocViewModel의 정리 로직 확장 필요. 상태 복구 전략 결정 필요 (현재 시도 재시작 vs 전체 재시작).
**Context:** 위험 요소 분석표에 "탭 전환 시 TTS 중단 — 보통 발생 가능성, 낮음 영향도, 처리 예정"으로 명시됨. `useLocViewModel.ts`의 cleanup useEffect에 추가하는 것이 자연스러운 위치.
**Depends on:** 독립적.
