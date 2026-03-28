# 메모리 링크 (Memory Link) Phase 1 MVP 구현 계획

## Context

기존 practiveTTS 프로젝트(QAB 실어증 평가 시스템) 위에 신규 제품 **메모리 링크**를 추가 구축한다.
메모리 링크는 환자의 라이프 로그(사진, 에피소드)를 RAG 기반으로 활용해 초개인화된 대화형 인지 재활 훈련을 제공하는 AI 플랫폼이다.
기존 QAB 평가 기능은 그대로 유지하며, 독립적인 모듈로 추가된다.

---

## 전체 시스템 아키텍처

```
보호자/환자 디바이스
 └── React Frontend (5173)
      ├── /caregiver/* → 보호자 화면 (사진 업로드, 단어 지정)
      ├── /patient/*   → 환자 화면 (대화형 훈련, 큰 글씨/고대비 UI)
      └── /assessment/* → 기존 QAB 평가 (변경 없음)

NestJS Backend (3000)
 ├── /auth/*            → JWT 인증 (패키지 설치됨, 구현만 필요)
 ├── /memory-entries/*  → 라이프로그 CRUD + 파일 업로드
 ├── /training/*        → 훈련 세션 관리 + FastAPI 프록시
 └── /tts/*             → TTS 하이브리드 캐싱 (CLAUDE.md 전략 그대로)

FastAPI AI Service (8000)
 ├── POST /tag       → Claude Vision 이미지 자동 태깅
 ├── POST /mask      → PII 마스킹/익명화 (식별자 치환)
 ├── POST /scenario  → 훈련 시나리오 생성 (Claude 3.5 Sonnet + Guardrail)
 └── POST /chat      → RAG 대화 Agent (LangGraph Window Buffer Memory)

PostgreSQL DB
 ├── users, memory_entries, training_sessions, conversation_logs
 └── tts_cache (기존 CLAUDE.md 스키마)
```

---

## 데이터베이스 스키마

### 신규 엔티티 파일 경로

```
backend/src/
├── database/database.module.ts         (TypeORM 연결 설정)
├── auth/entities/user.entity.ts
├── memory/entities/
│   ├── memory-entry.entity.ts
│   └── target-word.entity.ts
└── training/entities/
    ├── training-session.entity.ts
    └── conversation-log.entity.ts
```

### 핵심 엔티티 컬럼

**users**: id(UUID PK), email, password_hash, role(caregiver/patient/therapist), display_name, patient_id(FK→users)

**memory_entries**: id, caregiver_id(FK), patient_id(FK), photo_url, location_tag, object_tags(JSONB), emotion_tag, target_words(VARCHAR[] max 3), masked_context(TEXT, 암호화), scenario_cache(TEXT, 암호화), created_at

**training_sessions**: id, patient_id(FK), memory_entry_id(FK), status, hint_level(0~2), target_word_used, success, duration_ms

**conversation_logs**: id, session_id(FK), role(ai/patient), content(TEXT, 암호화), hint_triggered

**tts_cache**: id, text_hash(UNIQUE), text_content, audio_url, voice_name, hit_count ← 기존 CLAUDE.md 스키마

> 암호화: `masked_context`, `scenario_cache`, `content`는 pgcrypto AES-256 적용. TypeORM `@BeforeInsert`/`@BeforeUpdate` subscriber 활용.

---

## API 설계 (NestJS)

```
POST   /auth/register
POST   /auth/login
GET    /auth/me

POST   /memory-entries              (multipart: photo + emotion_tag + target_words[])
GET    /memory-entries
GET    /memory-entries/:id
PATCH  /memory-entries/:id
POST   /memory-entries/:id/scenario (시나리오 생성 트리거 → FastAPI /scenario)

POST   /training/sessions           (body: { memoryEntryId, targetWord })
GET    /training/sessions/:id
POST   /training/sessions/:id/message  (body: { transcript }) → FastAPI /chat 프록시
POST   /training/sessions/:id/hint
PATCH  /training/sessions/:id/complete

POST   /tts/speak                   (body: { text }) → 캐시 조회 후 Azure TTS
```

---

## AI 서비스 구조 (FastAPI)

```
ai-service/
├── main.py                     (기존 - include_router 4개 추가)
├── routers/
│   ├── tagging.py              (Claude Vision → 장소/사물 한국어 태깅)
│   ├── masking.py              (정규식 + Claude → 식별자 치환: 이름→Family_M1)
│   ├── scenario.py             (Claude 3.5 Sonnet + Guardrail 프롬프트)
│   └── chat.py                 (LangGraph Agent + Window Buffer Memory 10턴)
├── services/
│   ├── claude_client.py
│   ├── rag_service.py
│   └── masking_service.py
└── models/                     (Pydantic 모델)
```

**Guardrail 원칙**: 시나리오 생성 시 목표 단어를 직접 언급 금지. `{GUARDRAIL_WORDS}` 플레이스홀더로 관리. 정답 단어 누설 감지 시 Fallback 로직 실행.

**힌트 단계**: `hint_level` 파라미터로 프롬프트 동적 조정

- 0: 일반 대화
- 1: 첫 음절 힌트 삽입 ("아..")
- 2: 양자택일 폐쇄형 질문으로 전환

---

## 프론트엔드 구조

