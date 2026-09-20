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

## 2. 지금 영어 문자열 상태 — 계획서가 말한 것보다 덜 끝났다

실행 계획 §1-3은 "`qabSubtestLabels` 하나만 갈아끼우면 된다"고 적었다. 그 라벨은 웰니스 어휘로
들어갔다(PR #220). 그러나 **영어 로케일 전체를 훑으면 같은 계획서가 금지한 어휘가 그대로 남아 있다**
(`frontend/src/shared/i18n/locales/en-US/`, 2026-09-20 기준 `grep -i`, 키 이름 포함 대략치).

| 표현 | 대략 횟수 | 예 (파일:키) |
|---|---|---|
| `assess…` (assessment 등) | ~36 | `assessments.json` `title: "Select an assessment"`, `"Level of consciousness (LOC) assessment"`, `caregiver.json` `"Language & cognition assessment record"` |
| `recover…` | 3 | `caregiver.json:219` `sectionAria: "Speech assessment recovery trend"`, `:222`·`:227`은 "not recovery"로 **부정형** |
| `Patient` | ~34 | `"Patient ID"`, `"Patient: {{name}}"`, `"Patient mode PIN"` |
| `diagnos…` | 1 | `caregiver.json:278` "It is not a medical diagnosis…" (**부정형 고지**) |

한국어 표의 "검사·회복 → activity·progress" 매핑이 `qabSubtestLabels`에만 적용되고 나머지 화면(평가
선택, 결과 패널, 보호자 리포트 제목)에는 적용되지 않았다. **이 부분은 검토 전에 엔지니어링이 먼저
고칠 수도 있고(권장), 검토자에게 어디까지 고쳐야 하는지 묻는 것이 먼저일 수도 있다** — §4 질문 1.

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

### 3-4. 화면 제목류 (§2 표의 남은 표현)

`Select an assessment`, `Assessment complete`, `Level of consciousness (LOC) assessment`,
`Speech assessment recovery trend`, `Language & cognition assessment record`, `Standard assessment`.

## 4. 검토자에게 묻는 것

1. **범위:** §2·§3-4의 `assessment`/`recovery`/`Patient`를 웰니스 어휘로 바꿔야 하는가? 바꾼다면
   대체어 후보를 정해 주면 엔지니어링이 적용한다(예: assessment→activity/check-in, recovery trend→progress
   trend, Patient→"your loved one"/"person you support").
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
