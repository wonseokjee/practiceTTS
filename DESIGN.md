# Memory Link — Design System

**컨셉: Warm Clinical**
따뜻함과 신뢰를 동시에. 의료 앱의 차가운 청색 관행을 의도적으로 거부하고, 보호자와 환자 모두를 위한 따뜻한 공간을 만든다.

---

## 컬러 팔레트

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--bg` | `#F7F6F3` | 크림 베이지 페이지 배경 |
| `--surface` | `#FFFFFF` | 카드, 패널, 모달 |
| `--primary` | `#2D6A56` | 세이지 그린 주색상 — 버튼, 링크, 강조 |
| `--primary-light` | `#EBF4F0` | 연한 그린 배경 — 활성 상태, 뱃지 배경 |
| `--accent` | `#E07B54` | 테라코타 **면** — 연한 배경, 피드백 카드 테두리, 아이콘 칩 |
| `--accent-strong` | `#B85C36` | 테라코타 **잉크** — 흰 글씨를 받치는 채움, 강조 텍스트, 활성 컨트롤 경계 |
| `--text` | `#1A1916` | 기본 텍스트 |
| `--muted` | `#6B6560` | 보조 텍스트, 플레이스홀더 |
| `--border` | `#E8E4DC` | 구분선, 테두리 |
| `--warning` | `#E8A23C` | 경고 상태 |
| `--danger` | `#C94040` | 오류, 세션 종료 등 위험 동작 |

### 이 색들은 코드에서 어떻게 쓰이나

**CSS 변수가 아니다.** 컴포넌트가 Tailwind 임의값으로 hex를 직접 쓴다.

```tsx
<button className="bg-[#2D6A56] text-white">   {/* --primary */}
<p className="text-[#6B6560]">                  {/* --muted */}
```

위 표의 `--이름`은 **CSS에 존재하는 변수가 아니라 이 문서의 어휘**다. 어떤 hex가
무슨 뜻인지를 표가 정하고, 코드는 그 hex를 그대로 적는다. `index.css`에 있는
것은 폰트 토큰 둘뿐이다.

> 이 절에는 예전에 `@layer base { :root { --color-bg: … } }` 블록이 적혀 있었다.
> **그 코드는 어디에도 없었다.** 게다가 Tailwind v4에서 `:root`에 변수를 넣는 것은
> 유틸리티를 만들지 않는다(`@theme`가 그 일을 한다). 위치도 존재 여부도 틀린
> 스니펫이라, 보고 따라 쓰면 `bg-accent`가 조용히 아무 스타일도 내지 않는다.

**왜 토큰으로 안 옮겼나.** 옮길 대상이 77개 파일 1300개 hex(그중 팔레트 색 873개)다.
P2 정합성 수정의 크기가 아니라 별도 작업이라 TODOS의 `design-token-migration`으로
분리했다. 그리고 **반만 옮기면 안전망이 뚫린다** — `accentContrast.test.ts`가
소스에서 `#E07B54`를 grep해 "테라코타를 잉크로 쓴 줄"을 막는데, `bg-accent` 같은
별칭이 생기면 그 그물을 우회한다. 옮긴다면 한 번에 옮기고 그 테스트도 같이 고친다.

### 테라코타를 둘로 나눈 이유

`#E07B54`는 중간 톤이라 **흰색과 2.95:1**이다. 어떤 글자 크기에서도 WCAG 기준
(본문 4.5 / 큰 글씨·UI 경계 3.0)을 못 넘는다. 그런데 이 색을 "배경 + 흰 텍스트"로
쓰라고 적어둔 탓에, 앱에서 가장 눈에 띄어야 할 CTA가 가장 안 읽히는 버튼이었다.

색을 통째로 어둡게 하면 Warm Clinical의 온도가 내려간다 — 테라코타는 "의료 앱의
차가운 청색 관행을 거부"하려고 고른 색이다. 그래서 `--primary`/`--primary-light`가
이미 쓰는 방식대로 **면과 잉크를 나눴다.**

| 쓰임 | 토큰 | 흰색 대비 |
|------|------|-----------|
| 연한 배경(`/8`, `/15`), 아이콘 칩 | `--accent` | 해당 없음 |
| `#FBE9E2` 채움과 함께 쓰는 피드백 테두리 | `--accent` | 채움이 형태를 알려주므로 경계에 기대지 않는다 |
| 흰 글씨를 받치는 채움 | `--accent-strong` | **4.54:1** ✅ |
| 흰 배경 위 강조 텍스트·아이콘 | `--accent-strong` | **4.54:1** ✅ |
| 활성 컨트롤의 경계·포커스 링 | `--accent-strong` | **4.54:1** (3.0 필요) ✅ |

`--accent-strong`의 hover는 `#A04F2D`(5.75:1).

**판단 기준 한 줄:** 이 색이 **잉크이거나 컨트롤의 경계**면 `--accent-strong`,
**면**이면 `--accent`.

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
| `primary` | `--primary` | white | 주요 동작 — 검사 시작, 로그인 |
| `secondary` | `--primary-light` | `--primary` | 보조 동작 — 다음으로 |
| `ghost` | transparent | `--muted` | 취소, 세션 종료 |
| `accent` | `--accent` | white | 강조 CTA — 기억 추가 |
| `danger` | `--danger` | white | 위험 동작 (확인 후 노출) |

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
<div className="bg-white border border-[#E8E4DC] rounded-2xl p-5 shadow-sm">

// 점수 카드 (검사 결과)
<div className="bg-white border border-[#E8E4DC] rounded-3xl p-6 shadow-md text-center">
```

### 터치 버튼 (LOC 검사)
```tsx
<button className="w-full min-h-[200px] bg-[#EBF4F0] border-4 border-[#2D6A56] rounded-3xl
  flex flex-col items-center justify-center gap-3
  hover:bg-[#daeee7] active:scale-[0.98] transition-all duration-180">
```

### 배지
```tsx
// 상태별
<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
  bg-[#EBF4F0] text-[#2D6A56]">진행 중</span>
```

### 알림 (Alert)
```tsx
// 성공
<div className="bg-[#EBF4F0] border border-[#2D6A56]/25 rounded-xl px-4 py-3 text-sm text-[#1b5442]">

// 오류
<div className="bg-[#FEF0F0] border border-[#C94040]/25 rounded-xl px-4 py-3 text-sm text-[#8b2020]">
```

---

## 다크 모드 토큰 (미래 확장)

다크 모드는 현재 미구현. 추후 추가 시 아래 값 사용:

| 토큰 | 다크 값 |
|------|---------|
| `--bg` | `#141410` |
| `--surface` | `#1E1C18` |
| `--primary` | `#4A9E7E` |
| `--primary-light` | `#1A2E27` |
| `--text` | `#F0EDE8` |
| `--muted` | `#9A948F` |
| `--border` | `#2C2A26` |

---

## 레퍼런스

- 미리보기 HTML: `tmp/design-preview-1774691031.html`
- 경쟁사 분석: Spring Health (forest green + cream) 참조
- `/gstack-design-review` — 디자인 시스템 준수 여부 QA
