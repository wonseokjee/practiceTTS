# 데일리 퀴즈 Phase 1 — 데이터 모델 / 마이그레이션 Feature Plan (Re-Written)

> 작성일: 2026-05-17 (재작성)
> 작성자: Feature Architect 에이전트
> 상위 계획: `docs/history/20260517_DailyQuiz_implementation_plan.md`
> 적용 범위: Implementation Plan §11.Phase 1 (데이터 모델 + 시드 + DTO + MemoryService 트랜잭션 회귀)
> 확정 결정 적용: R1~R11 (§3) + D1~D3 + H1~H3 (§3)

---

## 0. 본 문서의 위치 및 변경 이력

본 문서는 **이전 Phase 1 plan (단순 `diaryText` 자유 텍스트 가정) 을 폐기하고 완전히 재작성**한 결과다.
이전 가정은 다음과 같이 갱신되었다:

| 항목 | 이전 plan (폐기) | 본 plan (재작성) |
|---|---|---|
| 일기 입력 방식 | `MemoryEntry.diaryText` 자유 텍스트 (10~2000자) | 3-step 가이드 Q&A: **무드 + "나의 하루" + "환자분의 하루" 카테고리별 답변** |
| 신규 엔티티 수 | Quiz 4개 | **Memory 4개 (`MoodEntry`/`CaregiverReflection`/`PatientMemoryNote`/`DiaryQuestion`) + Quiz 4개 = 8개** |
| `MemoryEntry` 변경 | `diary_text` 컬럼 추가 | `caregiver_wish_message` 컬럼 추가 (Phase 6 양방향 치유 v1 사전 준비) |
| 마이그레이션 분할 | 2개 | **4개 (caregiver_wish + mood-reflection 그룹 + quiz 그룹 + diary-questions 시드)** |
| LLM 입력 격리 | 명시되지 않음 | **`PatientMemoryNote.answerText`만 LLM 입력**, 보호자 답변/무드는 **타입 단계에서 차단** |
| 양방향 치유 | 없음 | Phase 6 v1(Pattern 1+2) 사전 컬럼 준비 (`caregiverWishMessage`) |

본 Phase의 핵심 가치는 동일하다:

- **데이터 모델 안정화**: 뒤이은 Phase 2~6이 의존하는 스키마를 변경 없이 사용 가능.
- **무중단·롤백 가능성**: 운영 DB(미래)에 적용해도 기존 Memory Link 데이터를 손상시키지 않는다.
- **LLM 입력 격리 보안**: 보호자 사적 데이터가 LLM 경로에 진입조차 못 하도록 **구조 자체에서 차단**.
- **테스트 가능성**: 모든 DTO 검증·엔티티 제약·트랜잭션 규칙은 단위 테스트로 검증 가능해야 한다.

---

## 1. 개요 및 범위

### 1-1. Phase 1 Deliverable

| # | Deliverable | 종류 | 비고 |
|---|---|---|---|
| D1 | `memory_entries.caregiver_wish_message TEXT NULL` 컬럼 추가 | DB 스키마 변경 | Phase 6 사전 준비, UI 미노출 |
| D2 | `mood_entries` 테이블 신설 | DB 스키마 추가 | 1:1 `memory_entry_id` UNIQUE FK, CHECK(1..5) |
| D3 | `caregiver_reflections` 테이블 신설 | DB 스키마 추가 | `is_private=true` 기본, **LLM 미전달 마킹** |
| D4 | `patient_memory_notes` 테이블 신설 | DB 스키마 추가 | **퀴즈 LLM 입력의 유일 소스** |
| D5 | `diary_questions` 테이블 신설 + 14개 시드 데이터 | 정적 풀 + 시더 | 보호자 5 + 환자 활동 3 + 환자 순간 3 + 환자 맥락 3 |
| D6 | `quiz_sets`, `quiz_questions`, `quiz_attempts`, `quiz_best_scores` 4개 테이블 신설 | DB 스키마 추가 | FK + 인덱스 + UQ(best_score) |
| D7 | TypeORM 엔티티 8종 신설 (Memory 4 + Quiz 4) | 도메인 모델 | |
| D8 | TypeORM 마이그레이션 **4개 파일** 신설 | 스키마 적용 도구 | 분할 사유 §4-1 |
| D9 | `MemoryEntry` 엔티티에 `caregiverWishMessage` 필드 추가 | 도메인 모델 수정 | nullable text |
| D10 | `CreateMemoryEntryDto` 재설계 (3-step 입력) | DTO 수정 | mood/patientAnswers/caregiverAnswer?/caregiverWishMessage?/photo? |
| D11 | `MemoryEntryResponseDto` 분리: 환자 공개용 + 보호자 사적용 | DTO 분리 | 보안: 사적 데이터 응답 차단 |
| D12 | `MemoryEntryService.create()` 트랜잭션 확장 | 도메인 서비스 | 단일 트랜잭션 내 5개 row 일괄 저장 |
| D13 | `DiaryQuestionService` + `GET /diary-questions/today` 신설 | 도메인 서비스 + API | 카테고리별 랜덤 1개 추출 |
| D14 | `QuizModule` 골격 (TypeOrmModule.forFeature 등록) + `AppModule` import | 모듈 등록 | Service/Controller는 Phase 3 |
| D15 | `MemoryEntryService.create()` 트랜잭션 회귀 테스트 8 케이스 | 단위 테스트 | §10 참조 |
| D16 | `CreateMemoryEntryDto` 검증 테스트 5 케이스 | 단위 테스트 | §10 참조 |
| D17 | `diary-questions.seed.ts` 멱등성 테스트 | 단위 테스트 | 중복 적용 안전성 |
| D18 | LLM 입력 격리 보안 회귀 테스트 (응답 DTO 직렬화) | 단위 테스트 | 보호자 답변/무드 응답 미포함 |

### 1-2. Phase 1에서 **하지 않는** 것 (명시적 비범위)

- ❌ `QuizService` / `QuizController` 구현 (Phase 3)
- ❌ FastAPI `/quiz/generate` 엔드포인트 (Phase 2)
- ❌ FastAPI 호출 (Phase 3)
- ❌ `MemoryEntryService.create()` 후크에서 `QuizService.requestGeneration()` 호출 (Phase 3)
- ❌ 채점 로직 (`QuizScorerService`) (Phase 3)
- ❌ 프론트엔드 변경 (Phase 4~5)
- ❌ `caregiverWishMessage` UI 노출 (Phase 6)
- ❌ Pattern 1 변환 (`/wish/to-practice`) (Phase 6)
- ❌ 기존 `memory_entries` row의 신규 정규화 테이블로의 데이터 백필 — 기존 row는 퀴즈 대상에서 제외(Phase 3 서비스 필터)
- ❌ DB CHECK 제약 (점수 0~100, generation_status enum) — 애플리케이션 레벨만 (이전 plan §11-Q3·Q4 결정 유지)

### 1-3. 사전 조건 (Pre-conditions)

- Implementation Plan §3의 R1~R11 + D1~D3 + H1~H3 결정 확정됨 (✅ 2026-05-17).
- 작업 브랜치: `feature/daily-quiz` (현재 브랜치 유지, Implementation Plan §12).
- 이전 Phase 1 plan에서 결정 보류로 남았던 6개 항목(P1-Q1 ~ P1-Q6)은 **재작성 과정에서 일괄 정리** (§13 추가 결정 필요 항목 참조).

---

## 2. 클린 아키텍처 레이어 매핑

본 프로젝트의 NestJS 백엔드는 다음 3계층 + 인프라 1계층 구조를 채택한다. 본 Phase 1에서는 **모듈 골격·엔티티·DTO·서비스 트랜잭션·시드**까지를 다루며, 외부 통합(FastAPI 호출)·HTTP 엔드포인트(Quiz 5개)는 Phase 2~3로 미룬다.

```
backend/src/
├── memory/                                            [MODIFY 모듈]
│   ├── entities/
│   │   ├── memory-entry.entity.ts                    [MODIFY] caregiverWishMessage 컬럼
│   │   ├── mood-entry.entity.ts                      [NEW] §4-2
│   │   ├── caregiver-reflection.entity.ts            [NEW] §4-3
│   │   ├── patient-memory-note.entity.ts             [NEW] §4-4
│   │   └── diary-question.entity.ts                  [NEW] §4-5
│   ├── dto/
│   │   ├── create-memory-entry.dto.ts                [MODIFY] 3-step nested DTO
│   │   ├── memory-entry-response.dto.ts              [MODIFY] 환자 공개용 — 사적 필드 제외
│   │   ├── memory-entry-private-response.dto.ts      [NEW] 보호자 사적 응답 (CaregiverReflection + Mood)
│   │   ├── patient-memory-note-input.dto.ts          [NEW] 3-step DTO 일부 (nested)
│   │   ├── caregiver-reflection-input.dto.ts         [NEW] 3-step DTO 일부 (nested)
│   │   ├── diary-question.dto.ts                     [NEW] GET /diary-questions/today 응답
│   │   └── diary-question-query.dto.ts               [NEW] scope/category 쿼리 검증
│   ├── services/
│   │   └── diary-question.service.ts                 [NEW] 카테고리별 랜덤 추출
│   ├── seeds/
│   │   └── diary-questions.seed.ts                   [NEW] 14개 초기 시드 (멱등)
│   ├── memory.module.ts                              [MODIFY] 신규 4개 엔티티 + Service 등록
│   ├── memory.controller.ts                          [MODIFY] 3-step body 수신 + GET /diary-questions/today
│   └── memory.service.ts                             [MODIFY] 단일 트랜잭션 확장
│
├── quiz/                                              [NEW 모듈 — Phase 1은 골격만]
│   ├── entities/
│   │   ├── quiz-set.entity.ts                        [NEW] §4-6
│   │   ├── quiz-question.entity.ts                   [NEW] §4-7
│   │   ├── quiz-attempt.entity.ts                    [NEW] §4-8
│   │   └── quiz-best-score.entity.ts                 [NEW] §4-9
│   ├── constants/
│   │   ├── quiz-generation-status.ts                 [NEW] 'pending'|'ready'|'failed'
│   │   └── quiz-question-type.ts                     [NEW] 'multiple_choice'|'yes_no'|'fill_blank'
│   └── quiz.module.ts                                [NEW] TypeOrmModule.forFeature 등록만
│
├── database/
│   └── migrations/                                    [NEW 디렉토리]
│       ├── 1747454300000-add-caregiver-wish-to-memory.ts          [NEW]
│       ├── 1747454400000-create-mood-and-reflection-tables.ts     [NEW] 4개 테이블 (mood/caregReflection/patientNote/diaryQuestion)
│       ├── 1747454500000-create-quiz-tables.ts                    [NEW] 4개 테이블
│       └── 1747454600000-seed-diary-questions.ts                  [NEW] 14개 row 멱등 적용
│
└── app.module.ts                                      [MODIFY] QuizModule import
```

**레이어 의존 규칙 (Phase 1 적용)**

- `memory/entities/*` 및 `quiz/entities/*` 는 NestJS 런타임 객체에 의존하지 않는다 (TypeORM 데코레이터만).
- `memory/dto/*` 는 `class-validator`/`class-transformer` 외 NestJS 런타임 객체 직접 참조 금지 (`Express.Multer.File`은 컨트롤러 경계에서만).
- `memory/services/diary-question.service.ts` 는 `MemoryEntry`/`User`에 의존하지 않고 `DiaryQuestion`만 사용한다 (단일 책임).
- `quiz/entities/quiz-set.entity.ts` 는 `MemoryEntry`/`User` 엔티티를 import할 수 있다 (FK 관계 정의 목적, **NestJS 모듈 의존 아님**).
- `QuizModule` → `MemoryModule` 의존 허용 (Phase 3부터). **`MemoryModule` → `QuizModule` 의존 금지** (Phase 1·이후 전 phase).

---

## 3. 도메인 모델링 (Entities & Value Objects)

### 3-1. 핵심 엔티티 (식별자 보유)

