# 데일리 퀴즈 (Daily Quiz) Implementation Plan

> 작성일: 2026-05-17
> 작성자: Planning Agent
> 참조 문서:
> - `docs/history/20260321_MemoryLink_implementation_plan.md`
> - `docs/history/20260322_MemoryEntry_feature_plan.md`
> - `docs/history/20260322_AIService_feature_plan.md`
> - `CLAUDE.md`, `DESIGN.md`

---

## 1. 개요 및 목표

### 1-1. 목표

보호자가 환자와 관련된 **가이드된 Q&A 일기(무드 체크 + 카테고리별 짧은 답변 + 선택 사진)** 를 등록하면, **Gemini LLM이 환자 관련 답변만을 입력 삼아 5개 문제(4지선다 / 예·아니오 / 빈칸 채우기)** 를 자동 생성하고, 환자는 환자 대시보드에서 이를 **퀴즈 형식**으로 풀이한다. 풀이 결과는 즉시 피드백되며 **최고 점수**가 기록되어 재방문 시 동기를 부여한다.

본 모듈은 단순한 환자 인지 훈련 도구를 넘어, **양방향 치유(Bidirectional Healing)** — 즉 환자와 보호자가 서로의 회복에 기여하는 구조 — 를 핵심 가치로 삼는다. Phase 6부터는 보호자의 "한마디"가 환자 발화 연습 콘텐츠로 변환되고, 환자의 응답이 보호자에게 돌아오는 시너지 패턴(§11 Phase 6 참고)이 도입된다.

### 1-2. 배경

기존 Memory Link 모듈은 보호자가 사진·감정·목표단어를 등록하면 AI가 시나리오를 생성하고 환자가 **대화형 훈련**을 수행하는 구조다. 이번 데일리 퀴즈는 다음과 같은 보완적 가치를 제공한다:

- **낮은 인지 부하 (환자)**: 자유 대화보다 정답이 명확한 객관식이 초기 환자에게 부담이 적다.
- **보호자 입력 부담 완화**: 자유 텍스트 2000자 작성 부담을 폐기하고, 무드 이모지 + 카테고리별 짧은 질문 답변(2~3문항)으로 1~2분 내 완료 가능한 가이드 흐름으로 전환.
- **보호자 무드 관리 (부 목적)**: 매일의 무드 1~5단계 기록 + "나의 하루" 사적 리플렉션 1문항을 통해 보호자 본인의 정서적 자기관찰 루틴을 마련한다. 이 데이터는 LLM에 절대 전달되지 않는다.
- **즉시 피드백 + 게이미피케이션**: 점수·진행 바·최고 점수로 환자 동기 부여.
- **양방향 치유의 발판**: 환자 측 회복 콘텐츠뿐 아니라 보호자가 매일 관찰자/돌봄자/기록자 역할을 자연스럽게 수행하게 하여, 회복기 가족 단절 및 일방적 돌봄 부담을 완화한다.
- **기존 자산 재사용**: JWT, 파일 업로드, FastAPI 클라이언트, Gemini 클라이언트, 디자인 시스템을 그대로 활용.

> **임상 근거 메모**: 뇌졸중 후 회복기 환자에게는 가족과의 단절·일방적 돌봄 부담이 흔하며, 환자가 가족 회복에 기여한다는 효능감이 정서·언어 회복에 긍정적으로 작용한다는 임상 보고들이 존재한다. 본 모듈은 이 관점을 제품 가치로 명시한다.

### 1-3. 구현 범위

| 서비스 | 구현 내용 |
|--------|-----------|
| NestJS 백엔드 | `quiz` 모듈 신규 추가 (Entity/DTO/Controller/Service/Repository), `memory` 모듈에 `MoodEntry` / `CaregiverReflection` / `PatientMemoryNote` / `DiaryQuestion` 신규 엔티티 + `MemoryEntry.caregiverWishMessage` 컬럼 추가, 질문 풀 시더 |
| FastAPI AI 서비스 | `/quiz/generate` 라우터, Gemini 기반 5문제 생성 프롬프트 (입력은 `PatientMemoryNote` 답변만 사용) |
| React 프론트엔드 | 보호자 캡처 플로우를 3-step 가이드(무드 → 나의 하루 → 환자분의 하루 + 사진)로 재구성, 환자 측 퀴즈 풀이 화면 신규 |

### 1-4. 비범위 (Out of Scope)

- 음성 입력(STT) — 환자는 화면 터치/키보드로 답안 제출 (Phase 7+ 검토)
- 보호자 측 결과 리포트/통계 (Phase 8+)
- TTS 자동 읽기 — 옵션 토글로만 제공, 기본 비활성 (대화 모드와 구분)
- 기존 대화형 훈련 코드 변경 (양립)
- 보호자가 직접 녹음한 음성 응원(Pattern 3), 환자 → 보호자 음성 한마디(Pattern 5) — Phase 7+
- 무드↔콘텐츠 매칭(Pattern 4), 주간 회고 카드(Pattern 6) — Phase 8+ (누적 데이터 필요)

---

## 2. 확정된 요구사항 / 결정된 사항

### 2-1. 옵션 🅐 하이브리드 채택

| 항목 | 결정 |
|---|---|
| 기존 대화형 훈련 | **유지** (변경 없음) |
| 데일리 퀴즈 | **신규 추가** |
| 환자 대시보드 | **모드 토글 UI** (퀴즈 모드 / 대화 모드 선택) |
| 데이터 모델 | `MemoryEntry`는 **공통 입력 단위(메타·사진·태그·`caregiverWishMessage`)** 로 재사용. 일기 컨텍스트는 신규 `MoodEntry` / `CaregiverReflection` / `PatientMemoryNote`로 정규화. 퀴즈는 별도 `QuizSet`이 `MemoryEntry`를 참조하고, 생성 입력은 `PatientMemoryNote`만 사용 |
| LLM | **Gemini** (`ai-service/infra/gemini_client.py` 재사용) |
| 인증 | 기존 JWT (보호자 1계정 → 환자 종속) 그대로 |
| 파일 업로드 | `backend/memory/services/file-storage.service.ts` 재사용 |

### 2-2. 일기 입력 모델 변경 (하이브리드 가이드 Q&A)

기존 `diaryText` 자유 텍스트(2000자) 입력 모델은 **폐기**된다. 사유:

- 보호자가 매일 2000자 자유 작성하기는 현실적 부담이 크다.
- 보호자 본인의 무드/정서 관리도 본 앱의 부 목적이므로, 단순한 사실 기록을 넘어 **가이드된 회상·표현** 흐름이 필요하다.
- 환자 퀴즈 생성에 필요한 정보는 **카테고리별 짧은 문장**으로도 충분하다.

대안으로 채택된 하이브리드(🅓) + 2-트랙(🅑) 모델:

1. **무드 체크** (필수) — 5단계 이모지 😢😐🙂😊😍 → `MoodEntry`로 저장
2. **"나의 하루" 섹션** (선택) — 보호자 본인 질문 1개 (랜덤 풀에서 추출). 답변은 보호자만 보며 LLM에 절대 전달되지 않음 → `CaregiverReflection`
3. **"환자분의 하루" 섹션** (필수, 퀴즈 소스) — 카테고리별 환자 관련 질문 3개 (활동/순간/사람·장소·음식 각 1) → `PatientMemoryNote[]`
4. **사진 첨부** (선택) — 기존 `MemoryEntry.photoUrl` 흐름 재사용
5. **저장** → 무드 기록 + 환자 일기 → 퀴즈 자동 생성 트리거 (R1=(c))

> Phase 1 데이터 모델에 `MemoryEntry.caregiverWishMessage: text nullable` 필드를 미리 추가하여 Phase 6 양방향 치유 v1(Pattern 1) 진입 시 마이그레이션 없이 사용 가능하도록 한다 (H2 결정).

### 2-3. 양방향 치유 (Bidirectional Healing) 컨셉

환자와 보호자가 서로의 회복에 기여하는 6가지 시너지 패턴:

| Pattern | 설명 | 도입 시점 |
|---|---|---|
| 1 | 보호자 "지금 듣고 싶은 한마디" → 환자 발화 연습 콘텐츠로 자동 변환 (따라말하기 + LLM 빈칸 채우기 둘 다 옵션 제공 — H3) | **Phase 6** |
| 2 | 매일 함께 읽는 치유 메시지 (정적 풀 + 옵션 LLM 큐레이션) | **Phase 6** |
| 3 | 보호자가 직접 녹음한 응원 음성 → 환자 세션 시작 시 재생 | Phase 7+ |
| 4 | 무드 ↔ 콘텐츠 매칭 (보호자 무드 낮은 날 따뜻한 단어 우선) | Phase 8+ |
| 5 | 환자 → 보호자 한마디 (음성), 환자 풀이 완료 후 옵션 | Phase 7+ |
| 6 | 주간 "함께한 순간들" 회고 카드 | Phase 8+ |

H1 결정에 따라 Phase 6에서는 Pattern 1 + Pattern 2만 우선 도입한다.

### 2-4. 핵심 사용자 흐름

```
[보호자]
  로그인 → 환자 선택 → '오늘의 일기 쓰기' 진입
  → Step1: 무드 체크 (5단계 이모지, 필수)
  → Step2: 나의 하루 (보호자 자기 질문 1개, 선택, LLM 미전달)
  → Step3: 환자분의 하루 (카테고리별 질문 3개, 필수)
       + (선택) 사진 첨부
       + (선택, Phase 6 진입 후) "지금 듣고 싶은 한마디" caregiverWishMessage
  → 저장 → MemoryEntry + MoodEntry + CaregiverReflection? + PatientMemoryNote[] 생성
  → 자동으로 /quiz/generate/:memoryEntryId 트리거 (입력=PatientMemoryNote[]만)
  → "AI가 문제를 만들고 있어요" 로딩(10~20초)
  → QuizSet.generationStatus = 'ready' 폴링
  → 완료 안내 (환자 푸시는 Phase 8+)

[환자]
  로그인 → 환자 대시보드 → "퀴즈 모드" 탭
  → 풀 수 있는 QuizSet 목록 (날짜/제목/사진 썸네일/최고점)
  → 선택 → (Phase 6 도입 후) 보호자 한마디 카드 표시 + 따라말하기/빈칸 옵션
  → 문제 1/5 → 답 선택/입력 → 즉시 채점 색상(정답: 세이지 / 오답: 테라코타)
  → 다음 문제로 진행 (진행 바 갱신, 사진은 작은 힌트 카드로 항상 표시)
  → 5/5 완료 → 결과 화면(점수, 최고점 갱신 여부, 다시 풀기 버튼)
```