```
frontend/src/
├── App.tsx                     (react-router-dom 도입, 라우팅 분기)
├── assessments/                (기존 - 변경 없음)
├── memory-link/                (신규)
│   ├── caregiver/
│   │   ├── domain/MemoryEntry.ts
│   │   ├── application/useMemoryEntries.ts, useCaptureFlow.ts
│   │   ├── infrastructure/MemoryEntryApi.ts
│   │   └── presentation/
│   │       ├── CaregiverDashboard.tsx
│   │       ├── CaptureScreen.tsx   (사진+감정태그+목표단어 chip UI)
│   │       ├── EntryListScreen.tsx
│   │       └── EntryDetailScreen.tsx
│   ├── patient/
│   │   ├── domain/TrainingSession.ts
│   │   ├── application/
│   │   │   ├── useTrainingSession.ts  (세션 상태 + 메시지 전송)
│   │   │   └── useSilenceDetector.ts (10초 타이머 훅)
│   │   ├── infrastructure/
│   │   │   ├── TrainingSessionApi.ts
│   │   │   └── SttService.ts         (Web Speech API 래퍼)
│   │   └── presentation/
│   │       ├── PatientDashboard.tsx
│   │       └── TrainingScreen.tsx    (큰 글씨, 고대비, 음성 우선)
│   └── shared/
│       ├── AuthContext.tsx
│       └── MemoryLinkApi.ts          (Axios 인스턴스)
└── shared/                           (기존 - 변경 없음)
```

**환자 UI 원칙**: `text-2xl` 이상, 흰 배경/검정 텍스트 고대비, 터치 영역 최소 48px, 음성 우선

**침묵 감지 흐름**:

1. STT 결과 수신 시 10초 타이머 리셋
2. 10초 경과 → `hint_level=1` → POST `/training/sessions/:id/hint` → TTS 재생
3. 추가 침묵 → `hint_level=2` → 양자택일 질문 TTS 재생

---

## 구현 순서

### Phase 1-A: 인프라 기반

1. **NestJS DB 연결**: `database.module.ts` 생성, `app.module.ts` import, TypeORM 마이그레이션 초기화
2. **JWT 인증 모듈**: `user.entity.ts` → `auth.module.ts` → `auth.controller.ts` (기존 패키지 활용)
3. **프론트엔드 라우터 도입**: `react-router-dom` 설치, `App.tsx` 라우터 전환, `AuthContext.tsx` 구현

### Phase 1-B: 핵심 기능

4. **메모리 엔트리 백엔드**: entity → module → service → controller, Multer 업로드, 정적 파일 서빙
5. **FastAPI AI 엔드포인트**: mask → tag → scenario → chat (의존성 순서로 구현)
6. **보호자 화면**: CaptureScreen, EntryListScreen, EntryDetailScreen
7. **훈련 세션 백엔드**: training entity, session CRUD, FastAPI /chat 프록시
8. **환자 훈련 화면**: TrainingScreen, useSilenceDetector, SttService, TTS 통합

### Phase 1-C: TTS 통합

9. **TTS 백엔드 모듈**: `tts.service.ts` (캐시 조회 → Azure TTS → 캐시 저장)
10. **정적 TTS 사전 생성**: 훈련 화면 고정 문구 `staticTtsManifest.ts` 추가

### Phase 1-D: 마무리

11. **푸시 알림**: `@nestjs/schedule` Cron + 브라우저 Notification API (하루 1회)
12. **통합 테스트 + 접근성 검토**

---

## Critical Files

| 파일                                                                                             | 역할                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| [backend/src/app.module.ts](backend/src/app.module.ts)                                           | 전체 모듈 등록 진입점                |
| [frontend/src/App.tsx](frontend/src/App.tsx)                                                     | react-router-dom 도입 및 라우팅 분기 |
| [ai-service/main.py](ai-service/main.py)                                                         | FastAPI 라우터 등록 진입점           |
| [frontend/src/shared/infrastructure/](frontend/src/shared/infrastructure/)                       | 기존 TTS 아키텍처 패턴 참고          |
| [frontend/src/shared/session/SessionContext.tsx](frontend/src/shared/session/SessionContext.tsx) | AuthContext 설계 패턴 참고           |

---

## 기술적 위험 요소

| 위험                  | 대응                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| 한국어 STT 품질       | confidence < 0.6 시 재시도 유도 + 텍스트 입력 fallback 버튼                      |
| 의료 개인정보 보호    | DB 컬럼 암호화 + 마스킹 후에만 Claude API 전송 + `entity_map` 외부 전송 금지     |
| Claude API 응답 지연  | 시나리오 업로드 시 미리 생성(비동기) + 대화 SSE 스트리밍 응답                    |
| LangGraph 메모리 누수 | `session_id`를 checkpointer 키로 사용 + 세션 완료 시 정리                        |
| 기존 QAB와 충돌       | `assessments/` 디렉토리 절대 수정 금지 + App.tsx는 라우팅 분기만 변경            |
| 이미지 저장소 확장성  | MVP: 로컬 5MB 제한, Phase 2: S3/Azure Blob 마이그레이션 (`photo_url` URL 추상화) |

---

## 검증 방법

1. **보호자 플로우**: 사진 업로드 → AI 태깅 결과 확인 → 목표 단어 저장 → 시나리오 생성 확인
2. **환자 플로우**: 훈련 시작 → TTS 질문 재생 → STT 발화 → AI 응답 → 10초 침묵 → 힌트 자동 제공
3. **TTS 캐싱**: 동일 텍스트 2회 요청 시 두 번째는 캐시 hit(`fromCache: true`) 확인
4. **기존 QAB 무결성**: `/assessment` 경로의 LOC/SentComp/WordComp 기존 동작 정상 확인
5. **환자 UI 접근성**: 폰트 크기, 색상 대비(4.5:1 이상), 터치 영역(48px 이상) 검토