| 엔티티 | 책임 | 식별자 | 불변 조건 |
|---|---|---|---|
| `MemoryEntry` | 라이프로그 단위 (사진 + 메타 + 새 컬럼 caregiverWishMessage) | id (UUID) | caregiverId/patientId 변경 불가 |
| `MoodEntry` | **보호자 본인의 무드 1~5** (1일 1회 권장, 1:1 with MemoryEntry) | id (UUID) | moodLevel 1..5; memoryEntryId UNIQUE |
| `CaregiverReflection` | **보호자 사적 답변** ("나의 하루") | id (UUID) | isPrivate=true 강제; LLM 미전달 |
| `PatientMemoryNote` | **환자 관련 답변** ("환자분의 하루") | id (UUID) | category ∈ {activity, moment, context}; memoryEntryId당 최소 1개 |
| `DiaryQuestion` | 정적 질문 풀 | id (UUID) | scope ∈ {caregiver, patient}; scope='patient'면 category 필수 |
| `QuizSet` | 1개 라이프로그에서 생성된 5문제 묶음 | id (UUID) | quiz_set:memory_entry = 1:0..1 (재생성 정책은 Phase 3) |
| `QuizQuestion` | 1개 문제 | id (UUID) | UNIQUE(quizSetId, orderIndex) |
| `QuizAttempt` | 1개 응답 시도 | id (UUID) | quizSetId + questionId + patientId 조합 무제한 (R5=(a)) |
| `QuizBestScore` | 퀴즈 셋당 최고 점수 1행 | id (UUID) | UNIQUE(quizSetId); 0..100 |

### 3-2. 값 객체 (불변)

본 Phase에서 식별자 없이 값으로만 다뤄지는 객체:

- **MoodLevel** (`type MoodLevel = 1 | 2 | 3 | 4 | 5`) — TypeScript 타입 별칭으로 표현 (`memory/types/mood-level.types.ts` 신설 가능, 또는 entity 내부 import 시점에 정의).
- **PatientNoteCategory** (`type PatientNoteCategory = 'activity' | 'moment' | 'context'`).
- **CaregiverReflectionScope / PatientQuestionScope** — `DiaryQuestion.scope` 값.

> 본 Phase에서는 별도 클래스 객체 생성보다 **타입 별칭 + class-validator @IsEnum**으로 충분하다. 향후 Phase 3 QuizScorer에서 정답 검증 로직이 복잡해지면 Value Object 클래스 도입 검토.

### 3-3. 유스케이스 (Phase 1 직접 영향)

| UC | Actor | 사전 조건 | 정상 흐름 | 예외 흐름 | 사후 조건 |
|---|---|---|---|---|---|
| **UC-1: 3-step 라이프로그 등록** | 보호자 | JWT 유효, `patientId == caregiver.patientId`, `patientAnswers.length >= 1` OR `photo` 첨부 | (1) DTO 검증 → (2) DB 트랜잭션 시작 → (3) MemoryEntry 저장 → (4) MoodEntry 저장 → (5) CaregiverReflection 저장(있을 때) → (6) PatientMemoryNote[] 일괄 저장 → (7) (사진 있으면) FastAPI tag/mask 호출 (best-effort) → (8) 트랜잭션 커밋 → (9) Public 응답 반환 | (a) DTO 검증 실패 → 400 / (b) 소유권 위반 → 403 / (c) DB 저장 실패 → 트랜잭션 롤백 + 사진 파일 cleanup → 500 / (d) FastAPI 실패 → 부분 성공 허용 (Phase 1 기존 동작 유지) | MemoryEntry + MoodEntry + (optional)CaregiverReflection + PatientMemoryNote[] 모두 영속화 |
| **UC-2: 오늘의 질문 1개 조회** | 보호자 | JWT 유효 | (1) Query 검증 → (2) `is_active=true` 풀에서 `scope`/`category` 필터 → (3) 랜덤 1개 반환 | (a) scope=patient인데 category 누락 → 400 / (b) 풀 비어있음 → 404 `QUESTION_POOL_EMPTY` | 클라이언트가 Step2/Step3 진입 시 질문 prefetch |
| **UC-3 (Phase 1 비범위, 구조만 준비)**: 환자 사이드 응답 직렬화 | 환자 (Phase 3에서 호출) | — | Public DTO만 노출, CaregiverReflection·MoodEntry 응답 직렬화 금지 | — | LLM/환자 응답 경로에 보호자 사적 데이터 누출 0건 |

---

## 4. 데이터 모델 상세 (테이블·컬럼·제약·인덱스)

> **9개 엔티티 총합**: `memory_entries` (MODIFY) + Memory 4 (NEW) + Quiz 4 (NEW).

### 4-1. `memory_entries.caregiver_wish_message` (MODIFY)

| 항목 | 값 | 비고 |
|---|---|---|
| 컬럼명 | `caregiver_wish_message` | snake_case |
| TS 필드명 | `caregiverWishMessage` | camelCase |
| 타입 | `TEXT` | DTO에서 1~120자 강제 |
| Nullable | YES | Phase 1에서는 항상 NULL 가능 |
| 기본값 | 없음 | NULL 허용 |
| 인덱스 | 없음 | 검색 대상 아님 |
| 제약 | 없음 (DB 레벨) | DTO 레벨만 `@MaxLength(120)` |

**TypeORM 데코레이터 (예정 시그니처)**

```typescript
// backend/src/memory/entities/memory-entry.entity.ts (MODIFY)
@Column({ name: 'caregiver_wish_message', type: 'text', nullable: true })
caregiverWishMessage: string | null;
```

> 기존 컬럼(`photoUrl`, `locationTag` 등)이 `nullable: true`만 명시하고 `type:`을 생략한 패턴을 따른다.
> `caregiver_wish_message`는 가변 길이(최대 120자)이나 명시성·미래 확장 대비 `type: 'text'` 사용.

### 4-2. `mood_entries` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | `uuid_generate_v4()` (`@PrimaryGeneratedColumn('uuid')`) | PRIMARY KEY |
| `memory_entry_id` | UUID | NO | — | **UNIQUE** + FK → `memory_entries(id)` ON DELETE CASCADE |
| `caregiver_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `mood_level` | SMALLINT | NO | — | CHECK (`mood_level BETWEEN 1 AND 5`) |
| `recorded_at` | TIMESTAMPTZ | NO | `now()` | `@CreateDateColumn` |

**인덱스**

- `UQ_mood_entries_memory_entry` UNIQUE (`memory_entry_id`) — 1:1 보장
- `IDX_mood_entries_caregiver_recorded` ON (`caregiver_id`, `recorded_at` DESC) — Phase 8+ 추이 그래프

**FK 캐스케이드**

- `memory_entry_id` ON DELETE CASCADE: MemoryEntry 삭제 시 무드 동반 삭제.
- `caregiver_id` ON DELETE CASCADE: 사용자 삭제 시 데이터 정리.

**LLM 격리 표시**

- 응답 DTO 직렬화 단계 + LLM 호출 페이로드 화이트리스트(§9) **두 단계 모두에서 진입 금지**.

### 4-3. `caregiver_reflections` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `memory_entry_id` | UUID | NO | — | FK → `memory_entries(id)` ON DELETE CASCADE |
| `caregiver_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `question_id` | UUID | NO | — | FK → `diary_questions(id)` ON DELETE RESTRICT |
| `answer_text` | TEXT | NO | — | DTO에서 1~300자 강제 |
| `is_private` | BOOLEAN | NO | `TRUE` | 환자 화면·LLM 입력 어디서도 노출 금지 |
| `created_at` | TIMESTAMPTZ | NO | `now()` | |

**인덱스**

- `IDX_caregiver_reflections_caregiver_created` ON (`caregiver_id`, `created_at` DESC)
- `IDX_caregiver_reflections_memory_entry` ON (`memory_entry_id`)

**FK 캐스케이드**

- `memory_entry_id` ON DELETE CASCADE
- `caregiver_id` ON DELETE CASCADE
- `question_id` ON DELETE **RESTRICT** — 시드 질문이 실수로 사라져서 기존 답변이 dangling 되지 않도록 보호 (질문 삭제는 `is_active=false`로 soft-delete).

**LLM 격리 표시**

- `is_private=true` 기본값 강제.
- 응답 DTO 직렬화에서 환자/공개 응답 경로에 진입 금지.
- LLM 호출 페이로드 화이트리스트에서 누락.

### 4-4. `patient_memory_notes` (NEW) — 퀴즈 LLM 입력의 유일 소스

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `memory_entry_id` | UUID | NO | — | FK → `memory_entries(id)` ON DELETE CASCADE |
| `question_id` | UUID | NO | — | FK → `diary_questions(id)` ON DELETE RESTRICT |
| `category` | VARCHAR(16) | NO | — | `'activity' \| 'moment' \| 'context'` (App 검증) |
| `order_index` | SMALLINT | NO | — | 0..N |
| `answer_text` | TEXT | NO | — | DTO에서 1~300자 강제 |
| `created_at` | TIMESTAMPTZ | NO | `now()` | |

**인덱스**

- `UQ_patient_memory_notes_entry_order` UNIQUE (`memory_entry_id`, `order_index`) — 동일 라이프로그 내 순서 충돌 방지
- `IDX_patient_memory_notes_entry_cat` ON (`memory_entry_id`, `category`) — Phase 3 QuizService에서 카테고리별 조회

**FK 캐스케이드**

- `memory_entry_id` ON DELETE CASCADE
- `question_id` ON DELETE RESTRICT (§4-3과 동일 이유)

**LLM 격리 표시 (양성)**

- **본 테이블의 `answer_text`만** Phase 3 QuizGenerationClient의 입력 화이트리스트에 포함된다.
- 응답 DTO에서는 환자 공개용 DTO에 노출 가능 (퀴즈 풀이 화면 컨텍스트 카드).

### 4-5. `diary_questions` (NEW) — 정적 질문 풀

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `scope` | VARCHAR(16) | NO | — | `'caregiver' \| 'patient'` (App 검증) |
| `category` | VARCHAR(16) | YES | NULL | scope='patient'일 때만 NOT NULL (App 검증) |
| `text` | VARCHAR(200) | NO | — | 질문 본문 |
| `is_active` | BOOLEAN | NO | `TRUE` | 비활성 질문은 추출 풀에서 제외 |
| `order_hint` | SMALLINT | NO | `0` | UI 정렬 힌트 (랜덤 추출 시 가중치는 추후) |
| `created_at` | TIMESTAMPTZ | NO | `now()` | |

**인덱스**

- `IDX_diary_questions_scope_cat_active` ON (`scope`, `category`, `is_active`) — `GET /diary-questions/today` 최적화

**시드 데이터 (14개) — `diary-questions.seed.ts`** (§5 시드 전략 참조)

| scope | category | text |
|---|---|---|
| caregiver | NULL | 오늘 나에게 가장 힘들었던 순간은 무엇이었나요? |
| caregiver | NULL | 오늘 나를 잠깐이라도 웃게 한 일은 무엇이었나요? |
| caregiver | NULL | 오늘 환자분을 돌보며 가장 보람을 느낀 순간은? |
| caregiver | NULL | 지금 나에게 가장 필요한 것은 무엇인가요? |
| caregiver | NULL | 오늘 잠들기 전 스스로에게 해주고 싶은 말은? |
| patient | activity | 오늘 환자분과 함께 한 활동은 무엇이었나요? |
| patient | activity | 오늘 환자분이 가장 좋아한 활동은 무엇이었나요? |
| patient | activity | 오늘 환자분이 새로 시도한 활동이 있나요? |
| patient | moment | 오늘 환자분에게 가장 기억에 남을 순간은? |
| patient | moment | 오늘 환자분이 웃었던 순간을 적어주세요. |
| patient | moment | 오늘 환자분과 나눈 가장 따뜻한 한마디는? |
| patient | context | 오늘 환자분이 만난 사람은 누구였나요? |
| patient | context | 오늘 환자분이 다녀온 곳은 어디였나요? |
| patient | context | 오늘 환자분이 드신 음식 중 기억에 남는 것은? |

> 시드 텍스트는 **임상 자문 1회 검수** 권장 (§13 추가 결정 필요 항목 P1-N3).

### 4-6. `quiz_sets` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `memory_entry_id` | UUID | NO | — | FK → `memory_entries(id)` ON DELETE CASCADE |
| `patient_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `caregiver_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `generation_status` | VARCHAR(16) | NO | `'pending'` | App 검증 enum |
| `generation_error` | TEXT | YES | NULL | 실패 사유 |
| `created_at` | TIMESTAMPTZ | NO | `now()` | |
| `ready_at` | TIMESTAMPTZ | YES | NULL | `generation_status='ready'`일 때 갱신 |