### 2-5. 문제 분포(권장 기본값)

- 4지선다: 2문제 (환자 관련 답변 속 장소/인물/음식/사물 식별)
- 예/아니오: 2문제 (환자 관련 답변 사실 확인)
- 빈칸 채우기: 1문제 (첫 글자 힌트 제공)

---

## 3. User Review Required

다음 항목들은 구현 진입 전 사용자(혹은 임상 자문)의 결정이 필요하다.

| # | 결정 필요 항목 | 옵션 |
|---|---|---|
| R1 | **퀴즈 자동 생성 트리거 시점** | (a) MemoryEntry 생성 즉시 자동 트리거 / (b) 보호자가 '퀴즈 만들기' 버튼 명시적 클릭 / (c) 둘 다 지원(기본=자동, 재생성 버튼 별도) |
| R2 | **일기에 사진 첨부 의무 여부** | (a) 사진 필수 / (b) 일기 텍스트만 있어도 가능(권장) / (c) 사진만 있고 텍스트 없어도 가능 |
| R3 | **점수 산정 방식** | (a) 정답 개수 그대로(0~5) / (b) 100점 만점 환산 / (c) 시간 보너스 포함 / (d) 문제 난이도 가중치(빈칸=2점, 객관식=1점) |
| R4 | **빈칸 채우기 채점 엄격도** | (a) 완전 일치만 정답 / (b) 띄어쓰기·받침 무시 / (c) 첫 글자만 맞으면 부분 정답(50%) / (d) Levenshtein 거리 1 이내 허용 |
| R5 | **재풀이 정책 / 최고 점수 정의** | (a) 무제한 재풀이, 모든 시도의 최고치 기록 / (b) 1일 1회 제한 / (c) 첫 시도만 점수 기록 (나머지는 연습용) |
| R6 | **문제 분포 가변성** | (a) 항상 4지선다 2 + 예아니오 2 + 빈칸 1 고정 / (b) 일기 내용 풍부도에 따라 LLM이 자동 조정 / (c) 보호자가 분포 선택 가능 |
| R7 | **사진 분석 사용 여부** | (a) 일기 텍스트만 LLM 입력 / (b) `/tag` 호출하여 photo_tags 병합 (비용↑, 품질↑) / (c) 사진은 풀이 화면 힌트로만 표시하고 LLM에는 전달 안 함 |
| R8 | **MemoryEntry.diaryText 마이그레이션 정책** | (a) 새 컬럼 nullable 추가 + 기존 row는 NULL 유지 / (b) NOT NULL + 기본값 '' / (c) 마이그레이션 시 `target_words.join(', ')`로 자동 채움 |
| R9 | **모드 토글 디폴트** | (a) 환자가 마지막 선택 모드 기억 / (b) 항상 '퀴즈 모드' 디폴트 / (c) '대화 모드' 디폴트 |
| R10 | **LLM 생성 실패/타임아웃 정책** | (a) 자동 재시도 1회 후 보호자에게 에러 표시 / (b) 폴백으로 LLM 없이 규칙 기반 빈칸 1문제만 생성 / (c) 실패 시 quiz_set은 생성하지 않음 |
| R11 | **신규 모듈 위치 명명** | (a) `backend/src/quiz/` (제안) / (b) `backend/src/memory/quiz/` (memory 하위 통합) |

> **권장 기본값**: R1=(c), R2=(b), R3=(b), R4=(b), R5=(a), R6=(b), R7=(c)→Phase 2 (b), R8=(a), R9=(a), R10=(a), R11=(a).

### ✅ 확정 결정 (2026-05-17, 사용자 승인)

| # | 확정값 | 비고 |
|---|---|---|
| R1 | (c) 자동 + 수동 둘 다 | 기본=자동, 재생성 버튼 별도 |
| R2 | **(b) 사진은 옵션** | 의미 재해석: 자유 텍스트 폐기 후 일기 컨텍스트는 **무드 + 환자 Q&A 답변**으로 구성. 사진은 옵션이며, 환자 Q&A 답변(`PatientMemoryNote`)이 최소 1개 이상 있어야 퀴즈 생성 가능. **Phase 2(Vision)에서 사진 필수화 재검토** |
| R3 | (b) 100점 환산 | 5문제 × 20점 |
| R4 | (b) 띄어쓰기·받침 무시 | 빈칸 채점 |
| R5 | (a) 무제한 재풀이, 최고치 기록 | |
| R6 | (b) LLM 자동 조정 | 기본 분포 4지선다 2 + 예아니오 2 + 빈칸 1 |
| R7 | **(c) 풀이 힌트만, LLM에 미전달** | **Phase 2에서 (b) /tag 병합으로 전환** |
| R8 | (a) nullable 컬럼 추가 | 기존 row는 NULL 유지. **의미 재해석**: `diaryText` 컬럼은 폐기. 동일 정책(nullable 신규 컬럼)을 `MemoryEntry.caregiverWishMessage`에 적용 (H2) |
| R9 | (a) 마지막 선택 모드 기억 | |
| R10 | (a) 재시도 1회 + 보호자 알림 | |
| R11 | (a) `backend/src/quiz/` | |

> 본 문서의 후속 섹션은 위 확정값을 기준으로 기술된다.
> **Phase 2 후순위 항목**: R2(a) 사진 필수화, R7(b) Gemini Vision 사진 분석 LLM 입력 병합.

### ✅ 추가 확정 결정 — 일기 입력 모델 / 양방향 치유 (2026-05-17)

| # | 항목 | 옵션 | 확정값 | 비고 |
|---|---|---|---|---|
| D1 | **무드 척도 형태** | (a) 5단계 이모지 😢😐🙂😊😍 / (b) 1~10 슬라이더 / (c) 텍스트 자유 입력 | **(a)** 5단계 이모지 | 보호자 1초 내 입력. `MoodEntry.moodLevel`은 INT 1..5 |
| D2 | **환자 관련 질문 개수/구성** | (a) 1개 통합 질문 / (b) 카테고리별 3개 (활동/순간/사람·장소·음식) / (c) 보호자 선택 1~5개 | **(b)** 카테고리별 3개 | 카테고리 enum: `activity` / `moment` / `context` |
| D3 | **질문 노출 방식** | (a) 매일 동일 / (b) 카테고리별 랜덤 추출 / (c) 보호자 직접 선택 | **(b)** 카테고리별 풀에서 랜덤 추출 | 매일 다른 질문 → 지루함 방지. `GET /diary-questions/today?scope=...&category=...` |
| H1 | **양방향 치유 우선 도입 Pattern** | (a) Pattern 1만 / (b) Pattern 1+2 / (c) Pattern 1+2+3 / (d) 모두 | **(b)** Phase 6 = **Pattern 1 + Pattern 2** | Pattern 3·5 → Phase 7(음성), Pattern 4·6 → Phase 8+(누적 데이터) |
| H2 | **`caregiverWishMessage` 컬럼 추가 시점** | (a) Phase 1에 미리 nullable 추가 / (b) Phase 6 진입 시 마이그레이션 / (c) 별도 테이블 | **(a)** Phase 1에 미리 `MemoryEntry.caregiverWishMessage TEXT NULL` 추가 | Phase 6 진입 매끄럽게. Phase 1에서는 UI 미노출 |
| H3 | **보호자 한마디 → 환자 콘텐츠 변환 방식** | (a) 따라말하기만 / (b) LLM 빈칸 채우기만 / (c) 둘 다 옵션 제공 | **(c)** 따라말하기 + LLM 빈칸 채우기 옵션 둘 다 | 환자 화면에서 토글 |

> **D/H 결정의 의미**:
> - 일기 입력은 **무드 + 카테고리 Q&A** 로 완전 전환되어, `MemoryEntry.diaryText` 컬럼은 본 plan에서 **신설하지 않는다**.
> - 보호자 사적 답변(`CaregiverReflection`)과 무드 데이터는 **LLM에 절대 전달하지 않는다** (§8 안전 가드, §14-3 참고).
> - Phase 1 데이터 모델은 Phase 6까지 매끄럽게 확장되도록 설계되며, Pattern 1·2 도입 시 신규 마이그레이션은 최소화된다.

---

## 4. 아키텍처 흐름도

```
┌──────────────────────── 보호자 흐름 (3-step 캡처) ────────────────────────┐
│                                                                          │
│  React (5173)                                                            │
│   CaptureScreen.tsx                                                      │
│    └── useCaptureFlow                                                    │
│         ├ Step1: MoodCheckStep   (필수, 5단계 이모지)                    │
│         │     └ GET /diary-questions/today?scope=patient (병렬 prefetch) │
│         ├ Step2: MyDayStep       (선택, 보호자 자기 질문 1개)            │
│         │     └ GET /diary-questions/today?scope=caregiver (랜덤 1개)    │
│         ├ Step3: PatientDayStep  (필수, 카테고리별 3개 질문 답변)        │
│         │     └ 사진 첨부(선택)                                          │
│         │     └ (Phase 6+) caregiverWishMessage 입력란                   │
│         └ POST /memory-entries (multipart, body 확장)                    │
│              │                                                            │
│              ▼                                                            │
│  NestJS (3000)                                                            │
│   MemoryController.create()                                               │
│    └── MemoryService.create()                                             │
│         ├ MemoryEntry row 저장 (+ caregiverWishMessage?)                  │
│         ├ MoodEntry row 저장                                              │
│         ├ CaregiverReflection row 저장 (있을 때만, isPrivate=true)        │
│         ├ PatientMemoryNote[] rows 저장                                   │
│         └── (R1=(c)이므로 자동) QuizService.requestGeneration(memoryId)   │
│                  │                                                        │
│                  ▼ (입력: PatientMemoryNote.answerText[] 만!)            │
│  POST http://ai-service:8000/quiz/generate                                │
│   FastAPI (8000)                                                          │
│    routers/quiz.py → services/quiz_service.py                             │
│     └── prompts/quiz_prompt.py + gemini_client.generate()                 │
│     └── JSON 5문제 반환                                                    │
│                                                                            │
│  NestJS                                                                    │
│   QuizService.persistGeneratedQuestions()                                 │
│    └── quiz_sets, quiz_questions row 저장                                  │
│         generationStatus: pending → ready                                 │
└───────────────────────────────────────────────────────────────────────────┘

* 보호자 사적 데이터(`MoodEntry`, `CaregiverReflection`)는 LLM 호출 경로에 절대 포함되지 않음.

┌──────────────────────────── 환자 흐름 ────────────────────────────┐
│                                                                   │
│  React (5173)                                                     │
│   PatientDashboard.tsx (모드 토글)                                │
│    └── 퀴즈 모드 선택                                              │
│         GET /quiz/sets?patientId=…                                │
│         └── QuizListScreen → 카드 선택                             │
│              GET /quiz/sets/:id  (정답 마스킹된 5문제)             │
│              ┌╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┐         │
│              ╎ (Phase 6) CaregiverWishCard                ╎         │
│              ╎  - caregiverWishMessage 표시               ╎         │
│              ╎  - "따라말하기" / "빈칸 채우기" 옵션 (H3)   ╎         │
│              └╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┘         │
│              └── QuizScreen → useQuizSession                       │
│                   - 문제 1~5 순회                                  │
│                   - 답안 제출 POST /quiz/sets/:id/attempts         │
│                   - 즉각 채점 결과 수신                             │
│              └── QuizResultScreen → GET /best-score 갱신           │
└───────────────────────────────────────────────────────────────────┘
```

