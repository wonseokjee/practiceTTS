# Memory Link — Design System

**컨셉: Warm Clinical**
따뜻함과 신뢰를 동시에. 의료 앱의 차가운 청색 관행을 의도적으로 거부하고, 보호자와 환자 모두를 위한 따뜻한 공간을 만든다.

---

## 컬러 팔레트

**정본은 `frontend/src/index.css`의 `@theme` 블록이다.** 아래 표는 그 값의 사본이
아니라 **역할 설명**이다 — hex를 고칠 일이 있으면 index.css를 고친다.

| 토큰 | 값 | 용도 |
|------|-----|------|
| `canvas` | `#F7F6F3` | 크림 베이지 페이지 배경 |
| `canvas-hover` | `#EBEAE6` | 크림 면의 hover |
| `surface-soft` | `#FBFBFA` | 흰색에 가까운 면 |
| `surface-dim` | `#F2F1ED` | 카드 안 자리표시자·뱃지 면 |
| `primary` | `#2D6A56` | 세이지 그린 주색상 — 버튼, 링크, 강조 |
| `primary-dark` | `#1F5240` | 눌림·hover, 그린 계열 짙은 잉크 |
| `primary-light` | `#EBF4F0` | 연한 그린 배경 — 활성 상태, 뱃지 배경 |
| `accent` | `#E07B54` | 테라코타 **면** — 연한 배경, 피드백 카드 테두리, 아이콘 칩 |
| `accent-strong` | `#B85C36` | 테라코타 **잉크** — 흰 글씨를 받치는 채움, 강조 텍스트, 활성 컨트롤 경계 |
| `accent-hover` | `#A04F2D` | `accent-strong`의 hover (5.75:1) |
| `accent-ink` | `#7A2E15` | 연한 테라코타 면 위의 짙은 글자 |
| `accent-soft` | `#FBE9E2` | 피드백 카드 채움 |
| `accent-faint` | `#FCF3EC` | 가장 옅은 테라코타 면 |
| `accent-line` | `#E0A984` | 테라코타 테두리·링 |
| `caregiver-muted` | `#7A5444` | 보호자 사적 영역의 보조 글자 — [보호자 사적 영역](#보호자-사적-영역) |
| `caregiver-line` | `#F1DCCD` | 보호자 사적 영역의 흰 카드·입력 테두리 |
| `ink` | `#1A1916` | 기본 텍스트 — 대시보드류·표준검사 |
| `ink-sage` | `#1F2A26` | 기본 텍스트(초록기) — QAB 퀴즈 흐름 |
| `muted-sage` | `#5C6661` | 보조 텍스트, 플레이스홀더 |
| `muted-faint` | `#A8AFA9` | 흐린 보조·hover 테두리 |
| `muted-disabled` | `#9AA09B` | 비활성 글자 — **AA 미달, 의도된 예외**(DR9) |
| `disabled-ink` | `#7A7E7A` | 비활성 글자 중 진한 쪽 |
| `disabled-surface` | `#C5C8C5` | 비활성 컨트롤의 면·테두리 |
| `line` | `#E8E4DC` | 구분선, 테두리 |
| `line-strong` | `#D4D8D4` | 또렷한 테두리·링 |
| `line-soft` | `#E5E5E0` | 옅은 테두리 |
| `warning` | `#E8A23C` | 경고 상태 |
| `danger` | `#C94040` | 오류, 세션 종료 등 위험 동작 |
| `danger-ink` | `#8B2020` | 연한 danger 면 위의 글자 |
| `danger-soft` | `#FEF0F0` | danger 알림 채움 |

흰색(`#FFFFFF`)은 토큰이 아니다 — Tailwind의 `bg-white`를 그대로 쓴다.

**`ink`↔`ink-sage`, `muted`↔`muted-sage`가 왜 넷이 아니라 셋인가(2026-09-04).**
색은 다른데 역할이 겹치는 두 쌍을 실제 화면(대시보드/QAB 퀴즈)에서 눈으로 비교해
정했다.

- **`ink`/`ink-sage`는 유지했다.** 파일 분포가 우연이라기엔 너무 깨끗하게
  갈렸다 — `ink`는 대시보드류·표준검사에서만, `ink-sage`는 QAB 퀴즈 흐름에서만
  쓰였고 같은 파일에서 섞인 적이 한 번도 없었다. 두 맥락을 가르는 신호로 읽었다.
- **`muted`는 `muted-sage`로 합쳤다.** 반대로 14개 파일이 한 파일 안에서 두
  톤을 같이 썼다 — 의도가 아니라 드리프트였다. `muted` 토큰은 지워졌다.

### 이 색들은 코드에서 어떻게 쓰이나

```tsx
<button className="bg-primary text-white">
<p className="text-muted-sage">
<div className="bg-accent/8 border-accent-line">   {/* 투명도도 그대로 */}
```

`@theme`에 `--color-이름`을 선언하면 Tailwind가 `bg-`·`text-`·`border-`·`ring-`·
`fill-`·`stroke-` 유틸을 만들어 준다. `:root`에 넣으면 **유틸이 생기지 않으니**
반드시 `@theme` 안에 둔다.

클래스를 쓸 수 없는 자리(런타임에 고르는 색, 인라인 `style`, 그라데이션)는
`var(--color-이름)`으로 같은 변수를 참조한다 — `CaptureFlow.ts`의 무드 색과
`theme.ts`의 배경 그라데이션이 그 예다. SVG의 `fill`/`stroke`는 **속성이 아니라
클래스**로 준다(표현 속성은 CSS 값이 아니라 `var()`를 못 읽는다).

**언제 hex를 그대로 써도 되나.** 세 경우뿐이고, 그 외에는
`accentContrast.test.ts`가 막는다.
1. 브랜드 규정색 — 구글·카카오 로그인 버튼
2. 한 곳에서만 쓰는 일회성 색 — 이름을 지어도 부를 사람이 없다
3. 주석에 적는 실측 근거 — "`#9AA09B`는 2.47:1이라 뺐다"

### 테라코타를 둘로 나눈 이유

`#E07B54`는 중간 톤이라 **흰색과 2.95:1**이다. 어떤 글자 크기에서도 WCAG 기준
(본문 4.5 / 큰 글씨·UI 경계 3.0)을 못 넘는다. 그런데 이 색을 "배경 + 흰 텍스트"로
쓰라고 적어둔 탓에, 앱에서 가장 눈에 띄어야 할 CTA가 가장 안 읽히는 버튼이었다.

색을 통째로 어둡게 하면 Warm Clinical의 온도가 내려간다 — 테라코타는 "의료 앱의
차가운 청색 관행을 거부"하려고 고른 색이다. 그래서 `primary`/`primary-light`가
이미 쓰는 방식대로 **면과 잉크를 나눴다.**

| 쓰임 | 토큰 | 흰색 대비 |
|------|------|-----------|
| 연한 배경(`/8`, `/15`), 아이콘 칩 | `accent` | 해당 없음 |
| `accent-soft` 채움과 함께 쓰는 피드백 테두리 | `accent` | 채움이 형태를 알려주므로 경계에 기대지 않는다 |
| 흰 글씨를 받치는 채움 | `accent-strong` | **4.54:1** ✅ |
| 흰 배경 위 강조 텍스트·아이콘 | `accent-strong` | **4.54:1** ✅ |
| 활성 컨트롤의 경계·포커스 링 | `accent-strong` | **4.54:1** (3.0 필요) ✅ |

`accent-strong`의 hover는 `#A04F2D`(5.75:1).

**판단 기준 한 줄:** 이 색이 **잉크이거나 컨트롤의 경계**면 `accent-strong`,
**면**이면 `accent`.

### 보호자 사적 영역

보호자 **본인만 보는** 화면 — 일기 '나의 하루', 선배 보호자 도우미. 환자 화면·대시보드와
구분되되 앱의 온도에서 벗어나지 않게 옅은 테라코타 면을 쓴다(2026-10-05 디자인 리뷰,
라벤더·세이지 안개·귀리·회녹색 후보와 나란히 비교해 골랐다). 그 전의 라벤더 일회성 hex는 걷어냈다.

| 역할 | 토큰 | `accent-faint` 위 대비 |
|------|------|------|
| 면 | `accent-faint` | — |
| 제목 | `accent-ink` | 8.60:1 |
| 보조 글자 | `caregiver-muted` | 6.03:1 |
| 주 버튼 채움 | `accent-strong` + 흰 글씨 | 4.54:1 |
| 링크 글자 | `accent-hover` | 5.25:1 |
| 흰 카드·입력 테두리 | `caregiver-line` | 흰색과 면이 1.1:1이라 테두리가 없으면 카드가 묻힌다 |

**링크에 `accent-strong`을 쓰지 않는다** — 이 면 위에서 4.15:1로 본문 기준(4.5) 미달이다.

**위기 연결처 줄**(`CrisisContactBar`)은 이 영역 안에서도 **중립 흰색 + `line` 윗선**이다.
같은 컴포넌트가 크림·테라코타 어느 배경에도 놓여야 하고, 크거나 붉으면 "당신 위험하죠?"로
읽힌다. 화면 틀 고정 하단 56px, 번호는 tel: 링크 44px, 긴 목록은 '더보기' 시트.

**아이콘은 선 아이콘**(`LineIcons.tsx`, 1.5px, 글자색 상속)이다. 이모지는 기기마다 모양이
달라 신뢰가 걸린 자리에서 톤이 흔들린다.

---

## 타이포그래피

| 역할 | 폰트 | 크기 | 굵기 | 용도 |
|------|------|------|------|------|
| 본문 전반 (한국어·영어 공통) | **Pretendard** | — | — | 모든 UI 텍스트. 영어도 같은 서체를 쓴다 — [다국어](#다국어) 참조 |
| 점수 / 숫자 | **Geist** | — | 700 | `font-feature-settings: 'tnum'`, 검사 점수 표시 |

### 스케일

| 이름 | 크기 | 굵기 | 용도 |
|------|------|------|------|
| hero | 40px | 800 | 랜딩, 주요 헤딩 |
| h1 | 28px | 700 | 화면 제목 |
| h2 | 22px | 600 | 섹션 제목 |
| h3 | 18px | 600 | 카드 제목 |
| body | 16px | 400 | 본문 |
| sm | 14px | 400 | 보조 텍스트 |
| xs | 12px | 400 | 메타 정보, 타임스탬프 |

### Pretendard CDN

**`dynamic-subset`을 쓴다.** `unicode-range`로 갈려 있어 필요한 글자 조각만 받는다.

```html
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css" rel="stylesheet" />
```

`static/pretendard.css`(서브셋 없는 판)로 되돌리지 말 것.

**2026-09-06 실측** — 앱의 실제 문구(보호자 대시보드·8검사 라벨·환자 지시문)를 넣고 잰 값:

| | 전송량 |
|---|---|
| `pretendard.css` (서브셋 없음) | **약 2,346 KB** — `@font-face` 9개가 각각 통짜 woff2 |
| `pretendard-dynamic-subset.css` | woff2 19조각 **235 KB** + CSS **22 KB** = **257 KB** |
| | **약 89% 감소** |

서브셋 없는 판은 영어만 읽는 사용자도 한글 1만여 자를 통째로 받게 한다.

---

## 간격 체계

8px 배수. 예외 없음.

| 값 | 배수 | 용도 |
|----|------|------|
| 4px | 0.5× | 아이콘 ↔ 텍스트 미세 간격 |
| 8px | 1× | 기본 단위, 배지 내부 |
| 12px | 1.5× | 인라인 요소 간격 |
| 16px | 2× | 카드 내부 여백, 폼 그룹 |
| 24px | 3× | 카드 패딩, 섹션 간격 |
| 32px | 4× | 헤더 아래, 주요 그룹 |
| 48px | 6× | 섹션 간 여백 |
| 64px | 8× | 페이지 상단 여백, 히어로 패딩 |

---

## 모서리 반경

| 이름 | 값 | 용도 |
|------|-----|------|
| `sm` | 8px | 입력창, 이미지 썸네일 |
| `md` | 12px | 소형 카드, 알림 |
| `lg` | 16px | 기본 카드 |
| `xl` | 24px | 주요 카드, 모달, 큰 섹션 |
| `full` | 9999px | 버튼, 배지, 필 형태 |

---

## 버튼

| 변형 | 배경 | 텍스트 | 용도 |
|------|------|--------|------|
| `primary` | `primary` | white | 주요 동작 — 검사 시작, 로그인 |
| `secondary` | `primary-light` | `primary` | 보조 동작 — 다음으로 |
| `ghost` | transparent | `muted-sage` | 취소, 세션 종료 |
| `accent` | `accent` | white | 강조 CTA — 기억 추가 |
| `danger` | `danger` | white | 위험 동작 (확인 후 노출) |

- 모서리 반경: `full` (9999px)
- 대형 버튼 (`btn-lg`): `border-radius: xl` (24px) — 터치 타겟 전용
- 최소 터치 타겟: 44×44px (WCAG AA)

---

## 모션 원칙

| 대상 | 값 | 비고 |
|------|-----|------|
| 색상, 그림자, 테두리 | `180ms ease` | 상태 전환 |
| 레이아웃, 화면 전환 | `250ms ease-in-out` | 의도가 느껴지는 속도 |
| **금지** | bounce, elastic, spring | 신뢰도 저하 |

`prefers-reduced-motion` 준수 필수.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 컴포넌트 패턴

### 카드
```tsx
// 기본 카드
<div className="bg-white border border-line rounded-2xl p-5 shadow-sm">

// 점수 카드 (검사 결과)
<div className="bg-white border border-line rounded-3xl p-6 shadow-md text-center">
```

### 터치 버튼 (LOC 검사)
```tsx
<button className="w-full min-h-[200px] bg-primary-light border-4 border-primary rounded-3xl
  flex flex-col items-center justify-center gap-3
  hover:bg-[#d5e9e1] active:scale-[0.98] transition-all duration-180">
```

### 배지
```tsx
// 상태별
<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
  bg-primary-light text-primary">진행 중</span>
```

### 알림 (Alert)
```tsx
// 성공
<div className="bg-primary-light border border-primary/25 rounded-xl px-4 py-3 text-sm text-primary-dark">

// 오류
<div className="bg-danger-soft border border-danger/25 rounded-xl px-4 py-3 text-sm text-danger-ink">
```

---

## 다국어

한국어 단일이던 시절의 가정이 화면에 남아 있다. 아래는 그 가정을 걷어낸 규칙이고,
**영어판 작업이 끝나도 계속 적용된다** — 새 컴포넌트를 만들 때 지킨다.
근거와 실측 과정: `docs/history/20260906_EnglishLocalization_execution_plan.md` §7-1.

### 서체는 하나다

Pretendard를 한국어·영어에 **같이** 쓴다. 라틴 글리프가 Inter 파생이라 영어가
이미 잘 나온다 — 캔버스 실측(2026-09-06)에서 Pretendard와 Inter는
**x-height 9px · cap-height 12px로 세로 비례가 동일**하고 가로만 Inter가 3.7% 넓다.

로케일별로 서체를 가르지 않는다. 가르면 두 언어 화면이 미묘하게 달라지고,
아래 팽창 예산을 **전부 다시 재야 한다**(예산은 서체에 묶인 값이다).

### 텍스트 팽창 예산 — 칸 폭별

한국어 → 영어는 "통상 30~40%"가 **아니다.** 이 앱의 실측(375px, 2026-09-06):

| 칸 폭 | 예산 | 실측 근거 |
|---|---|---|
| ~130px (2열 그리드 칸) | **2배** | `말운동(퍼터커)` 79px → `Speech motion (puh-tuh-kuh)` 163px (**+106%**) |
| ~200–300px (카드 안 라벨) | 1.7배 | `그림 이름대기` 76px → `Picture naming exercise` 125px (+64%) |
| 전체 폭 버튼 | 1.5배 | `환자에게 기기 건네기` 155px → 236px (+52%) |
| 여러 요소가 나눠 쓰는 줄(헤더 등) | **예산 없음 — 재설계** | 헤더 전체 368px → 384px, 375px를 넘긴다 |

**규칙: 칸이 좁을수록 팽창률이 크다.** 짧은 라벨일수록 크게 늘고, 가장 좁은 칸에
가장 짧은 라벨이 들어간다. 그래서 백분율 하나로 잡으면 반드시 틀린다.

### 줄바꿈은 로케일 규칙이다

| | ko | en |
|---|---|---|
| `word-break` | `keep-all` — 어절 보존 | `normal` |
| `overflow-wrap` | `anywhere` — URL 안전망 | `break-word` |

`index.css`의 전역 한 벌(`keep-all` + `anywhere`)은 **한국어 전용 수정**이었다
(TODO-008, 2026-08-02, c747556 — 375px에서 「환자 정 / 보」가 끊기던 문제).
`keep-all`은 영어에서 아무 일도 하지 않고, 남는 `anywhere`가 **영어 단어를 글자
단위로 쪼갠다**(「Patient informat / ion」). 같은 버그가 언어만 바꿔 돌아온다.

**단, 줄바꿈 속성은 대증요법이다.** 넘치는 진짜 원인은 대개 칸 폭 부족이다.

### 고정 치수 — 세어 두었다

| 유틸 | 개수 (2026-09-06) |
|---|---:|
| `h-[48px]` | 39 |
| `h-[56px]` | 24 |
| `h-[64px]` | 18 |
| `h-[44px]` | 12 |
| `truncate` / `line-clamp-*` | 3 |

높이가 고정이면 두 줄이 될 때 **늘지 않고 잘린다.** 그리고 이 앱은 `truncate`를
거의 안 쓰므로, 넘치면 줄바꿈 후 잘린다.

**판정 기준**: 문구를 위 예산배(좁은 칸은 2배)로 늘렸을 때 잘리거나 줄 수가 늘면
고정 치수를 풀거나 칸을 넓힌다. **눈으로 보지 말고 의사 현지화(pseudo-localization)로
잰다.**

### 문구 규칙 (영어)

실어증 환자가 읽고 듣는 글이다. 한국어판은 어절 단위라 저절로 짧았고 구동사가
없어 사고가 안 났다. 영어는 둘 다 아니다.

| 기준 | 값 |
|---|---|
| 읽기 수준 | Flesch-Kincaid **5학년 이하** |
| 문장 길이 | **8단어 이하** |
| 지시 | 1문장 1지시 |
| 수동태 | 금지 |
| **구동사** | **금지** (`go ahead and`, `try out`, `pick up` …) — 의미가 단어 합으로 안 나와 실어증 환자가 가장 못 알아듣는다 |
| 말속도(TTS) | en-US **분당 130~140단어**. 음성별 `rate`를 역산해 맞춘다 |

`aria-label`도 같은 규칙을 따른다. **직역하지 않는다** — 한국어 aria 문구에는
배려가 들어 있고(놓친 날을 '실패'가 아니라 '쉼'으로 읽는 등) 직역하면 사라진다.

### 숫자의 세로 정렬

라벨이 1줄/2줄로 갈리면 그 아래 숫자의 세로 위치가 어긋난다. 숫자는 가로로
훑는 것이라 이건 위계 손상이다 — 라벨 영역 높이를 맞추거나 `align-items`로 받는다.

---

## 다크 모드 토큰 (미래 확장)

다크 모드는 현재 미구현. 추후 추가 시 아래 값 사용:

| 토큰 | 다크 값 |
|------|---------|
| `canvas` | `#141410` |
| `surface` | `#1E1C18` |
| `primary` | `#4A9E7E` |
| `primary-light` | `#1A2E27` |
| `ink` | `#F0EDE8` |
| `muted-sage` | `#9A948F` |
| `line` | `#2C2A26` |

---

## 레퍼런스

- 미리보기 HTML: `tmp/design-preview-1774691031.html`
- 경쟁사 분석: Spring Health (forest green + cream) 참조
- `/gstack-design-review` — 디자인 시스템 준수 여부 QA