**인덱스**

- `IDX_quiz_sets_patient_status_created` ON (`patient_id`, `generation_status`, `created_at` DESC) — 환자 대시보드 목록
- `IDX_quiz_sets_memory_entry` ON (`memory_entry_id`) — MemoryEntry 단건 → QuizSet 역조회

> Phase 1에는 `UNIQUE(memory_entry_id)`을 두지 않는다. **재생성 정책(force=true)** 은 Phase 3에서 별도 컬럼(`generation_id`) 도입 또는 정책 결정.

### 4-7. `quiz_questions` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `quiz_set_id` | UUID | NO | — | FK → `quiz_sets(id)` ON DELETE CASCADE |
| `order_index` | INT | NO | — | 0~4 |
| `type` | VARCHAR(16) | NO | — | `'multiple_choice' \| 'yes_no' \| 'fill_blank'` |
| `prompt` | TEXT | NO | — | 문제 본문 |
| `choices` | JSONB | YES | NULL | `multiple_choice` 시 `string[]` |
| `correct_answer` | TEXT | NO | — | Phase 3 DTO 매퍼가 마스킹 |
| `hint_first_char` | VARCHAR(8) | YES | NULL | `fill_blank` 전용 |
| `explanation` | TEXT | YES | NULL | Phase 2 확장용 (스키마 사전 확보) |

**인덱스/제약**

- `UQ_quiz_questions_set_order` UNIQUE (`quiz_set_id`, `order_index`)
- `IDX_quiz_questions_set` ON (`quiz_set_id`)

### 4-8. `quiz_attempts` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `quiz_set_id` | UUID | NO | — | FK → `quiz_sets(id)` ON DELETE CASCADE |
| `question_id` | UUID | NO | — | FK → `quiz_questions(id)` ON DELETE CASCADE |
| `patient_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `session_token` | UUID | NO | — | 클라이언트 생성, 5문제 동일 |
| `user_answer` | TEXT | NO | — | |
| `is_correct` | BOOLEAN | NO | — | |
| `answered_at` | TIMESTAMPTZ | NO | `now()` | |

**인덱스**

- `IDX_quiz_attempts_set_session` ON (`quiz_set_id`, `session_token`, `answered_at`)
- `IDX_quiz_attempts_patient_set` ON (`patient_id`, `quiz_set_id`)

> R5=(a) 무제한 재풀이 — UNIQUE 제약 없음.

### 4-9. `quiz_best_scores` (NEW)

| 컬럼 | 타입 | NULL | 기본값 | 제약/인덱스 |
|---|---|---|---|---|
| `id` | UUID | NO | — | PRIMARY KEY |
| `quiz_set_id` | UUID | NO | — | **UNIQUE** + FK → `quiz_sets(id)` ON DELETE CASCADE |
| `patient_id` | UUID | NO | — | FK → `users(id)` ON DELETE CASCADE |
| `best_score` | INT | NO | — | 0..100 (R3=(b)) |
| `best_session_token` | UUID | NO | — | |
| `achieved_at` | TIMESTAMPTZ | NO | `now()` | |
| `updated_at` | TIMESTAMPTZ | NO | `now()` | `@UpdateDateColumn` |

**제약**

- `UQ_quiz_best_scores_set` UNIQUE (`quiz_set_id`) — 퀴즈 셋당 최고 점수 1행 (UPSERT 대상)
- `IDX_quiz_best_scores_patient` ON (`patient_id`)

---

## 5. TypeORM 마이그레이션 전략 (4개 분할)

### 5-1. 분할 사유 및 적용 순서

| # | 파일명 (timestamp prefix) | 책임 | 사유 | 롤백 가능성 |
|---|---|---|---|---|
| M1 | `1747454300000-add-caregiver-wish-to-memory.ts` | `memory_entries.caregiver_wish_message` 컬럼 추가 | **최소 변경** 단위, 가장 먼저 적용해도 다른 작업에 영향 없음 | ✅ 데이터 영구 손실 (운영 적용 전 백업 필수) |
| M2 | `1747454400000-create-mood-and-reflection-tables.ts` | `mood_entries` + `caregiver_reflections` + `patient_memory_notes` + `diary_questions` **4개 테이블** 생성 | 4개 모두 동일 도메인(메모리) + FK 의존(question_id ← diary_questions) → 단일 마이그레이션이 트랜잭션 보장 측면에서 유리 | ✅ 신규 테이블만 |
| M3 | `1747454500000-create-quiz-tables.ts` | `quiz_sets`/`quiz_questions`/`quiz_attempts`/`quiz_best_scores` 4개 테이블 생성 | quiz_sets가 `memory_entries`에 FK → M2 이후 또는 M1 이후 적용 가능. quiz 도메인을 별도 단위로 격리하여 Phase 3 롤백 시 quiz 4개만 제거 가능 | ✅ 신규 테이블만 |
| M4 | `1747454600000-seed-diary-questions.ts` | `diary_questions` 14개 row 멱등 INSERT | **데이터 시드 분리** — 스키마와 데이터를 별개 마이그레이션으로 두어 운영 시 시드 누락/중복 진단을 명확화. `INSERT ... ON CONFLICT DO NOTHING` 사용 | ⚠️ 멱등 — 롤백 시 14개 row 삭제 (다른 row가 있다면 보존, §13 P1-N2) |

**적용 순서 강제 조건**

- M1 → M2 → M3 → M4 순서로만 적용 가능.
- M2 내 4개 테이블 생성 순서: `diary_questions` → `patient_memory_notes` → `caregiver_reflections` → `mood_entries` (FK 의존 역순).
- M3 내 4개 테이블 생성 순서: `quiz_sets` → `quiz_questions` → `quiz_attempts` → `quiz_best_scores`.
- 롤백 시 역순.

### 5-2. 파일명 규칙

```
backend/src/database/migrations/<UNIX_MS_TIMESTAMP>-<kebab-case-action>.ts
```

본 Phase 1 timestamp는 plan 작성 시점 기준 placeholder:

- `1747454300000` — `add-caregiver-wish-to-memory.ts`
- `1747454400000` — `create-mood-and-reflection-tables.ts`
- `1747454500000` — `create-quiz-tables.ts`
- `1747454600000` — `seed-diary-questions.ts`

실제 코드 작성 시점에 timestamp는 현재 시간으로 갱신하되 **상대 순서는 반드시 유지**.

### 5-3. 마이그레이션 M1 — `add-caregiver-wish-to-memory.ts`

**up() 의사 코드**

```typescript
await queryRunner.query(`
  ALTER TABLE "memory_entries"
  ADD COLUMN IF NOT EXISTS "caregiver_wish_message" TEXT NULL
`);
```

**down() 의사 코드**

```typescript
await queryRunner.query(`
  ALTER TABLE "memory_entries"
  DROP COLUMN IF EXISTS "caregiver_wish_message"
`);
```

**특성**

- `ADD COLUMN ... NULL` 은 PostgreSQL 11+에서 메타데이터 변경만으로 즉시 완료 → **무중단 적용 가능**.
- 기본값 미지정 → 기존 row 재작성 없음.
- 롤백 시 `DROP COLUMN`은 데이터 영구 손실. 운영 적용 시 별도 백업 절차 필요.

### 5-4. 마이그레이션 M2 — `create-mood-and-reflection-tables.ts`

**up() 순서 (단일 트랜잭션 내)**

1. `CREATE TABLE diary_questions ...` (다른 3개 테이블이 FK 참조)
2. `CREATE TABLE patient_memory_notes ...` + FK to `memory_entries`, `diary_questions`
3. `CREATE TABLE caregiver_reflections ...` + FK to `memory_entries`, `users`, `diary_questions`
4. `CREATE TABLE mood_entries ...` + FK to `memory_entries`(UNIQUE), `users` + CHECK(mood_level 1..5)
5. `CREATE INDEX ...` (§4 각 테이블 인덱스)

**down() 순서 (역순)**

1. `DROP TABLE IF EXISTS mood_entries`
2. `DROP TABLE IF EXISTS caregiver_reflections`
3. `DROP TABLE IF EXISTS patient_memory_notes`
4. `DROP TABLE IF EXISTS diary_questions`

> `DROP TABLE CASCADE`는 사용하지 않는다. FK 역순 명시 삭제.

### 5-5. 마이그레이션 M3 — `create-quiz-tables.ts`

**up() 순서 (단일 트랜잭션 내)**

1. `CREATE TABLE quiz_sets ...` + FK to `memory_entries`, `users`
2. `CREATE TABLE quiz_questions ...` + FK to `quiz_sets`
3. `CREATE TABLE quiz_attempts ...` + FK to `quiz_sets`, `quiz_questions`, `users`
4. `CREATE TABLE quiz_best_scores ...` + FK to `quiz_sets`(UNIQUE), `users`
5. `CREATE INDEX ...` (§4-6 ~ §4-9)

**down() 순서 (역순)**

1. `DROP TABLE IF EXISTS quiz_best_scores`
2. `DROP TABLE IF EXISTS quiz_attempts`
3. `DROP TABLE IF EXISTS quiz_questions`
4. `DROP TABLE IF EXISTS quiz_sets`

### 5-6. 마이그레이션 M4 — `seed-diary-questions.ts` (멱등 시드)

**up() 의사 코드**

```typescript
const QUESTIONS: { scope: string; category: string | null; text: string }[] = [
  // ... §4-5 14개 ...
];

for (const q of QUESTIONS) {
  await queryRunner.query(
    `INSERT INTO "diary_questions" (id, scope, category, text, is_active, order_hint, created_at)
     SELECT gen_random_uuid(), $1, $2, $3, TRUE, 0, now()
     WHERE NOT EXISTS (
       SELECT 1 FROM "diary_questions" WHERE scope = $1 AND text = $3
     )`,
    [q.scope, q.category, q.text],
  );
}
```

**down() 의사 코드 (멱등 역적용)**

```typescript
for (const q of QUESTIONS) {
  await queryRunner.query(
    `DELETE FROM "diary_questions" WHERE scope = $1 AND text = $2`,
    [q.scope, q.text],
  );
}
```

**특성**

- `WHERE NOT EXISTS (... scope=$1 AND text=$3)` 조건으로 **중복 적용 안전** (M4 1회/N회 실행해도 row 수 동일).
- 시드는 `(scope, text)` 조합으로 식별 — `id`는 UUID 자동생성이므로 안정 키로 부적합.
- `gen_random_uuid()` 사용 (`uuid-ossp` 또는 PG 13+ 내장).

### 5-7. `synchronize: true` 환경에서의 적용

현재 `DatabaseModule`은 `synchronize: true`이므로 (`backend/src/database/database.module.ts:19`), 엔티티만 추가하면 개발 환경에서는 즉시 적용된다. 마이그레이션 파일은:

| 환경 | 적용 방식 | Phase 1 작업 |
|---|---|---|
| **개발** | `synchronize: true`로 자동 적용 | 엔티티/시드 신설 → 재시작 |
| **개발 (시드만)** | M4 시드는 `synchronize`가 처리 못함 → **부트스트랩 훅** 필요 | `AppModule.onModuleInit`에서 `seedDiaryQuestionsIfMissing()` 호출 |
| **운영(미래)** | `synchronize: false` + 마이그레이션 4개 순차 적용 | 운영 전환 시 즉시 사용 |

> **결정**: Phase 1에서는 마이그레이션 4개 파일 + `AppModule.onModuleInit` 부트스트랩 시더(혹은 별도 `DiaryQuestionSeederService`) **둘 다 작성**. 이유:
> 1. 개발 환경에서도 시드가 자동 적용되어야 보호자 캡처 화면이 빈 풀로 깨지지 않음.
> 2. 운영 전환 시 마이그레이션 M4가 단일 진실의 원천(SSOT).
> 3. 두 경로 모두 동일한 14개 row를 idempotent하게 보장.

**부트스트랩 시더 — `diary-questions.seed.ts`** (NEW)

```typescript
// backend/src/memory/seeds/diary-questions.seed.ts
export const DIARY_QUESTIONS_SEED: ReadonlyArray<{
  scope: 'caregiver' | 'patient';
  category: 'activity' | 'moment' | 'context' | null;
  text: string;
}> = [
  // ... §4-5 14개 정의 ...
];