> 점선 박스는 Phase 6에서 도입되는 양방향 치유 노드(Pattern 1·2). Phase 1~5에서는 렌더링되지 않는다.

---

## 5. 데이터 모델

### 5-1. MemoryEntry 확장

```
memory_entries (MODIFY)
─────────────
+ caregiver_wish_message  TEXT NULL
    -- (H2) Phase 6 양방향 치유 v1(Pattern 1)에서 보호자의 "지금 듣고 싶은 한마디".
    -- Phase 1에서는 컬럼만 미리 추가, UI 미노출.
    -- Phase 6 LLM 변환 입력으로 사용되며 환자 측 풀이 화면에 표시됨.
  (R8 권장: nullable, 마이그레이션은 새 컬럼만 추가)

> 참고: 기존 plan에서 검토되었던 `diary_text TEXT` 컬럼은 **추가하지 않는다.**
> 일기 컨텍스트는 신규 `mood_entries` / `caregiver_reflections` / `patient_memory_notes`
> 로 정규화되며, 자유 텍스트 2000자 입력 모델은 폐기되었다.

조건:
  - photo_url, target_words, emotion_tag는 기존대로 nullable 유지
  - 신규 row 검증 규칙(NestJS DTO, R2=(b) 의미 갱신):
      patient_memory_notes 최소 1개 이상 존재해야 함 (퀴즈 생성 가능 조건)
      mood_entries 1개 필수
      photo_url, caregiver_reflections, caregiver_wish_message는 모두 옵션
```

### 5-2. 신규 일기 컨텍스트 엔티티 ERD

```
mood_entries                           [NEW]
────────────────────────────────────────
id               UUID PK
memory_entry_id  UUID FK UNIQUE → memory_entries(id) ON DELETE CASCADE
caregiver_id     UUID FK → users(id)
mood_level       SMALLINT NOT NULL  CHECK (mood_level BETWEEN 1 AND 5)
                                     -- 1=😢, 2=😐, 3=🙂, 4=😊, 5=😍
recorded_at      TIMESTAMPTZ NOT NULL
INDEX (caregiver_id, recorded_at DESC)   -- Phase 8+ 추세 분석용
* LLM 전달 금지 (서비스 레이어 가드)

caregiver_reflections                  [NEW]
────────────────────────────────────────
id               UUID PK
memory_entry_id  UUID FK → memory_entries(id) ON DELETE CASCADE
caregiver_id     UUID FK → users(id)
question_id      UUID FK → diary_questions(id)
answer_text      TEXT NOT NULL
is_private       BOOLEAN NOT NULL DEFAULT TRUE   -- 보호자만 열람, LLM 미전달
created_at       TIMESTAMPTZ
INDEX (caregiver_id, created_at DESC)
* is_private=TRUE 인 row는 LLM/환자 화면 어디에도 노출 금지

patient_memory_notes                   [NEW]
────────────────────────────────────────
id               UUID PK
memory_entry_id  UUID FK → memory_entries(id) ON DELETE CASCADE
question_id      UUID FK → diary_questions(id)
category         VARCHAR(16) NOT NULL  -- 'activity' | 'moment' | 'context'
order_index      SMALLINT NOT NULL     -- 0..N (질문 순서)
answer_text      TEXT NOT NULL
created_at       TIMESTAMPTZ
UNIQUE (memory_entry_id, order_index)
INDEX (memory_entry_id, category)
* 퀴즈 LLM 생성의 유일한 텍스트 입력

diary_questions                        [NEW] (정적 시드)
────────────────────────────────────────
id               UUID PK
scope            VARCHAR(16) NOT NULL  -- 'caregiver' | 'patient'
category         VARCHAR(16) NULL      -- patient scope일 때만: 'activity' | 'moment' | 'context'
text             VARCHAR(200) NOT NULL
is_active        BOOLEAN NOT NULL DEFAULT TRUE
created_at       TIMESTAMPTZ
INDEX (scope, category, is_active)
* Seeder로 초기 10~15개 등록 (backend/src/memory/seeds/diary-questions.seed.ts)
* 예시(patient/activity): "오늘 어떤 활동을 함께 하셨나요?"
* 예시(patient/moment):   "오늘 가장 기억에 남는 순간은 무엇이었나요?"
* 예시(patient/context):  "오늘 만난 사람·다녀온 곳·드신 음식 중 하나를 적어주세요."
* 예시(caregiver):         "오늘 나에게 가장 힘들었던 순간은 무엇이었나요?"
```

### 5-3. 퀴즈 엔티티 ERD (변경 없음)

```
quiz_sets
─────────
id              UUID PK
memory_entry_id UUID FK → memory_entries(id) ON DELETE CASCADE
patient_id      UUID FK → users(id)
caregiver_id    UUID FK → users(id)
generation_status  VARCHAR(16)  -- 'pending' | 'ready' | 'failed'
generation_error   TEXT NULL    -- 실패 사유
created_at      TIMESTAMPTZ
ready_at        TIMESTAMPTZ NULL
INDEX (patient_id, generation_status, created_at DESC)

quiz_questions
──────────────
id              UUID PK
quiz_set_id     UUID FK → quiz_sets(id) ON DELETE CASCADE
order_index     INT          -- 0..4
type            VARCHAR(16)  -- 'multiple_choice' | 'yes_no' | 'fill_blank'
prompt          TEXT
choices         JSONB NULL   -- multiple_choice 시 ["서울","부산","제주","대전"]
correct_answer  TEXT         -- 정답 원본 (서비스 응답 시 마스킹)
hint_first_char VARCHAR(8) NULL  -- fill_blank 전용
explanation     TEXT NULL    -- (Phase 2) 정·오답 설명
UNIQUE (quiz_set_id, order_index)

quiz_attempts
─────────────
id              UUID PK
quiz_set_id     UUID FK → quiz_sets(id) ON DELETE CASCADE
question_id     UUID FK → quiz_questions(id)
patient_id      UUID FK → users(id)
session_token   UUID         -- 1회 풀이 세션 묶음 (5문제 그룹)
user_answer     TEXT
is_correct      BOOLEAN
answered_at     TIMESTAMPTZ
INDEX (quiz_set_id, session_token, answered_at)

quiz_best_scores
────────────────
id              UUID PK
quiz_set_id     UUID FK UNIQUE → quiz_sets(id) ON DELETE CASCADE
patient_id      UUID FK → users(id)
best_score      INT           -- 0..5 (R3 정책에 따라 환산)
best_session_token UUID
achieved_at     TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### 5-4. FK / 제약 / 인덱스 요약

| 테이블 | FK | 핵심 제약 | 인덱스 |
|---|---|---|---|
| `mood_entries` | memory_entry_id (UNIQUE), caregiver_id | mood_level CHECK 1..5 | (caregiver_id, recorded_at DESC) |
| `caregiver_reflections` | memory_entry_id, caregiver_id, question_id | is_private DEFAULT TRUE | (caregiver_id, created_at DESC) |
| `patient_memory_notes` | memory_entry_id, question_id | UNIQUE(memory_entry_id, order_index) | (memory_entry_id, category) |
| `diary_questions` | — | scope='patient' ⇒ category NOT NULL | (scope, category, is_active) |
| `memory_entries.caregiver_wish_message` | — | TEXT NULL | — |

---

## 6. 파일 구조 (NEW / MODIFY 표기)

### 6-1. Backend (NestJS) — `backend/src/`

```
quiz/                                            [NEW] 모듈 루트
├── quiz.module.ts                               [NEW]
├── quiz.controller.ts                           [NEW]
├── quiz.service.ts                              [NEW]
├── entities/
│   ├── quiz-set.entity.ts                       [NEW]
│   ├── quiz-question.entity.ts                  [NEW]
│   ├── quiz-attempt.entity.ts                   [NEW]
│   └── quiz-best-score.entity.ts                [NEW]
├── dto/
│   ├── generate-quiz.dto.ts                     [NEW]
│   ├── submit-attempt.dto.ts                    [NEW]
│   ├── quiz-set-summary.dto.ts                  [NEW]
│   └── quiz-question-public.dto.ts              [NEW] (correctAnswer 제외 응답용)
├── interfaces/
│   ├── IQuizGenerationClient.ts                 [NEW] (FastAPI 호출 추상화)
│   └── IQuizScorer.ts                           [NEW] (R3·R4 정책 캡슐화)
├── services/
│   ├── quiz-generation.client.ts                [NEW] (FastApiClientService 위임 어댑터)
│   └── quiz-scorer.service.ts                   [NEW] (채점 규칙 — R4 정책)
├── errors/
│   └── quiz.errors.ts                           [NEW]
└── constants/
    └── quiz-distribution.ts                     [NEW] (4지2/예아니오2/빈칸1)

