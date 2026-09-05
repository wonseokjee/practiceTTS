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

---

## 타이포그래피

| 역할 | 폰트 | 크기 | 굵기 | 용도 |
|------|------|------|------|------|
| 한국어 전반 | **Pretendard** | — | — | 모든 UI 텍스트 |
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
```html
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet" />
```

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