export async function seedDiaryQuestionsIfMissing(
  dataSource: DataSource,
): Promise<{ inserted: number; skipped: number }> {
  const repo = dataSource.getRepository(DiaryQuestion);
  let inserted = 0;
  let skipped = 0;
  for (const q of DIARY_QUESTIONS_SEED) {
    const existing = await repo.findOne({
      where: { scope: q.scope, text: q.text },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await repo.save(repo.create({ ...q, isActive: true, orderHint: 0 }));
    inserted += 1;
  }
  return { inserted, skipped };
}
```

> Phase 1에서는 `MemoryModule` 또는 별도 `SeedModule.onModuleInit`에서 호출. 운영 환경 마이그레이션 M4와 동일 의미.

### 5-8. 무중단 적용 가능성 평가

| 마이그레이션 | 락 수준 | 예상 소요 | 무중단 가능 여부 |
|---|---|---|---|
| M1 add-caregiver-wish | `ACCESS EXCLUSIVE` (메타데이터만) | < 100ms | ✅ 가능 (PostgreSQL 11+) |
| M2 create-mood-and-reflection | `ACCESS EXCLUSIVE` on 신규 테이블만 | < 1s | ✅ |
| M3 create-quiz-tables | `ACCESS EXCLUSIVE` on 신규 테이블만 | < 1s | ✅ |
| M4 seed-diary-questions | 신규 row INSERT만 | < 200ms | ✅ |

> 운영 전환 시 4개 마이그레이션 모두 **앱 코드 배포 직전 순차 적용** 가능. 코드 배포 후에는 다음 단계로 진행.

---

## 6. DTO 계층 설계 (3-step 가이드 Q&A 입력)

### 6-1. `CreateMemoryEntryDto` 재설계 (MODIFY)

**파일**: `backend/src/memory/dto/create-memory-entry.dto.ts`

**새 구조 — 3-step nested DTO**

```typescript
// backend/src/memory/dto/patient-memory-note-input.dto.ts (NEW)
export class PatientMemoryNoteInputDto {
  @IsUUID('4', { message: 'questionId는 UUID 형식이어야 합니다.' })
  questionId: string;

  @IsIn(['activity', 'moment', 'context'], {
    message: 'category는 activity, moment, context 중 하나여야 합니다.',
  })
  category: 'activity' | 'moment' | 'context';

  @IsString()
  @Length(1, 300, { message: 'answerText는 1~300자여야 합니다.' })
  answerText: string;
}

// backend/src/memory/dto/caregiver-reflection-input.dto.ts (NEW)
export class CaregiverReflectionInputDto {
  @IsUUID('4', { message: 'questionId는 UUID 형식이어야 합니다.' })
  questionId: string;

  @IsString()
  @Length(1, 300, { message: 'answerText는 1~300자여야 합니다.' })
  answerText: string;
}

// backend/src/memory/dto/mood-input.dto.ts (NEW)
export class MoodInputDto {
  @IsInt()
  @Min(1)
  @Max(5)
  level: 1 | 2 | 3 | 4 | 5;
}

// backend/src/memory/dto/create-memory-entry.dto.ts (MODIFY)
export class CreateMemoryEntryDto {
  @IsUUID('4')
  patientId: string;

  // Step 1: 무드 체크 (필수)
  @ValidateNested()
  @Type(() => MoodInputDto)
  mood: MoodInputDto;

  // Step 3: 환자분의 하루 (필수, 최소 1개)
  @IsArray()
  @ArrayMinSize(1, {
    message: 'patientAnswers는 최소 1개 이상이어야 합니다.',
  })
  @ArrayMaxSize(5, { message: 'patientAnswers는 최대 5개까지 허용됩니다.' })
  @ValidateNested({ each: true })
  @Type(() => PatientMemoryNoteInputDto)
  patientAnswers: PatientMemoryNoteInputDto[];

  // Step 2: 나의 하루 (선택)
  @IsOptional()
  @ValidateNested()
  @Type(() => CaregiverReflectionInputDto)
  caregiverAnswer?: CaregiverReflectionInputDto;

  // Phase 6 사전 (선택, Phase 1에서는 UI 미노출이지만 DTO에서는 허용)
  @IsOptional()
  @IsString()
  @Length(1, 120, {
    message: 'caregiverWishMessage는 1~120자여야 합니다.',
  })
  caregiverWishMessage?: string;

  // 호환 유지 (deprecated, 새 흐름에서는 사용 안 함)
  @IsOptional()
  @IsString()
  @IsIn(['happy', 'calm', 'nostalgic', 'excited'])
  emotionTag?: 'happy' | 'calm' | 'nostalgic' | 'excited';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  targetWords?: string[];
}
```

**호환성 결정**: `emotionTag`·`targetWords`는 **deprecated optional로 유지** (즉시 제거하지 않음). 사유:

- 기존 클라이언트(Phase 4 이전)가 여전히 보낼 가능성.
- DB 컬럼은 그대로 nullable이므로 호환성 비용 0.
- 본 Phase 1 완료 후 Phase 4 보호자 화면 재설계 시 클라이언트가 더 이상 보내지 않게 되면 Phase 9에서 컬럼/필드 deprecate 검토.

### 6-2. Multipart 바디 파싱 전략

NestJS `FileInterceptor`는 multipart 바디의 JSON 필드를 자동 nested 객체로 파싱하지 못한다 (`@Body() dto`는 string 필드만 받음). 따라서:

| Multipart 필드 | 전송 형태 | 컨트롤러 측 처리 |
|---|---|---|
| `patientId` | 단일 string | `@Body() dto.patientId` 자동 매핑 |
| `mood` | **JSON 문자열** `'{"level":4}'` | `@Body()` 후 `class-transformer.plainToInstance(MoodInputDto, JSON.parse(raw))` |
| `patientAnswers` | **JSON 문자열 배열** | 동일 |
| `caregiverAnswer?` | **JSON 문자열 (옵션)** | 동일 |
| `caregiverWishMessage?` | 단일 string | `@Body()` 자동 매핑 |
| `photo?` | binary | `@UploadedFile()` |

**해결 옵션 비교**

| 옵션 | 위치 | 장점 | 단점 |
|---|---|---|---|
| (a) 커스텀 ValidationPipe + Transform 데코레이터 | DTO 클래스 내부 `@Transform(({ value }) => JSON.parse(value))` | DTO 응집성 | NestJS Body 자동 검증 흐름에 어색하게 끼어듦 |
| (b) 컨트롤러에서 raw body → manually JSON.parse → DTO validate | 컨트롤러 메서드 | 명시적, 디버깅 쉬움 | 코드량 증가 |
| (c) `@Body()` 대신 raw로 받고 서비스 레이어에서 파싱 | 서비스 | 단위 테스트 용이 | HTTP 검증과 비즈니스 검증 책임 모호 |

**결정**: **(a) `@Transform` 데코레이터** 채택.

```typescript
import { Transform } from 'class-transformer';

@Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
@ValidateNested()
@Type(() => MoodInputDto)
mood: MoodInputDto;
```

**근거**:

- DTO 내부에서 검증 규칙이 완결되어 컨트롤러는 위임만 담당.
- `class-validator`의 `@ValidateNested`가 정상 동작.
- 클라이언트가 multipart로 JSON 문자열을 보내든 application/json으로 객체를 보내든 모두 동작.

> 단점: NestJS 검증 에러 메시지가 nested object 단위로 출력되어 클라이언트 측 에러 핸들링 매핑 필요 (§13 P1-N1).

### 6-3. R2=(b) 의미 재해석 — 서비스 레이어 검증

이전 plan의 R2=(b) "diaryText 또는 photo 중 1개 이상"은 본 plan에서 다음으로 갱신된다:

```
R2=(b) 재해석:
  patientAnswers.length >= 1  OR  photo 첨부
  - mood, caregiverAnswer는 별도 검증
  - 둘 다 없으면 400 BadRequestException
```

**검증 위치**: 이전 plan과 동일하게 **서비스 레이어** (`MemoryEntryService.create()`) 채택. 이유:

- `photo`는 DTO에 없고 컨트롤러 파라미터로만 존재.
- 단위 테스트에서 4가지 시나리오를 명확히 검증 가능 (§10).
- DTO에 가짜 boolean 필드 추가 회피.

**구현 의사 코드**

```typescript
// memory.service.ts (MODIFY)
async create(
  caregiverId: string,
  dto: CreateMemoryEntryDto,
  photo: Express.Multer.File | undefined,   // ← optional로 변경
  caregiver: { patientId: string | null },
): Promise<MemoryEntryResponseDto> {
  // 1. 소유권 검증 (기존)
  if (caregiver.patientId !== dto.patientId) {
    throw new ForbiddenException('해당 환자에 대한 접근 권한이 없습니다.');
  }

  // 2. R2=(b) 재해석 검증
  if (dto.patientAnswers.length === 0 && !photo) {
    throw new BadRequestException(
      'patientAnswers 1개 이상 또는 photo 첨부 중 최소 1개는 필수입니다.',
    );
  }

  // 3. 질문 id 유효성 (옵션 — Phase 3 정밀 검증 권장)
  // ... 본 Phase 1에서는 FK 제약으로만 보장

  // 4. 단일 트랜잭션
  return this.dataSource.transaction(async (manager) => {
    const memoryEntry = await this.saveMemoryEntry(manager, caregiverId, dto, photo);
    await this.saveMoodEntry(manager, memoryEntry, caregiverId, dto.mood);
    if (dto.caregiverAnswer) {
      await this.saveCaregiverReflection(manager, memoryEntry, caregiverId, dto.caregiverAnswer);
    }
    await this.savePatientMemoryNotes(manager, memoryEntry, dto.patientAnswers);
    // ... FastAPI tag/mask (사진 있을 때만, 트랜잭션 외부에서 best-effort) ...
    return this.toPublicResponseDto(memoryEntry);
  });
}
```

### 6-4. 응답 DTO 분리 (보안)

**파일 분리 결정**:

| DTO | 파일 | 노출 대상 | 포함 필드 |
|---|---|---|---|
| `MemoryEntryPublicResponseDto` | `dto/memory-entry-response.dto.ts` (MODIFY) | **환자 화면** + 보호자 일반 조회 | id, patientId, photoUrl, locationTag, objectTags, emotionTag, targetWords, hasScenario, hasMaskedContext, createdAt, **patientNotes (활동/순간/맥락 답변)**, **caregiverWishMessage (Phase 6 환자 노출 허용)** |
| `MemoryEntryPrivateResponseDto` | `dto/memory-entry-private-response.dto.ts` (NEW) | **보호자 본인 전용** 별도 endpoint | Public 필드 전부 + `mood: { level }` + `caregiverReflection: { questionId, answerText, createdAt } \| null` |

**중요 보안 원칙**:

- **Public DTO에는 `mood`, `caregiverReflection` 절대 포함하지 않는다.**
- 보호자 사적 데이터를 보호자 본인에게 보여주는 endpoint는 **Phase 8+에서 별도 도입** (e.g. `GET /memory-entries/:id/private`). Phase 1에서는 Private DTO **타입만 정의**.
- `MemoryEntryService.create()`의 응답은 Public DTO를 반환한다 — 생성 직후에도 보호자 본인이 자신의 답변을 응답에서 보지 않는다 (이미 클라이언트에 입력한 데이터이므로 응답 필요 없음).

**`MemoryEntryPublicResponseDto`** (MODIFY)

```typescript
export class MemoryEntryPublicResponseDto {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  hasScenario: boolean;
  hasMaskedContext: boolean;
  /** Phase 6에서 환자 화면에 노출됨, Phase 1에서는 항상 null 또는 저장값 */
  caregiverWishMessage: string | null;
  /** Step 3 답변 (환자 화면 컨텍스트 카드 + Phase 3 퀴즈 LLM 입력 원천) */
  patientNotes: ReadonlyArray<{
    category: 'activity' | 'moment' | 'context';
    answerText: string;
    orderIndex: number;
  }>;
  createdAt: string;
}
```

**`MemoryEntryPrivateResponseDto`** (NEW)

```typescript
export class MemoryEntryPrivateResponseDto extends MemoryEntryPublicResponseDto {
  mood: { level: 1 | 2 | 3 | 4 | 5; recordedAt: string };
  caregiverReflection: {
    questionId: string;
    answerText: string;
    createdAt: string;
  } | null;
}
```

> Phase 1에서 Private DTO를 **실제로 노출하는 endpoint는 없다**. 타입과 매퍼 시그니처만 정의하여 Phase 8+ 진입 시 즉시 사용 가능하게 한다.

### 6-5. `DiaryQuestion` 응답 DTO (NEW)

**파일**: `backend/src/memory/dto/diary-question.dto.ts`

```typescript
export class DiaryQuestionResponseDto {
  id: string;
  scope: 'caregiver' | 'patient';
  category: 'activity' | 'moment' | 'context' | null;
  text: string;
}
```

**파일**: `backend/src/memory/dto/diary-question-query.dto.ts`

```typescript
export class DiaryQuestionQueryDto {
  @IsIn(['caregiver', 'patient'])
  scope: 'caregiver' | 'patient';

  @IsOptional()
  @IsIn(['activity', 'moment', 'context'])
  category?: 'activity' | 'moment' | 'context';
}
```

검증 규칙: `scope='patient'`일 때 `category` 필수 — DTO에 `@ValidateIf((o) => o.scope === 'patient')` 추가 또는 `DiaryQuestionService` 내부 검증.

---

## 7. 모듈 골격 (QuizModule 등록 + MemoryModule 확장)

### 7-1. `backend/src/quiz/quiz.module.ts` (NEW)

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';

/**
 * Quiz 모듈 (Phase 1 골격)
 * - 4개 엔티티만 TypeORM에 등록
 * - Service/Controller는 Phase 3에서 추가
 * - 외부 노출 없음 (exports 비어있음)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuizSet,
      QuizQuestion,
      QuizAttempt,
      QuizBestScore,
    ]),
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class QuizModule {}
```

### 7-2. `backend/src/memory/memory.module.ts` (MODIFY)

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MemoryEntry,
      MoodEntry,                    // ← NEW
      CaregiverReflection,          // ← NEW
      PatientMemoryNote,            // ← NEW
      DiaryQuestion,                // ← NEW
    ]),
    HttpModule,
    AuthModule,
  ],
  controllers: [MemoryController],
  providers: [
    MemoryEntryService,
    FastApiClientService,
    CryptoService,
    FileStorageService,
    DiaryQuestionService,          // ← NEW
  ],
  exports: [MemoryEntryService, DiaryQuestionService],
})
export class MemoryModule {}
```

### 7-3. `backend/src/app.module.ts` (MODIFY)

```typescript
import { QuizModule } from './quiz/quiz.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MemoryModule,
    TrainingModule,
    QuizModule,                    // ← NEW
  ],
  // ...
})
export class AppModule {}
```

### 7-4. 골격만 등록하는 이유

- `autoLoadEntities: true` (`database.module.ts:17`) + `synchronize: true` 덕분에 `TypeOrmModule.forFeature`로 등록한 엔티티가 자동 인식되어 개발 환경에서 즉시 스키마가 생성된다.
- Service/Controller 없이도 엔티티만 등록되면 **Phase 2 FastAPI 통합 테스트** 시 동일 DB 환경에서 동작 검증이 가능하다.
- Phase 3에서 `QuizService` 추가 시 변경 지점이 한눈에 파악된다 (지금은 빈 `providers: []`).

---

## 8. 의존성 방향 및 트랜잭션 전략

### 8-1. 모듈 의존 다이어그램

```
AppModule
  ├── DatabaseModule        (기존)
  ├── AuthModule            (기존)
  ├── MemoryModule          [MODIFY]
  │     ├── MemoryEntry, MoodEntry, CaregiverReflection, PatientMemoryNote, DiaryQuestion
  │     ├── MemoryEntryService  (트랜잭션 확장)
  │     ├── DiaryQuestionService [NEW]
  │     └── (Phase 3) QuizService 호출 — 보호자 사적 데이터 미포함 화이트리스트
  ├── TrainingModule        (기존)
  └── QuizModule  ────────────┐
                              │ (Phase 3부터 활성, Phase 1은 골격만)
                              ▼
                          MemoryModule (PatientMemoryNote 조회 메서드 사용)