memory/entities/memory-entry.entity.ts            [MODIFY] caregiverWishMessage 컬럼 추가 (Phase 6 대비)
memory/entities/mood-entry.entity.ts              [NEW] §5-2
memory/entities/caregiver-reflection.entity.ts    [NEW] §5-2
memory/entities/patient-memory-note.entity.ts     [NEW] §5-2
memory/entities/diary-question.entity.ts          [NEW] §5-2 (정적 시드 풀)
memory/dto/create-memory-entry.dto.ts             [MODIFY] mood / caregiverAnswer? / patientAnswers[] / caregiverWishMessage? / photo? (multipart) 검증
memory/dto/diary-question.dto.ts                  [NEW] GET /diary-questions/today 응답 DTO
memory/memory.controller.ts                       [MODIFY] GET /diary-questions/today 추가
memory/memory.service.ts                          [MODIFY]
    - MemoryEntry + MoodEntry + CaregiverReflection? + PatientMemoryNote[] 트랜잭션 저장
    - 생성 후 QuizService.requestGeneration 호출 (R1=(c) 자동 트리거)
    - QuizService에는 patient_memory_notes만 전달 (보호자 사적 데이터 격리)
memory/services/diary-question.service.ts         [NEW] scope/category별 랜덤 추출
memory/seeds/diary-questions.seed.ts              [NEW] 초기 10~15개 질문 풀
app.module.ts                                     [MODIFY] QuizModule import

database/migrations/                              [NEW]
├── 1747454300000-add-caregiver-wish-to-memory.ts          [NEW]
├── 1747454400000-create-mood-and-reflection-tables.ts     [NEW]  (mood_entries, caregiver_reflections, patient_memory_notes, diary_questions)
└── 1747454500000-create-quiz-tables.ts                    [NEW]
```

### 6-2. AI Service (FastAPI) — `ai-service/`

```
routers/quiz.py                                  [NEW] POST /quiz/generate
services/quiz_service.py                         [NEW] Gemini 호출 + 응답 파싱·검증
prompts/quiz_prompt.py                           [NEW] 한국어 임상 톤 프롬프트 템플릿
models/quiz.py                                   [NEW] Pydantic 요청/응답 모델
main.py                                          [MODIFY] include_router(quiz_router)
```

### 6-3. Frontend (React) — `frontend/src/`

```
memory-link/patient/quiz/                        [NEW]
├── domain/
│   ├── Quiz.ts                                  [NEW] QuizSet, QuizQuestion, QuizAttempt 타입
│   └── QuizScoring.ts                           [NEW] 점수 환산 헬퍼 (R3)
├── infrastructure/
│   └── QuizApi.ts                               [NEW] Axios 어댑터
├── application/
│   ├── useQuizList.ts                           [NEW] 풀 수 있는 QuizSet 목록 훅
│   └── useQuizSession.ts                        [NEW] 풀이 세션 훅 (idx/answers/score)
└── presentation/
    ├── QuizListScreen.tsx                       [NEW] 카드 목록
    ├── QuizScreen.tsx                           [NEW] 문제 풀이 컨테이너
    ├── QuizProgressBar.tsx                      [NEW]
    ├── QuizPhotoHint.tsx                        [NEW] 사진 힌트 카드
    ├── QuizResultScreen.tsx                     [NEW]
    └── components/
        ├── MultipleChoiceCard.tsx               [NEW]
        ├── YesNoButtons.tsx                     [NEW]
        └── FillBlankInput.tsx                   [NEW]

memory-link/patient/presentation/PatientDashboard.tsx   [MODIFY] 모드 토글(퀴즈/대화) 추가
memory-link/caregiver/application/useCaptureFlow.ts     [MODIFY] 3-step FSM (mood → myDay → patientDay) 및 검증
memory-link/caregiver/presentation/CaptureScreen.tsx    [MODIFY] 3-step 컨테이너 + 진행 인디케이터
memory-link/caregiver/presentation/MoodCheckStep.tsx    [NEW] 5단계 이모지 선택 (😢😐🙂😊😍)
memory-link/caregiver/presentation/MyDayStep.tsx        [NEW] "나의 하루" — 보호자 자기 질문 1개 (선택 입력)
memory-link/caregiver/presentation/PatientDayStep.tsx   [NEW] "환자분의 하루" — 카테고리별 질문 3개 + 사진 첨부 + (Phase 6) caregiverWishMessage
memory-link/caregiver/infrastructure/DiaryQuestionApi.ts [NEW] GET /diary-questions/today
memory-link/shared/MemoryLinkApi.ts                     [MODIFY] (필요 시) quiz 경로 baseURL 보장
```

---

## 7. API 엔드포인트 명세

### 7-1. NestJS Backend

#### POST `/memory-entries` (MODIFY — 기존 endpoint 바디 확장)

3-step 캡처 결과를 1회 multipart 요청으로 저장하고, 후속으로 퀴즈 자동 생성을 트리거한다.

- **Auth**: JWT (role=caregiver)
- **Content-Type**: `multipart/form-data`
- **Body fields**:
  - `patientId: UUID` (필수)
  - `mood: number` (필수, 1..5) — `MoodEntry.moodLevel`
  - `patientAnswers: JSON string` (필수, 1개 이상)
    ```json
    [
      { "questionId": "uuid", "category": "activity", "answerText": "..." },
      { "questionId": "uuid", "category": "moment",   "answerText": "..." },
      { "questionId": "uuid", "category": "context",  "answerText": "..." }
    ]
    ```
  - `caregiverAnswer?: JSON string` (선택)
    ```json
    { "questionId": "uuid", "answerText": "..." }
    ```
    저장 시 `is_private=true`로 강제. **LLM 호출 경로에 포함되지 않음**.
  - `caregiverWishMessage?: string` (선택, Phase 6에서만 UI 노출; Phase 1에서는 컬럼에만 저장 허용)
  - `photo?: file` (선택)
  - 기존 필드(`emotionTag`, `targetWords` 등)는 호환 유지
- **검증**:
  - `patientAnswers.length >= 1`
  - 각 `questionId`가 `diary_questions(scope='patient', is_active=true)`에 존재해야 함
  - `caregiverAnswer.questionId`는 `scope='caregiver'`여야 함
- **Response 201**: 기존 MemoryEntry 응답 형태 + `{ "quizSetId": "uuid", "generationStatus": "pending" }`

#### GET `/diary-questions/today?scope=:scope&category=:category`

질문 풀에서 활성 질문 중 랜덤 1개를 반환 (D3=(b)).

- **Auth**: JWT (role=caregiver)
- **Query**:
  - `scope`: `'caregiver' | 'patient'` (필수)
  - `category`: `'activity' | 'moment' | 'context'` (`scope='patient'`일 때 필수)
- **Response 200**:
  ```json
  { "id": "uuid", "scope": "patient", "category": "activity", "text": "오늘 어떤 활동을 함께 하셨나요?" }
  ```
- **에러**: 400 (scope=patient인데 category 누락), 404 `QUESTION_POOL_EMPTY`

> 클라이언트는 Step3 진입 시 카테고리별 3번 호출하여 3개 질문을 확보하며, Step2 진입 시 `scope=caregiver`로 1회 호출한다.

#### POST `/quiz/generate/:memoryEntryId`
보호자가 명시적 생성을 트리거할 때 사용 (자동 트리거와 별개, R1=(c)).

- **Auth**: JWT (role=caregiver)
- **Path**: `memoryEntryId: UUID`
- **Body**: 없음 (혹은 `{ force: boolean }` 재생성용)
- **Response 202 Accepted**:
  ```json
  { "quizSetId": "uuid", "generationStatus": "pending" }
  ```
- **에러**:
  - 404 `MEMORY_ENTRY_NOT_FOUND`
  - 403 `NOT_OWNER_OF_MEMORY_ENTRY`
  - 409 `QUIZ_SET_ALREADY_EXISTS` (force=false일 때)

#### GET `/quiz/sets?patientId=:uuid`
환자(또는 보호자)가 풀 수 있는 QuizSet 목록.

- **Auth**: JWT (role=patient 본인 또는 caregiver 보호 관계)
- **Query**: `patientId`, `status?='ready'`, `limit?=20`, `cursor?=ISO`
- **Response 200**:
  ```json
  {
    "items": [
      {
        "quizSetId": "uuid",
        "memoryEntryId": "uuid",
        "notePreview": "활동: 공원 산책 · 순간: 강아지를 만남 · ...",
        "photoUrl": "/uploads/...jpg" ,
        "generationStatus": "ready",
        "bestScore": 4,
        "createdAt": "2026-05-17T09:00:00Z"
      }
    ],
    "nextCursor": null
  }
  ```

#### GET `/quiz/sets/:id`
풀이용 5문제 조회. 정답은 응답에서 **제외**.

- **Auth**: JWT (해당 patient 본인 또는 그 caregiver)
- **Response 200**:
  ```json
  {
    "quizSetId": "uuid",
    "memoryEntry": {
      "photoUrl": "...",
      "caregiverWishMessage": null
    },
    "patientNotes": [
      { "category": "activity", "answerText": "..." },
      { "category": "moment",   "answerText": "..." },
      { "category": "context",  "answerText": "..." }
    ],
    "questions": [
      {
        "id": "uuid",
        "orderIndex": 0,
        "type": "multiple_choice",
        "prompt": "오늘 어디에 다녀왔나요?",
        "choices": ["공원","마트","병원","집"]
      },
      {
        "id": "uuid",
        "orderIndex": 4,
        "type": "fill_blank",
        "prompt": "오늘 ___을 만났어요.",
        "hintFirstChar": "강"
      }
    ]
  }
  ```
- **에러**: 404, 403, 409 (`QUIZ_NOT_READY` — generationStatus=pending|failed)

#### POST `/quiz/sets/:id/attempts`
답안 1개 또는 일괄 제출. 즉시 채점 결과 반환.

- **Auth**: JWT (patient 본인)
- **Body**:
  ```json
  {
    "sessionToken": "uuid",            // 클라이언트가 풀이 시작 시 생성 후 5문제 동안 동일 값 사용
    "answers": [
      { "questionId": "uuid", "userAnswer": "공원" }
    ]
  }
  ```
- **Response 200**:
  ```json
  {
    "results": [
      { "questionId": "uuid", "isCorrect": true, "correctAnswer": "공원" }
    ],
    "sessionScore": 1,
    "completed": false
  }
  ```
- 마지막 답안 제출 시 `completed: true`와 함께 점수 저장·최고점 갱신 여부 포함:
  ```json
  { "completed": true, "sessionScore": 4, "bestScore": 4, "isNewBest": true }
  ```
- **에러**: 404, 403, 410 `SESSION_EXPIRED`(>30분), 422 `INVALID_ANSWER_FORMAT`

#### GET `/quiz/sets/:id/best-score`
- **Response 200**: `{ "quizSetId": "uuid", "bestScore": 4, "achievedAt": "..." }` 또는 `{ "bestScore": null }`

### 7-2. FastAPI AI Service

#### POST `/quiz/generate`
- **Body** (Pydantic):
  ```json
  {
    "patient_notes": [
      { "category": "activity", "answer_text": "손주와 동네 공원에 갔다." },
      { "category": "moment",   "answer_text": "강아지를 만나서 반가웠다." },
      { "category": "context",  "answer_text": "벤치에 앉아 빵을 먹었다." }
    ],
    "photo_tags": { "location": "공원", "objects": ["강아지","벤치"] },   // optional, R7=(b)일 때만
    "target_words": ["공원","강아지"],                                   // optional
    "distribution": { "multiple_choice": 2, "yes_no": 2, "fill_blank": 1 } // 기본값 동일
  }
  ```
  > **중요**: 본 요청에는 `mood`, `caregiver_reflection`, `caregiver_wish_message` 등 보호자 사적 데이터를 **절대 포함하지 않는다** (§8-2 안전 가드 / §14-3).
- **Response 200**:
  ```json
  {
    "questions": [
      {
        "type": "multiple_choice",
        "prompt": "오늘 어디에 다녀왔나요?",
        "choices": ["공원","마트","병원","집"],
        "correct_answer": "공원"
      },
      {
        "type": "yes_no",
        "prompt": "오늘 강아지를 만났나요?",
        "correct_answer": "yes"
      },
      {
        "type": "fill_blank",
        "prompt": "오늘 ___을 만났어요.",
        "correct_answer": "강아지",
        "hint_first_char": "강"
      }
    ],
    "model": "gemini-1.5-pro",
    "elapsed_ms": 12340
  }
  ```
- **에러**: 422 `INVALID_PATIENT_NOTES` (note 0개 또는 총합 글자 수 < 10), 502 `LLM_UPSTREAM_ERROR`, 504 `LLM_TIMEOUT` (>25s)

---

## 8. LLM 프롬프트 설계 전략

### 8-1. 프롬프트 골격 (`ai-service/prompts/quiz_prompt.py`)

```
[시스템 역할]
당신은 한국어 언어재활 보조 도구의 문제 출제자입니다.
보호자가 작성한 짧은 카테고리별 메모(환자분의 하루)를 바탕으로,
뇌졸중 후 실어증 환자가 풀 수 있는 간단한 사실 확인 퀴즈 5문제를 만듭니다.

