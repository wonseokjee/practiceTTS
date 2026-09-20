# 영어 웰니스 라벨 — 법무·컴플라이언스 검토 요청 (초안)

작성 2026-09-20 · 요청 근거: TODOS.md 「영어 웰니스 라벨 — 배포 전 법무·컴플라이언스 검토」(P2)
검토가 끝나야 하는 시점: 영어 사용자에게 문을 여는 시점(영어판 실행 계획 §0-5c, §16 M1) **이전**

> 이 문서는 검토를 **요청**하는 문서다. 아래 판단(어느 표현이 위험한가)은 엔지니어링의 추정이며,
> 법적 결론이 아니다. 결론은 검토자가 낸다.

## 1. 왜 검토가 필요한가

영어판은 **웰니스 포지셔닝**(FDA 의료기기 트랙 회피)으로 출시한다
([전략 문서 §2](20260629_GlobalExpansion_plan.md)). 전략 문서는 UI 문구를 그 실행 수단으로 본다:

| ❌ 의료기기로 분류될 표현 | ✅ 웰니스 허용 표현 |
|---|---|
| 실어증 진단 / 치료 | 두뇌 건강 훈련 |
| 인지 저하 검사 / 평가 | 기억력 활동 / 운동 |
| 회복 (의학적 회복 주장) | 꾸준한 두뇌 자극 |

이 표가 실제로 지켜지는지 검증한 사람이 없다. 표 자체도 엔지니어링이 작성했다.

## 2. 영어 문자열 정리 상태 (2026-09-20)