```

### 8-2. 의존 규칙 (강제)

| From → To | 허용 여부 | 비고 |
|---|---|---|
| `QuizModule` → `MemoryModule` | ✅ 허용 (Phase 3부터) | `QuizService`가 `PatientMemoryNote`를 조회 |
| `QuizModule` → `AuthModule` | ✅ 허용 (Phase 3부터) | JWT 가드 재사용 |
| `MemoryModule` → `QuizModule` | ❌ **금지** | Memory는 Quiz의 존재를 모른다 |
| 엔티티 import (FK 관계 정의 목적) | ✅ 허용 | `QuizSet`에서 `MemoryEntry`, `User` 엔티티 import |
| `PatientMemoryNote` 조회 방법 | **MemoryModule이 `exports`로 `PatientMemoryNoteRepository` 노출** OR **Service 메서드 제공** | Phase 3 결정. Phase 1에서는 의존 방향만 못 박는다 |

### 8-3. Phase 1에서의 의존 발생 지점

본 Phase는 **엔티티 import만** 발생한다:

```typescript
// quiz/entities/quiz-set.entity.ts
import { MemoryEntry } from '../../memory/entities/memory-entry.entity';  // FK 정의
import { User } from '../../auth/entities/user.entity';                    // FK 정의

// memory/entities/patient-memory-note.entity.ts
import { MemoryEntry } from './memory-entry.entity';
import { DiaryQuestion } from './diary-question.entity';
```

NestJS 모듈 런타임 의존(`@Module imports`)은 Phase 1에서 발생하지 않는다.

### 8-4. 단일 DB 트랜잭션 전략 — `MemoryEntryService.create()`

**목표**: `MemoryEntry`, `MoodEntry`, `CaregiverReflection?`, `PatientMemoryNote[]` 5종 row를 **하나의 트랜잭션 내 일괄 저장**. 어느 하나 실패해도 전체 롤백.

**구현 가이드 (의사 코드)**

```typescript
// MemoryEntryService.create() 내부
return this.dataSource.transaction(async (manager) => {
  // 1) MemoryEntry 저장 (사진 + caregiverWishMessage 포함, FastAPI 호출 전)
  const entryRepo = manager.getRepository(MemoryEntry);
  const entry = await entryRepo.save(
    entryRepo.create({
      caregiverId,
      patientId: dto.patientId,
      photoUrl: photo ? this.fileStorageService.getPublicUrl(photo.filename) : null,
      caregiverWishMessage: dto.caregiverWishMessage ?? null,
      emotionTag: dto.emotionTag,
      targetWords: dto.targetWords ?? [],
    }),
  );

  // 2) MoodEntry 저장
  const moodRepo = manager.getRepository(MoodEntry);
  await moodRepo.save(
    moodRepo.create({
      memoryEntryId: entry.id,
      caregiverId,
      moodLevel: dto.mood.level,
    }),
  );

  // 3) CaregiverReflection (있을 때만)
  if (dto.caregiverAnswer) {
    const reflRepo = manager.getRepository(CaregiverReflection);
    await reflRepo.save(
      reflRepo.create({
        memoryEntryId: entry.id,
        caregiverId,
        questionId: dto.caregiverAnswer.questionId,
        answerText: dto.caregiverAnswer.answerText,
        isPrivate: true,  // 강제
      }),
    );
  }

  // 4) PatientMemoryNote[] 일괄 저장 (orderIndex 자동 부여)
  const noteRepo = manager.getRepository(PatientMemoryNote);
  const notes = dto.patientAnswers.map((ans, idx) =>
    noteRepo.create({
      memoryEntryId: entry.id,
      questionId: ans.questionId,
      category: ans.category,
      orderIndex: idx,
      answerText: ans.answerText,
    }),
  );
  await noteRepo.save(notes);

  return entry;
});

// 5) (트랜잭션 외부, best-effort) FastAPI tag/mask — 기존 흐름 유지
// 6) (트랜잭션 외부) Public 응답 DTO 매퍼
```

**에러 처리**

- 트랜잭션 내 어느 단계든 throw 시 → PostgreSQL이 자동 ROLLBACK.
- 사진 파일은 컨트롤러의 `FileInterceptor`가 이미 디스크에 저장한 상태 → **트랜잭션 롤백 시 파일 cleanup 필요** (§12 위험 요소 W5).
- FastAPI tag/mask 실패는 트랜잭션 외부 best-effort (기존 패턴 유지).

### 8-5. `MemoryEntryService` 의존성 추가

기존 생성자에 `@InjectDataSource()` 추가 필요:

```typescript
constructor(
  @InjectRepository(MemoryEntry)
  private readonly memoryEntryRepository: Repository<MemoryEntry>,
  @InjectDataSource()
  private readonly dataSource: DataSource,    // ← NEW
  private readonly fastApiClient: FastApiClientService,
  private readonly cryptoService: CryptoService,
  private readonly fileStorageService: FileStorageService,
) {}
```

추가 의존: TypeORM `DataSource` 주입. NestJS `@nestjs/typeorm`의 `@InjectDataSource()` 사용.

---

## 9. LLM 입력 격리 보안 설계 (Phase 1 단계 적용)

### 9-1. 격리 원칙

**보호자 사적 데이터는 LLM 호출 경로에 진입조차 못 한다.** 본 Phase 1에서 다음 두 단계로 차단:

1. **응답 DTO 직렬화 단계** — Public 응답 DTO에 `mood`/`caregiverReflection` 필드 부재 (§6-4).
2. **LLM 호출 페이로드 화이트리스트** — Phase 3에서 도입 예정인 `QuizGenerationClient`가 사용할 페이로드 빌더의 타입 자체를 Phase 1에서 미리 정의.

### 9-2. Phase 1 적용 — 구조 설계 (코드는 Phase 3에서 작성)

**파일**: `backend/src/quiz/interfaces/IQuizGenerationPayload.ts` (NEW — Phase 1에서 인터페이스만 선언)

```typescript
/**
 * Phase 3 QuizGenerationClient가 FastAPI에 전달할 페이로드의 화이트리스트.
 * 본 인터페이스에 정의된 필드 외에는 일체 전달 금지.
 * 본 인터페이스는 Phase 1에서 미리 정의하여, 향후 코드 작성 시
 * 타입 단계에서 보호자 사적 데이터 진입을 차단한다.
 */
export interface IQuizGenerationPayload {
  patientNotes: ReadonlyArray<{
    category: 'activity' | 'moment' | 'context';
    answerText: string;
  }>;
  photoTags?: { location: string; objects: string[] };  // Phase 2에서 (b)로 전환 시 활성
  targetWords?: ReadonlyArray<string>;
  distribution?: {
    multiple_choice: number;
    yes_no: number;
    fill_blank: number;
  };
  // 이 인터페이스에 mood, caregiverReflection, caregiverWishMessage 등은
  // 영원히 추가하지 않는다 (코드 리뷰 시 강제).
}
```

> Phase 1에서 본 인터페이스 파일을 미리 생성하면 Phase 3 구현 시 TS 컴파일러가 보호자 데이터 진입을 차단한다.

### 9-3. 응답 DTO 직렬화 회귀 테스트 (Phase 1 필수)

**파일**: `backend/src/memory/dto/memory-entry-response.dto.spec.ts` (NEW)

```
Given: MemoryEntry + MoodEntry(level=4) + CaregiverReflection(answer="힘들었다") 모두 영속화됨
When:  toPublicResponseDto(entry, notes) 호출
Then:  반환 객체에 mood 필드 부재
       반환 객체에 caregiverReflection 필드 부재
       반환 객체에 patientNotes 필드 존재 (3개 답변)
       반환 객체에 caregiverWishMessage 필드 존재 (null 또는 저장값)