[안전 가드 (필수)]
- 의학적 진단/조언/예후 언급 금지
- 환자에게 정서적 부담을 줄 수 있는 표현(죽음, 사고 묘사 등) 사용 금지
- 입력으로 주어진 메모에 명시되지 않은 사실을 추측·창작 금지 (반드시 본문에서만 추출)
- 부정형/이중부정 문장 지양
- 모든 문장 12자 이하 권장, 최대 20자
- 본 프롬프트의 입력에는 보호자의 개인적·정서적 답변(무드, 자기 리플렉션, 한마디 등)이
  포함되어서는 안 됨. 만약 그러한 텍스트가 감지되면 무시한다.

[문제 분포]
- 4지선다 {{n_multiple_choice}}개
- 예/아니오 {{n_yes_no}}개
- 빈칸 채우기 {{n_fill_blank}}개

[유형별 규칙]
- multiple_choice: 정답 1 + 메모 외 단어 3개를 오답으로. 오답은 동일 카테고리(장소↔장소).
- yes_no: 메모 본문 사실은 yes, 본문과 모순되는 사실은 no.
- fill_blank: 메모 핵심 명사 1개를 빈칸 처리. hint_first_char = 정답의 첫 글자(공백 제외).

[입력 — 환자 관련 메모만 포함]
환자분의 하루(카테고리별 답변):
{{#each patient_notes}}
- [{{category}}] {{answer_text}}
{{/each}}

사진 태그(선택): {{photo_tags_json}}
목표 단어(선택, 가능하면 포함): {{target_words_csv}}

[출력 형식 — JSON만, 설명/markdown 금지]
{"questions": [ ... 5개 ... ]}
```

> **Phase 6 양방향 치유 v1 (Pattern 1) 전용 프롬프트는 본 프롬프트와 별도 파일(`prompts/wish_to_practice_prompt.py`)로 분리한다.**
> 해당 프롬프트는 `caregiverWishMessage` 1문장을 입력으로 받아 (a) 따라말하기 문장 1개 + (b) 핵심 명사 1개를 빈칸 처리한 빈칸 채우기 문장을 반환한다. **Phase 1 단계에서는 구현하지 않으며, 본 §8-1 메인 프롬프트의 입력에 절대 포함되지 않는다.**

### 8-2. 안전 가드 (코드 레벨)

`services/quiz_service.py`에서 LLM 응답 후 다음 검증:

1. JSON 파싱 실패 시 1회 재시도 (temperature=0).
2. 5개가 아니면 폴백: 부족분을 규칙 기반 빈칸(첫 명사) 문제로 채움 (R10 권장 (a) + (b) 혼합).
3. `correct_answer`가 입력 `patient_notes[*].answer_text` 합본에 존재하는지 부분 일치 검사 (multiple_choice/fill_blank만). 실패한 문제는 제거 후 폴백 보충.
4. 금칙어 필터 통과 (사망/사고/병명 등 사전 정의 리스트).
5. 각 문장 길이 30자 초과 시 절단 후 경고 로깅.

추가로 **NestJS 측 `QuizGenerationClient`에서**:

6. FastAPI 호출 직전 페이로드를 화이트리스트 직렬화 — `patient_notes`, `photo_tags?`, `target_words?`, `distribution?` 외 필드는 **누락 보장**. 보호자 사적 데이터(mood, caregiverReflection, caregiverWishMessage)는 객체에 진입조차 못 하도록 타입 단계에서 차단.
7. 로깅 시 페이로드를 hash로만 기록 (원문 미저장).

### 8-3. 비용/성능

- 모델: `gemini-1.5-flash` 권장(저비용, 일기 길이가 짧음). 품질 미달 시 `gemini-1.5-pro` 폴백.
- 평균 입력 토큰 200~500, 출력 토큰 300~600 → 회당 약 0.001 USD 수준.
- LangChain Output Parser(`PydanticOutputParser`) 사용 권장.

---

## 9. 프론트엔드 화면 흐름 및 디자인 시스템 적용

### 9-1. 화면 목록

| 화면 | 경로(라우터) | 핵심 컴포넌트 | 상태 |
|---|---|---|---|
| 보호자 캡처 (3-step) | `/caregiver/capture` | CaptureScreen + (MoodCheckStep → MyDayStep → PatientDayStep) | MODIFY |
| 환자 대시보드 (토글) | `/patient` | PatientDashboard + ModeToggle | MODIFY |
| 퀴즈 목록 | `/patient/quiz` | QuizListScreen | NEW |
| 퀴즈 풀이 | `/patient/quiz/:id` | QuizScreen + QuizProgressBar + QuizPhotoHint + (Phase 6) CaregiverWishCard | NEW |
| 퀴즈 결과 | `/patient/quiz/:id/result` | QuizResultScreen | NEW |

### 9-1-A. 보호자 3-step 캡처 화면 명세

| Step | 헤더 색상 토큰 | 필수 | 핵심 UI | 데이터 |
|---|---|---|---|---|
| 1. 무드 체크 | 세이지 그린 `#2D6A56` 헤더 + 크림 배이지 배경 | 필수 | 5단계 이모지 가로 정렬 (😢 1 / 😐 2 / 🙂 3 / 😊 4 / 😍 5), 각 버튼 88×88px, 선택 시 세이지 보더 + 살짝 확대(scale 1.05, 180ms ease) | `MoodEntry.moodLevel` |
| 2. 나의 하루 | **연한 라벤더/뉴트럴 톤** (예: `#F0EEF5`) — 보호자 사적 공간임을 시각적으로 구분 | 선택 | "오늘의 나에게" 부제 + 질문 카드 + 멀티라인 Textarea (최대 300자) + "건너뛰기" 보조 버튼. **자물쇠 아이콘 + "보호자 본인만 볼 수 있어요" 캡션** | `CaregiverReflection` |
| 3. 환자분의 하루 | 세이지 그린 헤더 + 크림 배이지 배경 (메인 톤) | 필수 | 카테고리별 카드 3개(활동/순간/사람·장소·음식), 각각 질문 텍스트 + Textarea (최대 200자) + 글자수 카운터. 하단: 사진 첨부(선택), Phase 6에서는 "지금 듣고 싶은 한마디" 입력란 추가(점선 박스) | `PatientMemoryNote[]` + optional `photoUrl` + `caregiverWishMessage` |

> Step 헤더 색상 차별화의 목적: Step 2는 **LLM에 전달되지 않는 사적 영역**임을 사용자에게 무의식적으로도 인지시키기 위한 시각적 신호. Step 1·3은 메인 톤(세이지 그린 + 크림 베이지) 유지.

### 9-1-B. 무드 이모지 5단계 시각 명세

| moodLevel | 이모지 | 라벨 | 선택 시 배경 |
|---|---|---|---|
| 1 | 😢 | 매우 힘들어요 | `bg-[#FBE9E2]` + border `#E07B54` |
| 2 | 😐 | 조금 힘들어요 | `bg-[#FCF3EC]` + border `#E0A984` |
| 3 | 🙂 | 보통이에요 | `bg-[#F7F6F3]` + border `#1F2A26` |
| 4 | 😊 | 좋아요 | `bg-[#EBF4F0]` + border `#2D6A56` |
| 5 | 😍 | 매우 좋아요 | `bg-[#D9EBE2]` + border `#1F5240` |

- 미선택 상태: `bg-white` + border `#E5E5E0`.
- 라벨은 시각 보조용으로 작게 표기(`text-sm text-[#5C6661]`), 이모지가 메인.

### 9-1-C. Phase 6 환자 화면 — `CaregiverWishCard` 노출 위치

```
[QuizScreen 진입 시]
 ├── 1. CaregiverWishCard (caregiverWishMessage가 NULL이 아닐 때만 렌더)
 │    └ 카드 본문: 한마디 텍스트
 │    └ 옵션 토글: "따라말하기" / "빈칸 채우기" (H3)
 │    └ "퀴즈로 이동" 버튼
 ├── 2. QuizPhotoHint (사진 있는 경우)
 └── 3. QuizProgressBar + 문제 1/5 ~ 5/5
```

> Phase 1~5에서는 `CaregiverWishCard` 컴포넌트 자체를 렌더링하지 않는다 (피처 플래그 or 단순 분기). 본 plan §11 Phase 6에서 도입.

### 9-2. 디자인 시스템 적용 (DESIGN.md 준수)

- **컬러**:
  - 정답 피드백: `bg-[#EBF4F0]` + border `#2D6A56` (세이지 그린)
  - 오답 피드백: `bg-[#FBE9E2]` + border `#E07B54` (테라코타)
  - 기본 카드: `bg-[#F7F6F3]` (크림 베이지), 텍스트 `#1F2A26`
- **폰트**: Pretendard (본문), Geist tabular-nums (점수/진행도 "3 / 5")
- **간격**: 8px 배수 — 카드 패딩 24/32, 버튼 높이 64(환자용 큰 타겟)
- **모서리**: 카드 `rounded-lg(16)`, 버튼 `rounded-md(12)`, 사진 힌트 `rounded-xl(24)`
- **모션**: 답 제출 → 색상 전환 180ms ease, 다음 문제 슬라이드 250ms ease-in-out (bounce 금지)
- **접근성**:
  - 모든 버튼 최소 48×48px, 환자용 메인 답안 버튼은 88px 이상
  - 색상 단독으로 정답/오답 표현 금지 → 아이콘(✓/✗) 동반
  - 진행 바에 `role="progressbar"`, `aria-valuenow` 부여
  - 빈칸 입력 `inputMode="text"`, `autoFocus`, IME(한글) 친화

### 9-3. 상태 머신 (QuizScreen FSM)

```
idle → loading_questions → ready
ready → answering(idx) → submitting → feedback(idx)
feedback(idx) → answering(idx+1)   (idx<4)
feedback(4)   → submitting_final → result
* any → error (retry)
```

---

## 10. 에러 / 타임아웃 처리

| 계층 | 시나리오 | 처리 |
|---|---|---|
| FastAPI | Gemini 응답 25초 초과 | `HTTPException(504, "LLM_TIMEOUT")` |
| FastAPI | JSON 파싱 실패 | 1회 재시도 → 실패 시 폴백 빈칸 문제 5개 (R10) |
| NestJS | FastAPI 5xx/타임아웃 | quiz_sets.generation_status='failed', error 저장 → 보호자 알림 |
| NestJS | 비정상 답안 (choices 외 값) | 422 + `INVALID_ANSWER_FORMAT` |
| NestJS | 세션 토큰 만료(30분) | 410 + `SESSION_EXPIRED` (재시작 유도) |
| Frontend (보호자) | 생성 pending 상태 | "AI가 문제를 만들고 있어요" 스피너 + 10초마다 폴링 (최대 60초) |
| Frontend (환자) | 네트워크 끊김 | 답안 로컬 큐(IndexedDB or sessionStorage) → 재연결 시 일괄 전송 |
| Frontend | 동일 sessionToken 중복 제출 | 서버는 멱등 처리(이미 채점된 answer 무시) |
| 전역 | 401 | 기존 MemoryLinkApi 401 인터셉터로 로그인 화면 리다이렉트 |

---

## 11. 구현 순서 (Phase별, 난이도)

### Phase 0: Plan 승인 + User Review (현재) — `[쉬움]`
- [ ] User Review R1~R11 확정
- [ ] 본 plan 수정 반영

### Phase 1: 데이터 모델 / 마이그레이션 — `[보통]`
- [ ] `[쉬움]` MemoryEntry.caregiverWishMessage TEXT NULL 컬럼 추가 + 마이그레이션 (H2)
- [ ] `[보통]` 신규 4개 엔티티 추가: `MoodEntry`, `CaregiverReflection`, `PatientMemoryNote`, `DiaryQuestion` + 단일 마이그레이션
- [ ] `[보통]` Quiz 4개 엔티티 + 마이그레이션 (변경 없음)
- [ ] `[쉬움]` `diary-questions.seed.ts` 작성 — patient(activity/moment/context 카테고리별 3~4개) + caregiver scope 3~4개
- [ ] `[보통]` `CreateMemoryEntryDto` 분기: multipart body에서 `mood`, `patientAnswers[]`, `caregiverAnswer?`, `caregiverWishMessage?` 파싱 + 검증 (R2=(b) 의미 갱신)
- [ ] `[보통]` `MemoryService.create()` 트랜잭션 확장: MemoryEntry + MoodEntry + CaregiverReflection? + PatientMemoryNote[] 일괄 저장
- [ ] `[쉬움]` `DiaryQuestionService` + `GET /diary-questions/today` 컨트롤러 메서드 추가
- [ ] `[쉬움]` MemoryService 단위 테스트 업데이트

### Phase 2: FastAPI 퀴즈 생성기 — `[어려움]`
- [ ] `[보통]` `models/quiz.py` Pydantic 정의 (`PatientNoteIn[]` 입력 모델)
- [ ] `[어려움]` `prompts/quiz_prompt.py` 작성 + Gemini 응답 안정화 (출력 파서)
- [ ] `[보통]` `services/quiz_service.py` (검증·폴백 포함, 입력 합본을 기준으로 정답 부분일치 검사)
- [ ] `[쉬움]` `routers/quiz.py` + `main.py` include
- [ ] `[보통]` pytest: 정상/타임아웃/JSON 깨짐/금칙어/길이 초과/보호자 데이터 누락 보장 6케이스

### Phase 3: NestJS 퀴즈 모듈 — `[보통]`
- [ ] `[보통]` QuizModule/Controller/Service 스켈레톤
- [ ] `[보통]` QuizGenerationClient (FastApiClientService 래핑) — **payload 화이트리스트 직렬화**로 보호자 데이터 진입 차단 (§8-2 step 6)
- [ ] `[보통]` QuizScorerService (R3, R4 정책 캡슐화)
- [ ] `[보통]` 권한 가드 (patient 본인 / 그 caregiver만)
- [ ] `[보통]` MemoryService 후크에서 자동 트리거 (R1=(c)) — 입력은 `patientMemoryNotes` 조회 후 전달
- [ ] `[어려움]` Jest 통합 테스트 (생성 자동/수동, 채점, best-score 갱신, **보호자 데이터 미전달 검증**)

### Phase 4: 프론트엔드 보호자 (3-step 캡처 플로우) — `[보통]`
- [ ] `[보통]` `useCaptureFlow.ts` 3-step FSM 재작성 (mood → myDay → patientDay)
- [ ] `[쉬움]` `MoodCheckStep.tsx` — 5단계 이모지 컴포넌트 (§9-1-B 색상 토큰)
- [ ] `[쉬움]` `MyDayStep.tsx` — 보호자 자기 질문 + Textarea + 자물쇠 캡션 + 건너뛰기
- [ ] `[보통]` `PatientDayStep.tsx` — 카테고리별 질문 3개 카드 + 사진 첨부 (Phase 6에서 wish 입력란 추가)
- [ ] `[쉬움]` `DiaryQuestionApi.ts` + 카테고리별 질문 prefetch
- [ ] `[쉬움]` `CaptureScreen.tsx` 컨테이너 + 진행 인디케이터(1/3 → 2/3 → 3/3)
- [ ] `[쉬움]` 저장 후 "AI가 문제를 만들고 있어요" 로딩 + 완료 토스트
- [ ] `[보통]` Vitest: step 진행, 검증, 무드 미선택 시 진행 차단, 카테고리 답변 누락 시 차단

### Phase 5: 프론트엔드 환자 — `[보통]`
- [ ] `[쉬움]` PatientDashboard 모드 토글
- [ ] `[보통]` QuizListScreen + QuizApi
- [ ] `[보통]` useQuizSession FSM
- [ ] `[보통]` QuizScreen + 유형별 컴포넌트 3종
- [ ] `[쉬움]` QuizProgressBar / QuizPhotoHint
- [ ] `[쉬움]` QuizResultScreen + 최고점 비교
- [ ] `[보통]` Vitest 컴포넌트 테스트 (정답 색상, 진행도, 빈칸 IME)

### Phase 6: 양방향 치유 v1 — Pattern 1 + Pattern 2 (H1) — `[보통]`
- [ ] `[보통]` `PatientDayStep.tsx`에 "지금 듣고 싶은 한마디" 입력란 노출 (`caregiverWishMessage`)
- [ ] `[보통]` 환자 `QuizScreen`에 `CaregiverWishCard` 컴포넌트 추가 (§9-1-C) — `caregiverWishMessage` 표시
- [ ] `[보통]` Pattern 1 변환: FastAPI `/wish/to-practice` 엔드포인트 신설 — 한마디 입력 시 (a) 따라말하기 문장 + (b) LLM 빈칸 채우기 문장 둘 다 반환 (H3)
- [ ] `[보통]` 환자 측 토글 UI: "따라말하기" / "빈칸 채우기" 옵션 선택
- [ ] `[보통]` Pattern 2 매일 큐레이션 메시지:
    - [ ] `healing_messages` 정적 풀 시드 (예: 20~30개) + 옵션 LLM 큐레이션 분기
    - [ ] 환자 + 보호자 양측 대시보드 상단에 "오늘의 메시지" 카드 노출
- [ ] `[보통]` 위 기능에 대한 통합 테스트 (한마디 변환 안정성, 메시지 회전 로직)

### Phase 7: QA / 디자인 폴리시 — `[보통]`
- [ ] `[쉬움]` 접근성 점검 (탭 순서, ARIA, 이모지 라벨 aria-label)
- [ ] `[보통]` Warm Clinical 디자인 토큰 일치 검수 (Step 2의 사적 영역 톤 차별화 검수 포함)
- [ ] `[보통]` 5초 풀이 시뮬레이션 + 네트워크 끊김 시나리오

### Phase 8+ (미래 작업) — `[참고]`
- [ ] **Pattern 3**: 보호자 응원 음성 녹음 → 환자 세션 시작 시 재생 (`VoiceNote` 엔티티 추가, 음성 저장 정책 결정 필요)
- [ ] **Pattern 5**: 환자 → 보호자 한마디 (음성), 풀이 완료 후 옵션
- [ ] **Pattern 4**: 무드↔콘텐츠 매칭 (누적 `mood_entries` 분석 → 따뜻한 단어 우선 노출)
- [ ] **Pattern 6**: 주간 "함께한 순간들" 회고 카드 (누적 MemoryEntry/MoodEntry 집계)
- [ ] R2(a) 사진 필수화 / R7(b) Gemini Vision 사진 태그 LLM 입력 병합

### Phase 9: 문서/walkthrough — `[쉬움]`
- [ ] `docs/history/20260517_DailyQuiz_walkthrough.md` 작성
- [ ] CLAUDE.md에 quiz 모듈 한 줄 추가 (선택)

---

## 12. 브랜치 전략 제안

### 현황
- 현재 작업 브랜치: `LOC_feature_plan` (LOC 검사 관련 다수 수정 진행 중)
- main과 분리된 다수 변경 사항 존재 (LOC 도메인 파일, SentComp, PatientDashboard 등)

### 제안: **신규 브랜치 분리 (강력 권장)**

1. **`main` 기준 새 브랜치 생성**: `feature/daily-quiz`
   - 이유: 데일리 퀴즈는 LOC 검사와 도메인이 완전히 다르므로 PR 단위를 분리해야 리뷰·롤백이 용이.
   - `LOC_feature_plan` 브랜치의 변경 사항은 별도 PR로 우선 정리(merge 또는 close).

2. **하위 브랜치 분할(선택, 큰 PR을 피하고 싶을 때)**:
   - `feature/daily-quiz/01-schema` — Phase 1 (마이그레이션 + 엔티티)
   - `feature/daily-quiz/02-ai` — Phase 2 (FastAPI)
   - `feature/daily-quiz/03-backend` — Phase 3 (NestJS 모듈)
   - `feature/daily-quiz/04-frontend` — Phase 4~5 (React)
   - 각 단계는 이전 단계 브랜치를 base로 사용.

3. **금지 사항**:
   - `main` 직접 푸시 금지
   - `LOC_feature_plan`에 퀴즈 코드 섞기 금지
   - 본 plan 승인 전 신규 브랜치 생성 금지 (사용자 지시: "새 브랜치 생성하지 말 것, 제안만")

---

## 13. Proposed Changes (파일 단위 표)

| # | 파일 | 종류 | 내용 |
|---|------|------|------|
| 1 | `backend/src/memory/entities/memory-entry.entity.ts` | MODIFY | `caregiverWishMessage: string \| null` 컬럼 추가 (H2) |
| 1a | `backend/src/memory/entities/mood-entry.entity.ts` | NEW | §5-2 스키마 |
| 1b | `backend/src/memory/entities/caregiver-reflection.entity.ts` | NEW | §5-2 스키마, isPrivate=true 기본값 |
| 1c | `backend/src/memory/entities/patient-memory-note.entity.ts` | NEW | §5-2 스키마, 퀴즈 LLM 입력의 유일 소스 |
| 1d | `backend/src/memory/entities/diary-question.entity.ts` | NEW | §5-2 정적 질문 풀 |
| 2 | `backend/src/memory/dto/create-memory-entry.dto.ts` | MODIFY | `mood: 1..5` (필수), `patientAnswers[]` (필수, 최소 1), `caregiverAnswer?`, `caregiverWishMessage?`, `photo?` 검증. R2=(b) 의미 갱신 |
| 2a | `backend/src/memory/dto/diary-question.dto.ts` | NEW | GET /diary-questions/today 응답 DTO |
| 2b | `backend/src/memory/services/diary-question.service.ts` | NEW | scope/category별 랜덤 추출 |
| 2c | `backend/src/memory/seeds/diary-questions.seed.ts` | NEW | 초기 10~15개 질문 풀 시드 |
| 3 | `backend/src/memory/memory.service.ts` | MODIFY | MemoryEntry + MoodEntry + CaregiverReflection? + PatientMemoryNote[] 트랜잭션 저장. 생성 후 `QuizService.requestGeneration(entry.id)` 호출 (R1=(c)). 보호자 사적 데이터는 quiz 호출 페이로드에 미포함 |
| 3a | `backend/src/memory/memory.controller.ts` | MODIFY | `GET /diary-questions/today` 핸들러 추가 |
| 4 | `backend/src/database/migrations/1747454300000-add-caregiver-wish-to-memory.ts` | NEW | `ALTER TABLE memory_entries ADD COLUMN caregiver_wish_message TEXT` |
| 4a | `backend/src/database/migrations/1747454400000-create-mood-and-reflection-tables.ts` | NEW | mood_entries / caregiver_reflections / patient_memory_notes / diary_questions 생성 + 인덱스 + CHECK 제약 |
| 5 | `backend/src/database/migrations/1747454500000-create-quiz-tables.ts` | NEW | quiz_sets/questions/attempts/best_scores 생성 + 인덱스 |
| 6 | `backend/src/quiz/quiz.module.ts` | NEW | TypeOrmModule + Memory/Auth import |
| 7 | `backend/src/quiz/quiz.controller.ts` | NEW | 5개 엔드포인트 (§7-1) |
| 8 | `backend/src/quiz/quiz.service.ts` | NEW | 생성 트리거, 조회, 채점, 최고점 갱신 |
| 9 | `backend/src/quiz/entities/quiz-set.entity.ts` | NEW | §5-1 스키마 |
| 10 | `backend/src/quiz/entities/quiz-question.entity.ts` | NEW | §5-1 스키마 |
| 11 | `backend/src/quiz/entities/quiz-attempt.entity.ts` | NEW | §5-1 스키마 |
| 12 | `backend/src/quiz/entities/quiz-best-score.entity.ts` | NEW | §5-1 스키마 |
| 13 | `backend/src/quiz/dto/generate-quiz.dto.ts` | NEW | `{ force?: boolean }` |
| 14 | `backend/src/quiz/dto/submit-attempt.dto.ts` | NEW | sessionToken + answers[] |
| 15 | `backend/src/quiz/dto/quiz-set-summary.dto.ts` | NEW | 목록 응답 형태 |
| 16 | `backend/src/quiz/dto/quiz-question-public.dto.ts` | NEW | correctAnswer 제외 |
| 17 | `backend/src/quiz/interfaces/IQuizGenerationClient.ts` | NEW | 추상 인터페이스 |
| 18 | `backend/src/quiz/interfaces/IQuizScorer.ts` | NEW | 채점 규칙 인터페이스 |
| 19 | `backend/src/quiz/services/quiz-generation.client.ts` | NEW | FastApiClientService 위임 |
| 20 | `backend/src/quiz/services/quiz-scorer.service.ts` | NEW | R3/R4 정책 구현 |
| 21 | `backend/src/quiz/errors/quiz.errors.ts` | NEW | 도메인 에러 enum + 매핑 |
| 22 | `backend/src/quiz/constants/quiz-distribution.ts` | NEW | 기본 분포 상수 |
| 23 | `backend/src/app.module.ts` | MODIFY | QuizModule import |
| 24 | `ai-service/routers/quiz.py` | NEW | POST /quiz/generate |
| 25 | `ai-service/services/quiz_service.py` | NEW | Gemini 호출 + 검증/폴백 |
| 26 | `ai-service/prompts/quiz_prompt.py` | NEW | §8-1 프롬프트 |
| 27 | `ai-service/models/quiz.py` | NEW | Pydantic 요청/응답 |
| 28 | `ai-service/main.py` | MODIFY | include_router(quiz_router) |
| 29 | `frontend/src/memory-link/caregiver/application/useCaptureFlow.ts` | MODIFY | 3-step FSM (mood → myDay → patientDay) + 검증 |
| 30 | `frontend/src/memory-link/caregiver/presentation/CaptureScreen.tsx` | MODIFY | 3-step 컨테이너 + 진행 인디케이터 |
| 30a | `frontend/src/memory-link/caregiver/presentation/MoodCheckStep.tsx` | NEW | 5단계 이모지 선택 |
| 30b | `frontend/src/memory-link/caregiver/presentation/MyDayStep.tsx` | NEW | 보호자 자기 질문 + 자물쇠 캡션 + 건너뛰기 |
| 30c | `frontend/src/memory-link/caregiver/presentation/PatientDayStep.tsx` | NEW | 카테고리별 질문 3개 + 사진 첨부 (+ Phase 6 wish 입력) |
| 30d | `frontend/src/memory-link/caregiver/infrastructure/DiaryQuestionApi.ts` | NEW | GET /diary-questions/today 어댑터 |
| 31 | `frontend/src/memory-link/patient/presentation/PatientDashboard.tsx` | MODIFY | 모드 토글 UI |
| 32 | `frontend/src/memory-link/patient/quiz/domain/Quiz.ts` | NEW | 타입 정의 |
| 33 | `frontend/src/memory-link/patient/quiz/domain/QuizScoring.ts` | NEW | 점수 환산 |
| 34 | `frontend/src/memory-link/patient/quiz/infrastructure/QuizApi.ts` | NEW | Axios 어댑터 |
| 35 | `frontend/src/memory-link/patient/quiz/application/useQuizList.ts` | NEW | 목록 훅 |
| 36 | `frontend/src/memory-link/patient/quiz/application/useQuizSession.ts` | NEW | 풀이 FSM 훅 |
| 37 | `frontend/src/memory-link/patient/quiz/presentation/QuizListScreen.tsx` | NEW | 카드 목록 |
| 38 | `frontend/src/memory-link/patient/quiz/presentation/QuizScreen.tsx` | NEW | 풀이 컨테이너 |
| 39 | `frontend/src/memory-link/patient/quiz/presentation/QuizProgressBar.tsx` | NEW | 진행 바 |
| 40 | `frontend/src/memory-link/patient/quiz/presentation/QuizPhotoHint.tsx` | NEW | 사진 힌트 카드 |
| 41 | `frontend/src/memory-link/patient/quiz/presentation/QuizResultScreen.tsx` | NEW | 결과 화면 |
| 42 | `frontend/src/memory-link/patient/quiz/presentation/components/MultipleChoiceCard.tsx` | NEW | 4지선다 |
| 43 | `frontend/src/memory-link/patient/quiz/presentation/components/YesNoButtons.tsx` | NEW | 예/아니오 큰 버튼 |
| 44 | `frontend/src/memory-link/patient/quiz/presentation/components/FillBlankInput.tsx` | NEW | 빈칸 입력 |

> **Phase 6 양방향 치유 v1에서 추가될 파일** (본 표에는 상세 미열거, 별도 Feature Plan에서 구체화):
> - `ai-service/routers/wish.py` (NEW) — POST `/wish/to-practice`
> - `ai-service/prompts/wish_to_practice_prompt.py` (NEW)
> - `backend/src/memory/services/healing-message.service.ts` (NEW) — Pattern 2 큐레이션
> - `backend/src/memory/seeds/healing-messages.seed.ts` (NEW) — 정적 풀
> - `frontend/src/memory-link/patient/quiz/presentation/CaregiverWishCard.tsx` (NEW)
> - `frontend/src/memory-link/shared/components/DailyHealingBanner.tsx` (NEW)

---

## 14. 위험 요소 및 마이그레이션

### 14-1. 데이터 마이그레이션 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| `memory_entries` 기존 row가 신규 정규화 테이블(`mood_entries`, `patient_memory_notes`)과 매칭되지 않음 | 기존 row는 퀴즈 생성 불가 상태 | 기존 row는 퀴즈 생성 대상에서 제외(서비스 레이어 필터). 보호자가 신규 캡처 플로우로 다시 등록하도록 안내 |
| 기존 보호자 화면에서 신규 필드(mood, patientAnswers) 없이 제출 시 422 발생 | 보호자 UX 깨짐 | 보호자 화면 동시 배포 + 캡처 화면 라우트 단일 진입점화. 피처 플래그 불필요(완전 교체) |
| 신규 4개 테이블 + memory_entries 컬럼 추가 마이그레이션 실패 시 partial state | DB 정합성 | **3개 마이그레이션 파일(caregiver_wish / mood-reflection / quiz)을 각각 단일 트랜잭션으로** 작성. 각 파일에 정확한 down 구현 |
| `diary_questions` 시드 누락 시 보호자 화면이 빈 질문으로 깨짐 | 캡처 차단 | Seeder가 마이그레이션 후 idempotent하게 실행되도록 보장. 시드 미실행 시 `GET /diary-questions/today` 404 → 클라이언트 폴백 메시지 |

### 14-2. LLM 관련 위험

| 위험 | 완화 |
|---|---|
| Gemini 응답 비결정성으로 동일 입력에 다른 문제 생성 → 사용자 혼란 | quiz_sets row에 1회 생성 후 고정(`force=true`로만 재생성), `seed` 파라미터 활용 |
| 입력 본문 외 사실 창작(환각) | 프롬프트 + 후처리 검증(§8-2 step 3, `patient_notes` 합본 기준 부분일치) |
| 임상적으로 부적절한 표현 생성 | 금칙어 필터 + 임상 자문 리뷰 1회 |
| API 비용 폭증 | `gemini-1.5-flash` 우선, 보호자당 일 5회 생성 제한(Throttle Guard, Phase 2) |
| Phase 6 Pattern 1 변환(`/wish/to-practice`)이 환자에게 부적절 표현 생성 | wish-to-practice 전용 별도 프롬프트 + 동일 금칙어 필터 + 변환 결과 보호자에게 미리 미리보기 후 환자 노출 |

### 14-3. 보안/프라이버시 (신규 항목 포함)

| 위험 | 완화 |
|---|---|
| **보호자 사적 답변(`CaregiverReflection`) 이 LLM에 누출** | (1) NestJS `QuizGenerationClient`에서 페이로드 화이트리스트 직렬화 (§8-2 step 6). (2) `CaregiverReflection.isPrivate=true` 기본값, 환자 화면 어디에서도 조회 불가. (3) Jest 통합 테스트로 FastAPI 호출 페이로드에 `caregiverAnswer` 필드가 절대 포함되지 않는지 검증. (4) 시스템 프롬프트에 명시적 안전 가드 한 줄 ("보호자 사적 답변은 절대 LLM에 전달되지 않음") |
| **무드 데이터 민감도** — 보호자 정신건강 추세는 매우 민감한 정보 | (1) `mood_entries`를 LLM에 절대 전달 금지(§8 안전 가드). (2) 환자 화면에는 무드 데이터 일체 노출 금지. (3) Phase 8+ Pattern 4 도입 시에도 보호자 본인만 추세 그래프 열람 가능. (4) 향후 외부 분석/로깅 도구 연동 시 mood 필드 마스킹 |
| 환자 음성 응답 저장 정책 (Pattern 5, Phase 7+) | 본 plan 범위 외이나, Phase 7 진입 전 별도 결정 필요: (a) 보호자만 청취 가능 / (b) 보존 기간 제한 / (c) 환자 동의 토글 |
| `patient_memory_notes` 텍스트가 PII 포함 (실명 등) | 기존 `/mask` 라우터 재사용해 LLM 입력 전 마스킹 (Phase 2 옵션) — 현 단계는 본문 그대로 사용 |
| FastAPI ↔ NestJS 평문 통신 | 내부망 한정 + 서비스 토큰 헤더 (현 Memory Link와 동일 정책) |
| 환자 답안에 다른 환자 quiz_set 조회 | guard에서 patient_id 일치 검증 (Jest 통합 테스트로 보강) |
| `caregiverWishMessage` 노출 범위 | Phase 1에서는 DB에만 저장(UI 미노출). Phase 6 진입 시 환자 본인 화면에만 노출, 다른 환자/사용자 접근 차단 |

### 14-4. UX/임상 위험

| 위험 | 완화 |
|---|---|
| 빈칸 채점 엄격해 환자 좌절 | R4=(b) 띄어쓰기·받침 무시 기본, 1글자 차이 부분 정답 옵션 |
| 오답 시 부정적 정서 자극 | "다시 한번 해볼까요?" 등 격려 카피, 빨간색 대신 테라코타(`#E07B54`)로 완화 |
| 동일 일기 반복 풀이로 단순 암기 | bestScore는 유지하되 "오늘의 도전" 같은 일별 새 셋 위주 UX 가이드 |

---

## 15. Verification Plan

### 15-1. 자동 테스트

```
# Backend
npm --workspace backend run test            # Jest 단위
npm --workspace backend run test:e2e        # quiz controller 통합

# AI service
cd ai-service && pytest tests/test_quiz_service.py -v

# Frontend
npm --workspace frontend run test           # Vitest

# 마이그레이션 검증
npm --workspace backend run typeorm migration:run
npm --workspace backend run typeorm migration:revert  # 롤백 확인
```

### 15-2. 수동 검증 시나리오

1. 보호자 로그인 → 환자 선택 → "오늘의 일기 쓰기" 진입.
2. **Step 1 (무드 체크)**: 😊(4) 선택 → 다음 버튼 활성화 확인.
3. **Step 2 (나의 하루)**: 질문 "오늘 나에게 가장 힘들었던 순간은?" 표시 → 답변 입력 또는 건너뛰기. 자물쇠 캡션 시각 확인.
4. **Step 3 (환자분의 하루)**: 카테고리별 질문 3개에 답변 — 활동 "공원 산책", 순간 "강아지를 만남", 사람·장소·음식 "벤치에서 빵". 사진 첨부 옵션.
5. 저장 → 보호자 화면에서 "AI가 문제를 만들고 있어요" 표시 → 20초 내 완료.
6. **백엔드 검증**: DB 확인 — `memory_entries` 1행, `mood_entries` 1행 (level=4), `caregiver_reflections` 0~1행 (isPrivate=true), `patient_memory_notes` 3행 (category 각각).
7. **FastAPI 호출 페이로드 검증**: 통합 테스트 또는 로그에서 `patient_notes`만 포함되고 `mood`, `caregiverAnswer`, `caregiverWishMessage`가 일체 미포함되었음을 확인.
8. 환자 로그인 → 퀴즈 모드 토글 → 목록에서 위 항목 선택.
9. 5문제 풀이: 정답 시 세이지 그린, 오답 시 테라코타 색상 확인.
10. 결과 화면에서 점수 표시 + "최고 점수 갱신!" 배지.
11. 다시 풀기 → 점수가 이전보다 낮으면 bestScore 미변경 확인.
12. 네트워크 끊김 시뮬레이션(개발자 도구 offline) → 마지막 답안 대기 → 재연결 시 정상 제출.
13. (Phase 6 진입 후 추가) 보호자가 Step 3 하단에서 "지금 듣고 싶은 한마디" 입력 → 환자 풀이 화면 진입 시 `CaregiverWishCard` 상단에 노출 → 따라말하기/빈칸 토글 정상 동작.

---

## 16. 다음 단계 (Plan 승인 이후)

1. ✅ **User Review R1~R11 답변 수령** (2026-05-17 완료, §3 확정 결정 참조)
2. ✅ **추가 결정 사항 수령** (2026-05-17 완료, §3 D1~D3 / H1~H3 결정 표 참조) — 일기 입력 모델 가이드 Q&A 전환 + 양방향 치유 컨셉 도입
3. ⏳ **Phase 1 Feature Plan 재작성** — `docs/history/20260517_DailyQuiz_Phase1_feature_plan.md`를 신규 데이터 모델(5개 엔티티 + caregiverWishMessage 컬럼 + 시더 + 3-step 캡처)에 맞게 재작성
4. ⏳ 브랜치 전략(§12) 확정 — 현재 작업 브랜치 `feature/daily-quiz` 유지
5. ⏳ Phase 1부터 순차 실행 (`feature-architect` → `clean-code-developer` → `unit-test-runner`)

---

> **본 문서는 plan 단계로, 코드 변경은 포함하지 않는다. 모든 신규/수정 사항은 사용자 승인 후 별도 PR로 진행한다.**
