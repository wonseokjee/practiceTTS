# Design Audit — Memory Link (localhost:5173)
**Date:** 2026-03-28 | **Branch:** main | **Auditor:** /design-review

---

## Classifier
**APP UI** — 의료 보조 앱. 평가 화면(LOC/SentComp/WordComp) + 보호자 대시보드. 과제 중심, 정보 밀도 낮음, 접근성 최우선.

## First Impression (Phase 1)
The site communicates **"기본 스타터 키트"**. 구조는 단단하지만 색상 언어가 없었다.
I notice **Tailwind 파란색이 모든 곳을 지배하고 있었다** — 브랜드 의도 없이 기본값 그대로.
The first 3 things my eye goes to are: ① 파란 버튼 ② 회색 카드 ③ 시스템 폰트.
If I had to describe this in one word: **"미완성"**.

> *수정 후 첫인상:* **"따뜻한 임상"**. 세이지 그린이 의료 관행(파란색)을 의도적으로 거부한다. 크림 베이지 배경이 안심감을 준다.

---

## Inferred Design System (Phase 2)

**수정 전**
- Font: `system-ui, Avenir, Helvetica, Arial, sans-serif` — 브랜드 없음
- Primary: `oklch(0.623 0.214 259.815)` ≈ Tailwind blue-500 (#3B82F6)
- Background: `oklch(0.985 0.002 247.839)` ≈ Tailwind gray-50 (차가운 흰색)
- Touch target (LOC button): `bg-gray-200` 대기 / `bg-blue-500` 활성

**수정 후**
- Font: Pretendard (CDN) — 한국어 최적화 ✅
- Primary: #2D6A56 세이지 그린 (@theme blue remap) ✅
- Background: #F7F6F3 크림 베이지 (@theme gray-50 remap) ✅
- Touch target (LOC): `bg-[#EBF4F0]` + `border-[#2D6A56]` ✅

---

## Findings & Fix Status

| ID | 영향 | 카테고리 | 제목 | 상태 | 커밋 |
|----|------|----------|------|------|------|
| FINDING-001 | High | Typography | Pretendard 미적용, system-ui 사용 + index.html lang="en", title="frontend" | **verified** | 6a9fd28 |
| FINDING-002 | High | Color | 모든 버튼/탭/포커스가 Tailwind 파란색 (23개 파일) | **verified** | 4ac33a1 |
| FINDING-003 | High | Color | 페이지 배경이 gray-50, 크림 베이지 미적용 | **verified** | 4ac33a1 |
| FINDING-004 | Medium | Content | PatientSetupScreen 제목 "practiveTTS" (브랜드 미적용) | **deferred** | — |
| FINDING-005 | Medium | Interaction | LocTouchButton 활성 상태 solid blue → primary-light 아웃라인 | **verified** | 756fc7c |

---

## Litmus Scorecard

| Check | Before | After |
|-------|--------|-------|
| 1. Brand/product unmistakable in first screen? | NO | YES (세이지 그린) |
| 2. One strong visual anchor present? | NO | YES (터치 버튼 테두리) |
| 3. Page understandable by scanning headlines only? | YES | YES |
| 4. Each section has one job? | YES | YES |
| 5. Are cards actually necessary? | YES (assessment touch) | YES |
| 6. Does motion improve hierarchy? | NO | YES (audio wave) |
| 7. Premium with shadows removed? | NO | YES |

---

## Category Grades

| Category | Before | After | Notes |
|----------|--------|-------|-------|
| Visual Hierarchy | C | B | 레이아웃 구조 좋음, 여백 의도적 |
| Typography | D | B | Pretendard 적용, 스케일 일관성 유지 |
| Color & Contrast | D | B | @theme remap으로 23개 파일 일괄 적용 |
| Spacing & Layout | B | B | 8px 배수 체계 기존에도 잘 적용됨 |
| Interaction States | C | B | LocTouchButton 디자인 개선 |
| Responsive | B | B | 터치 타겟 44px 대부분 충족 |
| Content Quality | C | C | FINDING-004 (practiveTTS 제목) 미수정 |
| AI Slop | A | A | 패턴 없음 — 의료 앱으로 단순하고 올바름 |
| Motion | B | B | prefers-reduced-motion 추가 |
| Performance | A | A | 368ms 로드, FCP 빠름 |

---

## Design Score

| Metric | Before | After |
|--------|--------|-------|
| **Design Score** | **D** | **B** |
| **AI Slop Score** | **A** | **A** |

> D → B. Two CSS files (index.html + index.css) + one component. No regressions.

---

## Quick Wins (완료됨)

1. **Pretendard CDN** — index.html 한 줄. 즉시 모든 한국어 텍스트 개선.
2. **@theme blue remap** — index.css 10줄. 23개 파일을 건드리지 않고 전체 색상 전환.
3. **gray-50 remap** — 같은 @theme 블록에서. 크림 베이지 배경 즉시 적용.

---

## Deferred

- **FINDING-004**: `PatientSetupScreen.tsx` 제목 "practiveTTS" → "Memory Link" (Medium, ~5분)

---

## Fixes Applied

| # | Finding | Status | Files | Commit |
|---|---------|--------|-------|--------|
| 1 | FINDING-001 | verified | `frontend/index.html` | 6a9fd28 |
| 2 | FINDING-002+003 | verified | `frontend/src/index.css` | 4ac33a1 |
| 3 | FINDING-005 | verified | `frontend/src/assessments/loc/presentation/components/LocTouchButton.tsx` | 756fc7c |

**Design score delta: D → B. AI slop score: A (unchanged).**

PR Summary: Design review found 5 issues, fixed 4. Design score D → B, AI slop score A → A.