```

```
Given: MemoryEntryPrivateResponseDto 타입
When:  TypeScript 컴파일러
Then:  mood, caregiverReflection 필드 접근 가능 (Public DTO에는 없음)
```

### 9-4. Phase 3 진입 시 강제될 보안 가드 (Phase 1에서 명세만 작성)

Phase 3 진입 시 `QuizGenerationClient.requestGeneration()` 구현 단계에서 다음 가드를 적용:

```typescript
// Phase 3에서 작성될 코드의 명세 (Phase 1에서 작성 X)
async requestGeneration(entry: MemoryEntry): Promise<QuizGenerationResult> {
  const notes = await this.patientNoteRepo.find({
    where: { memoryEntryId: entry.id },
    order: { orderIndex: 'ASC' },
  });

  // 화이트리스트 명시 — mood, caregiverReflection 절대 진입 금지
  const payload: IQuizGenerationPayload = {
    patientNotes: notes.map(n => ({
      category: n.category,
      answerText: n.answerText,
    })),
    targetWords: entry.targetWords,
    // photoTags는 Phase 2에서 활성
  };

  // 로깅 시 hash만 (원문 미저장)
  this.logger.debug(`quiz payload hash=${sha256(JSON.stringify(payload))}`);

  return this.fastApiClient.post('/quiz/generate', payload);
}
```

**Phase 1에서는 위 코드를 작성하지 않는다. 하지만 다음을 미리 보장한다**:

- `IQuizGenerationPayload` 인터페이스 파일 존재 (§9-2).
- `PatientMemoryNote` 엔티티에 `answerText`만 외부 노출 가능 (응답 DTO에 포함).
- `MoodEntry`/`CaregiverReflection`의 응답 DTO 노출 경로 부재 (§9-3).

---

## 10. 테스트 전략 (Given-When-Then)

### 10-1. 마이그레이션 검증 (M1~M4 up/down)

**대상**: 마이그레이션 4개 파일.

**방법**: TypeORM 테스트 데이터소스 + 임시 PostgreSQL 컨테이너 (`testcontainers-node`) 또는 운영용 PG와 동일 구성의 별도 DB.

> 현재 프로젝트에 통합 테스트 인프라가 없을 수 있다. Phase 1에서는 **수동 검증 절차**로 대체 가능. 자동화는 Phase 7 QA에서 검토. (§13 P1-N4)

**케이스 M1-up**:
```
Given: 기존 memory_entries 테이블 (caregiver_wish_message 컬럼 없음), row 3개
When:  M1 up()
Then:  - memory_entries.caregiver_wish_message 컬럼 존재
       - 기존 3개 row 모두 caregiver_wish_message IS NULL
       - 새 INSERT 시 NULL 허용
```

**케이스 M2-up**:
```
Given: M1 적용된 상태
When:  M2 up() (단일 트랜잭션 내 4개 테이블)
Then:  - diary_questions, patient_memory_notes, caregiver_reflections, mood_entries 4개 테이블 생성
       - mood_entries.mood_level CHECK(1..5) 활성: INSERT mood_level=6 → 실패
       - mood_entries.memory_entry_id UNIQUE 활성: 동일 memory_entry_id 2번째 INSERT → 실패
       - patient_memory_notes UNIQUE(memory_entry_id, order_index) 활성
       - 모든 FK ON DELETE CASCADE 동작 (memory_entries 삭제 시 4개 테이블 row 동반 삭제)
       - caregiver_reflections.is_private DEFAULT TRUE
```

**케이스 M3-up**:
```
Given: M1, M2 적용된 상태
When:  M3 up()
Then:  - quiz_sets, quiz_questions, quiz_attempts, quiz_best_scores 4개 테이블 생성
       - UQ_quiz_best_scores_set UNIQUE 동작: 동일 quiz_set_id 2번째 INSERT → 실패
       - UQ_quiz_questions_set_order UNIQUE 동작
       - 모든 FK ON DELETE CASCADE 동작
```

**케이스 M4-up (멱등성)**:
```
Given: M1, M2, M3 적용 + diary_questions 비어있음
When:  M4 up() 2번 연속 실행
Then:  - 1번째 실행: 14개 row INSERT
       - 2번째 실행: 0개 INSERT (NOT EXISTS 가드)
       - 최종 row 수 = 14
```

**케이스 롤백 (M4 → M3 → M2 → M1 down 역순)**:
```
Given: M1~M4 모두 적용된 상태
When:  M4 down, M3 down, M2 down, M1 down 역순 실행
Then:  - 각 단계 후 해당 테이블/컬럼만 제거
       - memory_entries 기존 row 보존
       - M2 down 후 quiz_* 테이블 영향 없음 (M3가 먼저 제거됨)
```

### 10-2. `CreateMemoryEntryDto` 검증 (5 케이스)

**파일**: `backend/src/memory/dto/create-memory-entry.dto.spec.ts` (NEW)

**케이스 1 — patientAnswers만, 나머지 필수만**:
```
Given: dto = { patientId, mood: {level:4}, patientAnswers: [{questionId, category:'activity', answerText:'공원'}] }
When:  validate(dto)
Then:  errors.length === 0
```

**케이스 2 — photo만 (patientAnswers 0개)**:
```
Given: dto = { patientId, mood: {level:4}, patientAnswers: [] }
When:  validate(dto)
Then:  errors에 ArrayMinSize(1) 위반 포함 ("patientAnswers는 최소 1개 이상이어야 합니다.")
       (서비스 레이어의 "patientAnswers OR photo" 검증과는 별개 — DTO 자체는 patientAnswers 최소 1 강제)
```

> **결정**: DTO 레벨은 `patientAnswers >= 1`을 항상 요구. "photo만 있어도 OK" 시나리오는 서비스 레이어가 별도로 처리한다. 단, 실제 R2=(b) 재해석은 "patientAnswers >= 1 OR photo"이므로, **DTO에서 `@ArrayMinSize(1)` 대신 `@ArrayMinSize(0)`로 완화하고 서비스에서 (length>=1 OR photo) 검증** — §13 P1-N5 추가 결정 필요.

**케이스 3 — 둘 다 (정상)**:
```
Given: dto = { 위 + caregiverAnswer: {questionId, answerText:'힘들었다'} + caregiverWishMessage:'사랑해' }
When:  validate(dto)
Then:  errors.length === 0
```

**케이스 4 — answerText 길이 초과**:
```
Given: dto.patientAnswers[0].answerText = 'a'.repeat(301)
When:  validate(dto)
Then:  errors에 Length 위반 포함 ("answerText는 1~300자여야 합니다.")
```

**케이스 5 — caregiverWishMessage 길이 초과**:
```
Given: dto.caregiverWishMessage = 'a'.repeat(121)
When:  validate(dto)
Then:  errors에 Length 위반 포함 ("caregiverWishMessage는 1~120자여야 합니다.")
```

### 10-3. `MemoryEntryService.create()` 트랜잭션 회귀 테스트 (8 케이스)

**파일**: `backend/src/memory/memory.service.spec.ts` (MODIFY)

**공통 Given**: `caregiver = { patientId: 'P1' }`, `dto.patientId = 'P1'`, repository/fileStorage/fastApiClient/dataSource 모두 mocked. `dataSource.transaction(cb)`는 cb를 즉시 실행하는 mock으로 대체.

**케이스 1 — 3-step 정상 (모든 필드)**:
```
Given: dto = { patientId, mood:{level:4}, patientAnswers: [3개], caregiverAnswer: {...}, caregiverWishMessage: '...' }
       photo = <multer file>
When:  service.create(caregiverId, dto, photo, caregiver)
Then:  - MemoryEntry.save() 호출 (caregiverWishMessage 포함)
       - MoodEntry.save() 호출 (level=4)
       - CaregiverReflection.save() 호출 (isPrivate=true 강제)
       - PatientMemoryNote.save() 호출 (3개 + orderIndex 0,1,2)
       - 응답 DTO에 mood/caregiverReflection 부재 (Public)
```

**케이스 2 — patientAnswers만 (사진/caregiverAnswer/wish 없음)**:
```
Given: dto = { patientId, mood:{level:3}, patientAnswers: [1개] }, photo = undefined
When:  service.create(...)
Then:  - MemoryEntry.save() (photoUrl=null, caregiverWishMessage=null)
       - MoodEntry.save()
       - CaregiverReflection.save() 호출되지 않음
       - PatientMemoryNote.save() 1개
       - FastAPI tag/mask 호출되지 않음 (photo 없음)
```

**케이스 3 — photo만 + mood만 (patientAnswers 0개)**:
```
Given: dto = { patientId, mood:{level:5}, patientAnswers: [] }, photo = <multer file>
When:  service.create(...)
Then:  - R2=(b) 재해석 검증 통과 (photo 있음)
       - MemoryEntry.save() (photoUrl 설정)
       - MoodEntry.save()
       - PatientMemoryNote.save() 0개
       - FastAPI tag/mask 호출됨
```

> §13 P1-N5 결정에 따라 케이스 3은 "DTO에서는 ArrayMinSize(0) 허용 + 서비스에서 OR 검증" 시나리오. P1-N5 결정이 "DTO에서 ArrayMinSize(1) 강제"라면 케이스 3은 400 반환으로 변경.

**케이스 4 — 둘 다 없음 → BadRequestException**:
```
Given: dto = { patientId, mood:{level:3}, patientAnswers: [] }, photo = undefined
When:  service.create(...)
Then:  BadRequestException 발생
       메시지: 'patientAnswers 1개 이상 또는 photo 첨부 중 최소 1개는 필수입니다.'
       dataSource.transaction() 호출되지 않음
```

**케이스 5 — 소유권 위반**:
```
Given: caregiver = { patientId: 'P1' }, dto.patientId = 'P2'
When:  service.create(...)
Then:  ForbiddenException 발생
       transaction() 호출되지 않음
```

**케이스 6 — 트랜잭션 도중 실패 시 전체 롤백**:
```
Given: dataSource.transaction이 PatientMemoryNote.save에서 throw하도록 mock
       (예: DB FK 위반 시뮬레이션)
When:  service.create(...)
Then:  - 예외 전파
       - MemoryEntry/MoodEntry/CaregiverReflection 저장은 모두 롤백 (mock 검증)
       - 사진 파일 cleanup 호출됨 (§13 P1-N6 결정 필요)
```

**케이스 7 — Public 응답 DTO에 보호자 사적 데이터 부재 (보안 회귀)**:
```
Given: dto = 케이스 1과 동일 (caregiverAnswer + mood 모두 포함)
When:  service.create(...) 응답 검사
Then:  - response.mood 필드 undefined (Public DTO)
       - response.caregiverReflection 필드 undefined
       - response.patientNotes 존재 (3개)
       - response.caregiverWishMessage 존재 (값 또는 null)
```

**케이스 8 — caregiverAnswer.isPrivate 강제**:
```
Given: dto.caregiverAnswer = { ..., (가공된 입력에 isPrivate=false 강제 주입 시도) }
When:  service.create(...)
Then:  - CaregiverReflection.save에 전달된 객체의 isPrivate === true (서비스가 강제)
```

### 10-4. `DiaryQuestionService` 단위 테스트 (3 케이스)

**파일**: `backend/src/memory/services/diary-question.service.spec.ts` (NEW)

**케이스 1 — scope=patient, category=activity**:
```
Given: diary_questions에 patient/activity 3개 row 존재 (is_active=true)
When:  service.getTodayQuestion('patient', 'activity')
Then:  반환 객체.scope === 'patient', .category === 'activity'
       반환 객체.id가 3개 중 하나
```

**케이스 2 — scope=patient, category 누락**:
```
Given: query = { scope: 'patient' }
When:  service.getTodayQuestion('patient', undefined)
Then:  BadRequestException 발생 ("scope=patient일 때 category는 필수입니다.")
```

**케이스 3 — 풀 비어있음**:
```
Given: diary_questions에 patient/moment 0개 (is_active=true)
When:  service.getTodayQuestion('patient', 'moment')
Then:  NotFoundException 발생 (코드: QUESTION_POOL_EMPTY)
```

### 10-5. 시드 멱등성 테스트

**파일**: `backend/src/memory/seeds/diary-questions.seed.spec.ts` (NEW)

**케이스**:
```
Given: 빈 diary_questions 테이블
When:  seedDiaryQuestionsIfMissing(dataSource) 호출
Then:  - 1차 호출 후: inserted=14, skipped=0, 총 row 수=14
       - 2차 호출 후: inserted=0, skipped=14, 총 row 수=14
       - 시드 텍스트 중 1개를 미리 수동 INSERT 후 호출: inserted=13, skipped=1
```

### 10-6. `QuizModule` 등록 스모크 테스트

**파일**: `backend/src/quiz/quiz.module.spec.ts` (NEW)

```
Given: Test.createTestingModule({ imports: [QuizModule, <TestDbModule>] })
When:  module.compile()
Then:  컴파일 성공, 예외 없음
       getRepositoryToken(QuizSet) 주입 가능
       getRepositoryToken(QuizQuestion) 주입 가능
       getRepositoryToken(QuizAttempt) 주입 가능
       getRepositoryToken(QuizBestScore) 주입 가능