실행 계획 §1-3은 "`qabSubtestLabels` 하나만 갈아끼우면 된다"고 적었지만, 그 라벨만 웰니스 어휘로 들어갔고(PR #220)
영어 로케일 나머지에는 같은 계획서가 금지한 어휘가 그대로 남아 있었다. 전략 문서 표에 근거가 있는
`assessment`·`recovery`는 엔지니어링이 먼저 정리했다(`frontend/src/shared/i18n/locales/en-US/`).

| 바꾼 것 | 전 → 후 |
|---|---|
| `assessment` 계열 (~36곳 중 UI 값 전부) | assessment → activity (예: "Select an assessment" → "Select an activity", "Standard assessment" → "Standard activity") |
| LOC 화면 제목 | "Level of consciousness (LOC) assessment" → "Alertness check (LOC)" (기존 `qabSubtestLabels.loc`와 통일) |
| 검사 설명문 | "Assesses comprehension…" → "Practices understanding of…" |
| 보호자 추이 화면 | "Speech assessment recovery trend" → "Speech activity progress trend" |

**일부러 남긴 것 — 검토자 판단이 필요하다:**

| 표현 | 위치 | 왜 남겼나 |
|---|---|---|
| `Patient` (~34곳, "Patient mode PIN" 등) | 전반 | 전략 문서 표에 없는 제품 전반 용어. §4 질문 1 |
| `Normal` / `Mild delay` / `Moderate delay` | `assessments.json` `scoreLabels` | 임상 등급 직역. §4 질문 2 |
| `Alertness check` | `qabSubtestLabels.loc`, LOC 제목 | §4 질문 3 |
| `recovery` 부정형 2곳 | `caregiver.json` `drillNote`·`drillBadgeTitle` ("not recovery") | 부정형 사용이 안전한가. §4 질문 5 |
| `diagnos…` 부정형 1곳 | `caregiver.json` `limitation1` | 면책 고지. §4 질문 4 |

**한계:** 화면 문자열만 바꿨다. i18n 키 이름(`assessmentAria`, `nextAssessmentButton` 등)과 코드 식별자는
그대로다(사용자에게 보이지 않는다). 영어 TTS 사전생성 음성 스크립트와 앱 밖 표면(앱스토어, 랜딩)은
확인하지 않았다 — §4 질문 6.

## 3. 검토 대상 문구 (원문)

### 3-1. 하위 활동 라벨 — `caregiver.json` `qabSubtestLabels`

| key | 영어 라벨 |
|---|---|
| loc | Alertness check |
| word | Word activity |
| sentence | Sentence activity |
| naming | Picture naming exercise |
| repeat | Repeat-after-me exercise |
| reading | Reading aloud exercise |
| spell | Word-building exercise |
| ddk | Quick-repeat exercise |

### 3-2. 점수 등급 라벨 — `assessments.json` `scoreLabels`

`Normal` / `Mild delay` / `Moderate delay` / `No response` / `Off-target touch`

표준 임상 분류를 직역한 것이다. `Normal`·`Mild/Moderate delay`는 "정상/경도/중등도 지연"이라는
**임상 등급 어휘**라 웰니스 표현이 아닐 수 있다.

### 3-3. 보호자 리포트 고지 — `caregiver.json` `limitation1~6`

`limitation1`: "This is a self-measured record done at home with a caregiver. It is not a medical
diagnosis or a standardized test result." — 이미 면책 문구가 있다. 충분한지 묻는다.

### 3-4. 화면 제목류 (정리 후 현재 값)

`Select an activity`, `Activity complete`, `Alertness check (LOC)`,
`Speech activity progress trend`, `Language & cognition activity record`, `Standard activity`.

## 4. 검토자에게 묻는 것

1. **범위:** §2에서 엔지니어링이 바꾼 `assessment`→`activity`, `recovery trend`→`progress trend`가
   적절한가? 남긴 `Patient`(~34곳)는 바꿔야 하는가? 바꾼다면 대체어를 정해 주면 적용한다
   (예: "your loved one" / "person you support").
2. **점수 등급 `Normal` / `Mild delay` / `Moderate delay`(§3-2):** 임상 등급 어휘를 그대로 쓰는 것이
   "진단·평가" 주장으로 읽힐 위험이 있는가? 대안(예: "On track" / "A bit slower" / "Needs more time")이
   필요한가?
3. **`Alertness check`(§3-1 `loc`):** "level of consciousness"에서 온 명칭이다. 의식 수준 평가를 연상시키는
   활동명이 웰니스로 허용되는가?
4. **면책 고지(§3-3):** `limitation1`만으로 충분한가, 온보딩·약관·앱스토어 설명에 별도 고지가 필요한가?
5. **부정형 문구:** "not recovery", "not a medical diagnosis"처럼 금지 어휘를 부정형으로 쓰는 것은
   안전한가, 아니면 어휘 자체를 피해야 하는가?
6. **UI 밖 표면:** 앱스토어 설명, 랜딩 페이지, 마케팅 문구는 이 저장소 밖이다. 같은 기준이 적용되는지,
   이 저장소의 문자열만 검토하면 되는지.

## 5. 엔지니어링이 하지 않는 것 / 모르는 것

- 위 표현이 실제로 FDA 기기 분류나 FTC 건강 주장 기준에 걸리는지 **판단하지 않았다**.
  전략 문서의 ❌/✅ 표를 기준으로 삼았을 뿐이다.
- 문구를 바꿔도 **기능**(음성 채점, 점수 추이, 등급 표시)이 의료기기 정의에 해당하는지는 문구와 별개의
  문제다. 이 검토 요청의 범위 밖이며, 필요하면 별도로 묻는다.
- 한국어 UI는 대상이 아니다.

## 6. 검토가 끝나면 엔지니어링이 할 일

1. 결론에 따라 en-US 문자열 수정(키 이름은 코어 로직이 안 쓰므로 값만 바꾼다). 소비자 테스트까지
   돌린다(`qabSubtestLabels.test.ts` 등, 공유 맵 변경 시 소비자를 grep으로 찾을 것).
2. 승인된 어휘 표를 이 문서 §2에 「승인 어휘」로 추가해 이후 번역이 같은 기준을 따르게 한다.
3. TODOS.md의 해당 항목 제거.
