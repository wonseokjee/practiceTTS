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
| `--accent` | `#E07B54` | 테라코타 강조색 — CTA, 기억 추가 등 |
| `--text` | `#1A1916` | 기본 텍스트 |
| `--muted` | `#6B6560` | 보조 텍스트, 플레이스홀더 |
| `--border` | `#E8E4DC` | 구분선, 테두리 |
| `--warning` | `#E8A23C` | 경고 상태 |
| `--danger` | `#C94040` | 오류, 세션 종료 등 위험 동작 |

### Tailwind v4 CSS 변수 설정 (index.css)

```css
@layer base {
  :root {
    --color-bg:            #F7F6F3;
    --color-surface:       #FFFFFF;
    --color-primary:       #2D6A56;
    --color-primary-light: #EBF4F0;
    --color-accent:        #E07B54;
    --color-text:          #1A1916;
    --color-muted:         #6B6560;
    --color-border:        #E8E4DC;
    --color-warning:       #E8A23C;
    --color-danger:        #C94040;
  }
}
```

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