```

### 10-7. 테스트 더블 전략

| 종류 | 사용 위치 | 비고 |
|---|---|---|
| Mock | FastApiClientService, FileStorageService, CryptoService | 외부 시스템 |
| Mock | TypeORM Repository | `getRepositoryToken(...)` 기반 |
| Mock | DataSource | `transaction(cb)`를 즉시 실행하는 mock으로 대체 |
| Fake | DiaryQuestion (시드 케이스 일부) | 인메모리 배열 fake |
| Stub | JwtAuthGuard | 컨트롤러 테스트 시 항상 true 반환 |

---

## 11. 파일 단위 변경 표 (Proposed Changes)

| # | 파일 | 종류 | 변경 요약 |
|---|------|------|-----------|
| 1 | `backend/src/memory/entities/memory-entry.entity.ts` | MODIFY | `caregiverWishMessage: string \| null` 컬럼 추가 |
| 2 | `backend/src/memory/entities/mood-entry.entity.ts` | NEW | §4-2 |
| 3 | `backend/src/memory/entities/caregiver-reflection.entity.ts` | NEW | §4-3 (isPrivate=true 기본) |
| 4 | `backend/src/memory/entities/patient-memory-note.entity.ts` | NEW | §4-4 |
| 5 | `backend/src/memory/entities/diary-question.entity.ts` | NEW | §4-5 |
| 6 | `backend/src/memory/dto/create-memory-entry.dto.ts` | MODIFY | 3-step nested DTO (mood/patientAnswers/caregiverAnswer/caregiverWishMessage) |
| 7 | `backend/src/memory/dto/patient-memory-note-input.dto.ts` | NEW | nested DTO (§6-1) |
| 8 | `backend/src/memory/dto/caregiver-reflection-input.dto.ts` | NEW | nested DTO |
| 9 | `backend/src/memory/dto/mood-input.dto.ts` | NEW | nested DTO |
| 10 | `backend/src/memory/dto/memory-entry-response.dto.ts` | MODIFY | Public DTO: patientNotes + caregiverWishMessage 추가, mood/caregiverReflection **부재** |
| 11 | `backend/src/memory/dto/memory-entry-private-response.dto.ts` | NEW | Private DTO (Phase 8+ 사용 예정, Phase 1은 타입만) |
| 12 | `backend/src/memory/dto/diary-question.dto.ts` | NEW | 응답 DTO |
| 13 | `backend/src/memory/dto/diary-question-query.dto.ts` | NEW | 쿼리 검증 DTO |
| 14 | `backend/src/memory/services/diary-question.service.ts` | NEW | 카테고리별 랜덤 추출 |
| 15 | `backend/src/memory/seeds/diary-questions.seed.ts` | NEW | 14개 시드 + 멱등 함수 |
| 16 | `backend/src/memory/memory.module.ts` | MODIFY | 신규 4개 엔티티 + DiaryQuestionService 등록 |
| 17 | `backend/src/memory/memory.controller.ts` | MODIFY | 3-step body 수신 (Transform), `GET /diary-questions/today` 추가, `@UploadedFile` optional |
| 18 | `backend/src/memory/memory.service.ts` | MODIFY | `dataSource.transaction` 도입 + 5종 row 저장, photo optional 시그니처, R2=(b) 재해석 검증 |
| 19 | `backend/src/quiz/quiz.module.ts` | NEW | TypeOrmModule.forFeature 4개 |
| 20 | `backend/src/quiz/entities/quiz-set.entity.ts` | NEW | §4-6 |
| 21 | `backend/src/quiz/entities/quiz-question.entity.ts` | NEW | §4-7 |
| 22 | `backend/src/quiz/entities/quiz-attempt.entity.ts` | NEW | §4-8 |
| 23 | `backend/src/quiz/entities/quiz-best-score.entity.ts` | NEW | §4-9 |
| 24 | `backend/src/quiz/constants/quiz-generation-status.ts` | NEW | `'pending'\|'ready'\|'failed'` |
| 25 | `backend/src/quiz/constants/quiz-question-type.ts` | NEW | `'multiple_choice'\|'yes_no'\|'fill_blank'` |
| 26 | `backend/src/quiz/interfaces/IQuizGenerationPayload.ts` | NEW | LLM 페이로드 화이트리스트 타입 (§9-2) |
| 27 | `backend/src/database/migrations/1747454300000-add-caregiver-wish-to-memory.ts` | NEW | M1 (§5-3) |
| 28 | `backend/src/database/migrations/1747454400000-create-mood-and-reflection-tables.ts` | NEW | M2 (§5-4) |
| 29 | `backend/src/database/migrations/1747454500000-create-quiz-tables.ts` | NEW | M3 (§5-5) |
| 30 | `backend/src/database/migrations/1747454600000-seed-diary-questions.ts` | NEW | M4 (§5-6) |
| 31 | `backend/src/app.module.ts` | MODIFY | QuizModule import + (선택) SeederModule.onModuleInit |
| 32 | `backend/src/memory/dto/create-memory-entry.dto.spec.ts` | NEW | §10-2 |
| 33 | `backend/src/memory/dto/memory-entry-response.dto.spec.ts` | NEW | §9-3 보안 회귀 |
| 34 | `backend/src/memory/memory.service.spec.ts` | MODIFY | §10-3 8 케이스 추가 |
| 35 | `backend/src/memory/services/diary-question.service.spec.ts` | NEW | §10-4 |
| 36 | `backend/src/memory/seeds/diary-questions.seed.spec.ts` | NEW | §10-5 멱등성 |
| 37 | `backend/src/quiz/quiz.module.spec.ts` | NEW | §10-6 스모크 |

**파일 수 요약**:

- **NEW: 30개** (엔티티 4 Memory + 4 Quiz + 8 DTO + 1 Service + 1 Seed + 1 Module + 4 Migrations + 2 Constants + 1 Interface + 4 Tests)
- **MODIFY: 7개** (MemoryEntry 엔티티, CreateMemoryEntryDto, MemoryEntryResponseDto, MemoryModule, MemoryController, MemoryService, AppModule)

---

## 12. 위험 요소 (Risk Assessment)

| # | 위험 | 발생 가능성 | 영향도 | 대응 방안 |
|---|---|:---:|:---:|---|
| W1 | 4개 마이그레이션 적용 순서 실수 (FK 의존 위반) | 보통 | 높음 | 파일명 timestamp 강제 정렬 + M2 내 테이블 생성 순서 명시(§5-4) + 통합 테스트로 up/down 검증(§10-1) |
| W2 | M4 시드 중복 적용 | 높음 | 낮음 | `WHERE NOT EXISTS (scope, text)` 가드 + 멱등성 회귀 테스트(§10-5) |
| W3 | `patient_memory_notes.answer_text` 응답 노출 시 환자 PII (실명·주소 등) 유출 | 보통 | 높음 | Phase 2에서 `/mask` 라우터 재사용 검토. Phase 1은 본문 그대로 응답 (위험 등록만). 운영 진입 전 PII 마스킹 정책 결정 필요 (§13 P1-N7) |
| W4 | 보호자 사적 답변 응답 누출 (CaregiverReflection이 Public DTO에 실수로 노출) | 보통 | **매우 높음** | (1) Public/Private DTO 분리(§6-4). (2) `MemoryEntryService` 반환 타입을 명시적으로 `MemoryEntryPublicResponseDto`로 선언. (3) `memory-entry-response.dto.spec.ts`로 직렬화 회귀 테스트(§9-3). (4) Phase 3 LLM 페이로드 화이트리스트 인터페이스(§9-2). |
| W5 | 트랜잭션 도중 실패 시 디스크에 저장된 사진 파일 cleanup 누락 | 높음 | 보통 | `MemoryEntryService.create` catch 블록에서 `FileStorageService.delete(photo.filename)` 호출. §13 P1-N6 결정 필요 |
| W6 | `MemoryEntryService.create()` 시그니처에서 `photo`를 optional로 변경 → 컨트롤러 `@UploadedFile`도 동시 수정 필요. 누락 시 multer가 photo 없을 때 자동 400 | 보통 | 보통 | 동시 수정 + 케이스 3(photo만 + patientAnswers 0개)이 아닌 케이스 2(patientAnswers만 + photo 없음)에 대한 통합 테스트로 보장 |
| W7 | 보호자 무드 데이터의 매우 민감한 정신건강 정보 → 응답·LLM·로깅 어디서도 노출 금지 | 보통 | **매우 높음** | (1) Public DTO 부재. (2) §9-2 IQuizGenerationPayload 화이트리스트. (3) 로깅 시 `mood_level` 필드 자동 마스킹 (전역 Logger 인터셉터, Phase 7 검토). |
| W8 | `synchronize: true` 환경에서 마이그레이션 SQL 오류 미감지 → 운영 전환 시 폭발 | 보통 | 높음 | 로컬 별도 PG 컨테이너에서 `synchronize:false` + `migration:run` 수동 검증 (Phase 7 QA 항목) |
| W9 | `diary_questions` 시드 텍스트의 임상적 부적절성 (예: 환자 가족에게 상처될 표현) | 보통 | 보통 | (1) 시드 텍스트 임상 자문 1회 검수 (§13 P1-N3). (2) `is_active=false`로 핫픽스 가능. |
| W10 | `caregiverReflections.question_id` FK 위반 (시드에 없는 UUID 전송) | 낮음 | 낮음 | FK 제약이 잡아줌 (500 → 클라이언트 측 prefetch로 회피) |
| W11 | Multipart JSON 문자열 파싱 실패 (`@Transform` 내부 JSON.parse 예외) | 보통 | 보통 | `@Transform` 콜백에서 try/catch 후 명시적 에러 객체 throw → ValidationPipe가 400 변환 |
| W12 | `MemoryEntry.targetWords` deprecated 필드 유지로 인한 코드 혼란 | 낮음 | 낮음 | Phase 1은 호환 유지, Phase 4 보호자 화면 재설계 완료 후 Phase 9 deprecate |

---

## 13. 추가 결정 필요 항목 (User Review Required — Phase 1 신규)

본 plan 작성 중 새로 발견된 결정 사항 (이전 plan P1-Q1 ~ P1-Q6은 본 plan에서 무관해짐 — 새 입력 모델 적용으로 자동 해결).

| # | 항목 | 옵션 | 권장값 |
|---|---|---|---|
| **P1-N1** | Multipart 바디에서 JSON 필드 파싱 방식 | (a) DTO `@Transform` + JSON.parse / (b) 컨트롤러에서 raw 받아 수동 파싱 / (c) 클라이언트가 application/json + 사진 base64 인코딩 | **(a)** 응집성 + 클라이언트 비용 최소 |
| **P1-N2** | M4 시드의 down() 동작 | (a) 14개 시드 텍스트만 정확히 매칭 삭제 / (b) `TRUNCATE diary_questions` (사용자 추가 row까지 모두 삭제) / (c) down() 빈 구현 (시드는 영구) | **(a)** 안전한 역적용 |
| **P1-N3** | `diary_questions` 14개 시드 텍스트 임상 자문 검수 | (a) Phase 1 코드 작성 전 검수 / (b) Phase 1 완료 후 운영 진입 전 검수 / (c) 검수 생략 | **(b)** 코드 작업 병행 가능, 운영 전 필수 |
| **P1-N4** | 마이그레이션 자동화 테스트 인프라 도입 시점 | (a) Phase 1에 도입 (`testcontainers-node` 설치) / (b) Phase 7 QA에서 도입 (Phase 1은 수동 검증) | **(b)** Phase 1 scope 절약 |
| **P1-N5** | `patientAnswers` 최소 개수 DTO 강제 | (a) DTO에서 `@ArrayMinSize(1)` 강제 (photo만 시나리오 불허) / (b) DTO에서 `@ArrayMinSize(0)` + 서비스에서 OR 검증 (photo만 허용) | **(b)** R2=(b) 재해석 일관성 |
| **P1-N6** | 트랜잭션 롤백 시 사진 파일 cleanup | (a) `MemoryEntryService.create` catch에서 즉시 `FileStorageService.delete()` / (b) 별도 cleanup queue + 배치 작업 / (c) cleanup 미수행 (orphan 파일 허용) | **(a)** 가장 단순, 일관성 |
| **P1-N7** | `PatientMemoryNote.answerText` PII 마스킹 시점 | (a) Phase 1에서 저장 전 `/mask` 호출 / (b) Phase 1은 raw 저장, Phase 2 LLM 입력 시점에 마스킹 / (c) 운영 진입 전 별도 결정 | **(c)** Phase 1 scope 절약, 정책 결정 필요 |
| **P1-N8** | 보호자 사적 데이터 보호자 본인 조회용 endpoint | (a) Phase 1에 추가 (`GET /memory-entries/:id/private`) / (b) Phase 8+ 추가 (mood 추세 화면 도입 시) | **(b)** 현재 UI 요구 없음 |
| **P1-N9** | `emotionTag`/`targetWords` 호환 유지 vs 즉시 제거 | (a) Phase 1에 호환 유지 (deprecated optional) / (b) Phase 1에서 제거 / (c) Phase 4 보호자 화면 재설계 시 제거 | **(a)** 안전한 마이그레이션 경로 |

> 위 9개 항목은 본 plan 승인 시점에 결정되어야 코드 작성이 가능하다.

### ✅ 확정 결정 (2026-05-17, 사용자 승인 — 권장값 일괄 채택)

| # | 확정값 | 핵심 적용 |
|---|---|---|
| P1-N1 | (a) DTO `@Transform` + JSON.parse | multipart 내 nested JSON 파싱 응집화 |
| P1-N2 | (a) 14개 시드 텍스트 정확 매칭 삭제 | down() 안전성 |
| P1-N3 | (b) Phase 1 완료 후 임상 검수 | 코드 작업 병행 |
| P1-N4 | (b) Phase 7 QA에서 testcontainers 도입 | Phase 1 scope 절약 |
| P1-N5 | (b) DTO `@ArrayMinSize(0)` + 서비스에서 OR 검증 | R2(b) 재해석 — patientAnswers≥1 OR photo |
| P1-N6 | (a) catch에서 `FileStorageService.delete()` 즉시 | 사진 orphan 방지 |
| P1-N7 | (c) 운영 진입 전 별도 결정 | Phase 1은 raw 저장 |
| P1-N8 | (b) Phase 8+ mood 추세 화면과 함께 도입 | 현재 UI 요구 없음 |
| P1-N9 | (a) `emotionTag`/`targetWords` deprecated optional 유지 | 안전한 마이그레이션 경로 |

---

## 14. SOLID 원칙 준수 점검

| 원칙 | 평가 | 비고 |
|---|---|---|
| **S** 단일 책임 | ✅ | 신규 4개 Memory 엔티티 각각 단일 도메인 (Mood=무드, CaregiverReflection=사적 답변, PatientMemoryNote=환자 답변, DiaryQuestion=질문 풀). DTO는 입력/출력 책임만. `DiaryQuestionService`는 질문 추출만 담당. |
| **O** 개방-폐쇄 | ✅ | `explanation` 컬럼 사전 확보(quiz_questions, Phase 2 확장). `generation_status`를 VARCHAR로 두어 신규 상태 추가 유연. `IQuizGenerationPayload` 인터페이스로 LLM 페이로드 확장 시 타입 안전. |
| **L** 리스코프 치환 | ✅ | `MemoryEntryPrivateResponseDto extends MemoryEntryPublicResponseDto` — Private 객체는 Public이 기대되는 모든 위치에서 사용 가능. (사용 시점 정책으로 Public 위치에 Private 노출 금지 별도 강제) |
| **I** 인터페이스 분리 | ✅ | `QuizModule.exports: []` 빈 시작. `IQuizGenerationPayload`에 보호자 데이터 필드 부재. Public/Private DTO 분리. |
| **D** 의존성 역전 | ⚠️ | 엔티티 직접 import (MemoryEntry, User, DiaryQuestion)는 TypeORM 관례상 불가피. 추상 인터페이스(`IQuizGenerationClient`, `IQuizScorer`)는 Phase 3에서 도입. Phase 1은 `IQuizGenerationPayload` 타입만 미리 정의. |

---

## 15. 확장성 시나리오 검토

### 15-1. "Phase 6 양방향 치유 v1 (Pattern 1 + Pattern 2) 진입 시?"

| 영향 항목 | Phase 1 대비 변경 |
|---|---|
| `caregiverWishMessage` 컬럼 | **이미 추가됨** (M1) → 신규 마이그레이션 불필요 |
| 환자 화면에서 `CaregiverWishCard` 렌더링 | Public DTO에 `caregiverWishMessage` 이미 포함 → API 변경 불필요 |
| FastAPI `/wish/to-practice` 호출 | 별도 페이로드 빌더 작성 — `IQuizGenerationPayload`와 분리된 새 인터페이스 |
| Pattern 2 healing_messages | 별도 테이블/시드 신설 (본 Phase 1 범위 아님) |

> 결론: Phase 1 데이터 모델은 Phase 6까지 **마이그레이션 0건**으로 확장 가능.

### 15-2. "FastAPI 호출에 사진 태그를 LLM 입력으로 추가한다면? (R7=(b) 전환)"

| 영향 항목 | 변경 |
|---|---|
| `IQuizGenerationPayload.photoTags` | **이미 정의됨** (§9-2) — 타입 변경 없음 |
| FastAPI 페이로드 빌더 | Phase 2/3 코드 변경만 |

### 15-3. "보호자 무드 추세 화면을 도입한다면? (Phase 8+)"

| 영향 항목 | 변경 |
|---|---|
| `mood_entries` 쿼리 인덱스 | **이미 추가됨** (`IDX_mood_entries_caregiver_recorded`) — 추가 인덱스 불필요 |
| Private DTO | **이미 정의됨** (§6-4) — Phase 8 endpoint 신설 시 즉시 사용 가능 |

### 15-4. "환자 답변 카테고리를 1개 추가한다면? (예: `feeling`)"

| 영향 항목 | 변경 |
|---|---|
| `PatientMemoryNote.category` | VARCHAR(16) → 신규 값 추가만 (DB CHECK 없음) |
| `diary_questions.category` | 동일 |
| App 검증 (`@IsIn(...)`) | enum 갱신 |
| 시드 | 신규 카테고리 질문 1~3개 추가 |
| 마이그레이션 | **불필요** |

> 결론: 카테고리 추가는 코드 변경만으로 가능.

### 15-5. "퀴즈 셋 재생성(force=true)이 도입된다면? (Phase 3)"

| 영향 항목 | 변경 |
|---|---|
| `quiz_sets` 동일 `memory_entry_id` 2개 row | Phase 1에 UNIQUE 미설정 → 가능 |
| `quiz_best_scores` UNIQUE | Phase 3에서 결정 — 재생성 시 best_score 초기화 vs 보존 정책 결정 필요 |
| `generation_id` 컬럼 도입 | Phase 3에서 별도 마이그레이션 |

---

## 16. 다음 단계 (Phase 2 진입 조건)

Phase 1 완료 = 다음 모두 충족:

1. ✅ §11 파일 단위 변경 표의 NEW/MODIFY **37개 항목 모두 코드 반영**
2. ✅ §10 단위 테스트 모두 통과:
   - DTO 검증 5 케이스
   - Service 트랜잭션 8 케이스
   - DiaryQuestionService 3 케이스
   - 시드 멱등성 케이스
   - QuizModule 스모크 케이스
   - 응답 DTO 보안 회귀 케이스
3. ✅ 마이그레이션 4개 파일 작성 완료 (실행은 운영 전환 시점)
4. ✅ 개발 환경에서 `synchronize: true` + `seedDiaryQuestionsIfMissing()` 동작 확인 (14개 row 생성)
5. ✅ §13 추가 결정 필요 항목 9개 모두 사용자 답변 수령 및 plan 반영
6. ✅ 백엔드 빌드(`npm --workspace backend run build`) 성공
7. ✅ 백엔드 테스트(`npm --workspace backend run test`) 성공
8. ✅ 사용자 승인

위 조건을 모두 만족하면 **Phase 2 (FastAPI 퀴즈 생성기) Feature Plan 작성**으로 진행한다.

---

## 17. 산출물 체크리스트 (구현 위임용 task.md)

```
## Phase 1 구현 체크리스트

### Domain Layer (Memory Entities)
- [ ] [쉬움]  MemoryEntry.caregiverWishMessage 컬럼 추가 (TEXT NULL)
- [ ] [보통]  MoodEntry entity (UNIQUE memory_entry_id, CHECK 1..5)
- [ ] [보통]  CaregiverReflection entity (isPrivate DEFAULT TRUE)
- [ ] [보통]  PatientMemoryNote entity (UNIQUE entry+order, category enum)
- [ ] [보통]  DiaryQuestion entity (scope/category 인덱스)

### Domain Layer (Quiz Entities) — 골격
- [ ] [보통]  QuizSet entity (FK + 인덱스)
- [ ] [보통]  QuizQuestion entity (UNIQUE order_index)
- [ ] [보통]  QuizAttempt entity (3개 FK + 인덱스 2개)
- [ ] [보통]  QuizBestScore entity (UNIQUE quiz_set_id)
- [ ] [쉬움]  quiz-generation-status.ts / quiz-question-type.ts 상수
- [ ] [쉬움]  IQuizGenerationPayload.ts 인터페이스 (LLM 페이로드 화이트리스트)

### Application Layer (DTOs)
- [ ] [보통]  CreateMemoryEntryDto 재설계 (mood/patientAnswers/caregiverAnswer/caregiverWishMessage)
- [ ] [쉬움]  PatientMemoryNoteInputDto, CaregiverReflectionInputDto, MoodInputDto (nested)
- [ ] [쉬움]  MemoryEntryPublicResponseDto (patientNotes + caregiverWishMessage, mood/reflection 부재)
- [ ] [쉬움]  MemoryEntryPrivateResponseDto (Public extends + mood + reflection)
- [ ] [쉬움]  DiaryQuestionResponseDto, DiaryQuestionQueryDto

### Application Layer (Services)
- [ ] [보통]  DiaryQuestionService (scope/category 랜덤 추출, BadRequest/NotFound 처리)
- [ ] [어려움] MemoryEntryService.create() 단일 트랜잭션 확장 (DataSource 주입)
- [ ] [보통]  사진 cleanup on 롤백 (P1-N6=(a) 권장)

### Infrastructure Layer (Migrations + Seeds + Modules)
- [ ] [쉬움]  M1: add-caregiver-wish-to-memory.ts
- [ ] [어려움] M2: create-mood-and-reflection-tables.ts (4 테이블)
- [ ] [어려움] M3: create-quiz-tables.ts (4 테이블)
- [ ] [보통]  M4: seed-diary-questions.ts (14 row, 멱등)
- [ ] [보통]  diary-questions.seed.ts + seedDiaryQuestionsIfMissing() 부트스트랩 훅
- [ ] [쉬움]  QuizModule 골격 (TypeOrmModule.forFeature)
- [ ] [쉬움]  MemoryModule 확장 (4 신규 엔티티 + DiaryQuestionService)
- [ ] [쉬움]  AppModule import (QuizModule)

### Presentation Layer (Controller)
- [ ] [보통]  MemoryController.create: multipart body Transform JSON.parse 적용
- [ ] [쉬움]  MemoryController.create: @UploadedFile optional 전환
- [ ] [쉬움]  MemoryController: GET /diary-questions/today 핸들러

### Tests
- [ ] [보통]  create-memory-entry.dto.spec.ts (5 케이스)
- [ ] [보통]  memory-entry-response.dto.spec.ts (보안 회귀 — 사적 데이터 부재)
- [ ] [어려움] memory.service.spec.ts (8 케이스 트랜잭션 회귀)
- [ ] [보통]  diary-question.service.spec.ts (3 케이스)
- [ ] [쉬움]  diary-questions.seed.spec.ts (멱등성)
- [ ] [쉬움]  quiz.module.spec.ts (스모크)

### Verification
- [ ] [쉬움]  npm --workspace backend run build 통과
- [ ] [쉬움]  npm --workspace backend run test 통과
- [ ] [보통]  로컬 PG에서 synchronize 적용 확인 (9개 테이블 + 1개 컬럼 + 14개 시드 row)
- [ ] [어려움] (P1-N4=(b)) Phase 7 QA에서 synchronize:false + migration:run 검증
```

---

> 본 문서는 Phase 1 plan 단계로, 코드 변경은 포함하지 않는다.
> §13 추가 결정 필요 항목 9개 답변 수령 후 `clean-code-developer` 에이전트로 실행 위임한다.
