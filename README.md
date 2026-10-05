# Memory Link (practiveTTS)

실어증(뇌졸중 후 언어 장애) 환자의 언어 회복을 돕는 앱이다. 보호자가 환자와 함께한
**기억**(사진과 일기)을 등록하면, AI가 그 기억으로 질문·퀴즈·대화 연습을 만들고, 환자는
음성으로 따라 말하거나 그림을 보고 단어를 떠올리는 훈련을 한다. 보호자는 훈련 추이를 본다.

> 현재 상태: 첫 배포 준비 단계. 실사용자는 아직 없다. 한국어판이 먼저이고 영어판은 진행 중이다.

---

## 주요 기능

- **보호자 기록**: 기억 등록(사진 + 메모), 가족 정보와 환자 프로필(가족 페르소나) 관리
- **AI 퀴즈·문항**: 기억에서 퀴즈 문항을 생성(Gemini). 그림 이름대기·그림 고르기 등 문항 종류가 있다
- **음성 훈련**: 따라 말하기(STT) → 발음 채점, 문항 낭독(TTS). 발음 채점은 Azure Speech 사용
- **대화 훈련**: 기억을 바탕으로 한 대화 연습 세션(턴마다 AI 응답)
- **추이 확인**: 보호자 화면의 훈련 추이 카드(활동 일자 집계)
- **동의 기반 음성 보존**: 채점용 발화는 환자 동의가 있을 때만 저장
- **개인정보 보호**: 가족 실명 등 민감 정보는 `CRYPTO_SECRET_KEY`로 암호화해 저장

---

## 구조

```
practiveTTS/
├── backend/        NestJS 백엔드 — 인증, 기억·퀴즈·훈련 API, AI 프록시, DB 마이그레이션
├── frontend/       React + Vite 프론트엔드 — 보호자·환자 화면(memory-link/), 문항 컴포넌트(assessments/)
├── ai-service/     FastAPI — LLM(Gemini)·음성(Azure) 호출, 마스킹·태깅·채점
├── scripts/        데이터·이미지 생성 스크립트, 배포 스크립트(scripts/deploy/)
├── tts-cache/      생성된 음성 파일 캐시(로컬 디스크)
├── docs/           설계·계획·레퍼런스 문서
├── DESIGN.md       디자인 시스템(Warm Clinical: 세이지 그린 + 크림 + 테라코타)
├── DEPLOYMENT.md   배포 절차·스모크 체크리스트·백업·비용 상한
└── TODOS.md        다음 할 일의 정본(맨 앞 절)
```

서비스는 셋으로 나뉘어 있다. 프론트는 백엔드만 부르고, 백엔드가 인증·상한을 걸고 AI 서비스를
프록시한다. 브라우저는 AI 서비스를 직접 부르지 않는다.

```
 브라우저 ──▶ frontend (Vite SPA)
                 │  REST (JWT)
                 ▼
            backend (NestJS :3000) ──▶ PostgreSQL
                 │  내부 호출 (AI_SERVICE_TOKEN)
                 ▼
            ai-service (FastAPI :8000) ──▶ Gemini · Azure Speech
```

---

## 기술 스택

| 영역 | 사용 |
|---|---|
| 백엔드 | NestJS 11, TypeORM, PostgreSQL, JWT(Passport) |
| 프론트엔드 | React, TypeScript, Vite, Tailwind CSS, Zustand, Axios |
| AI 서비스 | FastAPI, LangChain, Google Gemini, Azure Speech SDK |
| 저장소 | PostgreSQL(데이터), 로컬 디스크 또는 Cloudflare R2(사진) |
| 테스트 | Jest(백엔드), Vitest(프론트), pytest(AI 서비스) |
| 배포 | Vultr VPS + nginx + pm2 (DEPLOYMENT.md) |

---

## 빠른 시작 (로컬 개발)

필요한 것: Node.js 22(서버와 같은 버전), Python 3.11(로컬에서 확인한 버전), PostgreSQL.

### 1. 데이터베이스

```bash
createdb practivetts        # 또는 pgAdmin 등으로 생성
```

### 2. 백엔드

```bash
cd backend
cp .env.example .env        # 값을 채운다 (아래 "환경변수")
npm ci
npm run migration:run       # 마이그레이션 적용
npm run start:dev           # http://localhost:3000
```

### 3. AI 서비스

```bash
cd ai-service
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

### 4. 프론트엔드

```bash
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:3000
npm ci
npm run dev                 # http://localhost:5173
```

---

## 환경변수

각 서비스의 `.env.example`에 전체 목록과 설명이 있다. 여기서는 필수 항목만 적는다.

| 서비스 | 필수 | 설명 |
|---|---|---|
| backend | `DB_*`, `JWT_SECRET`, `CRYPTO_SECRET_KEY`, `AI_SERVICE_URL`, `AI_SERVICE_TOKEN` | `CRYPTO_SECRET_KEY`(32자 이상)는 **한 번 정하면 바꿀 수 없다.** 바꾸면 저장된 암호화 데이터를 복호화할 수 없다 |
| ai-service | `GEMINI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AI_SERVICE_TOKEN` | 백엔드와 같은 `AI_SERVICE_TOKEN` 값을 써야 한다 |
| frontend | `VITE_API_URL` | 백엔드 주소. 번들에 들어가므로 **비밀을 넣지 않는다** |

환경변수 드리프트(코드가 읽는데 예시 파일에 없는 값, 그 반대)는 테스트가 잡는다
(`backend/src/common/env-drift.spec.ts`, `ai-service/tests/test_env_drift.py`).

---

## 테스트

```bash
cd backend  && npm test                # 단위 테스트
cd backend  && npm run test:int        # 통합 테스트 (Postgres 필요, practivetts_test DB를 만든다)
cd frontend && npm test                # 프론트 테스트 (Vitest)
cd ai-service && venv/bin/python -m pytest   # Windows: venv\Scripts\python -m pytest
bash scripts/deploy/tests/deploy-scripts.test.sh   # 배포 스크립트 회귀 (서버 없이 돈다)
```

행을 쓰는 통합 테스트는 개발 DB를 건드리지 않도록 `practivetts_test`에서 돈다(이름이 `_test`로
끝나야 실행된다). 읽기 전용 통합 테스트는 개발 DB에 붙는다. 마이그레이션이 빈 DB에서 완주하고 엔티티와 스키마가 같은지(드리프트 0)도
통합 테스트가 확인한다.

---

## 비용과 보안 — 알아둘 것

- **유료 API**: Gemini(LLM), Azure Speech(STT·발음·TTS). 가구별 하루 상한과 **서비스 전체 하루
  상한**이 걸려 있다(`backend/src/usage/`). 자세한 값과 공급자 쪽 한도 설정은 DEPLOYMENT.md
  「비용 상한」 절.
- **AI 서비스는 외부에 열리지 않는다.** 백엔드만 내부 토큰으로 호출하고, 서버 바인딩은
  `127.0.0.1`이다.
- **음성 원본**은 동의한 경우에만 저장하고, 가족 실명 등은 암호화해 둔다.

---

## 배포

Vultr 서울 리전 VPS 한 대에 nginx(HTTPS) + pm2(backend, ai-service) + PostgreSQL을 올린다.
사진은 Cloudflare R2에 두고, DB는 매일 pg_dump로 R2 백업 버킷에 올린다.

배포 절차, 첫 배포 스크립트 순서(`01` → `03` → `02` → `04`), 스모크 체크리스트, 백업 복원 리허설은
**[DEPLOYMENT.md](DEPLOYMENT.md)** 에 있다. 배포 전 확인 명령도 거기 있다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | 배포·백업·감시·비용 상한 |
| [DESIGN.md](DESIGN.md) | 디자인 시스템 (색·간격·모션 규칙) |
| [TODOS.md](TODOS.md) | 다음 할 일과 보류 항목 (맨 앞 절이 정본) |
| [CLAUDE.md](CLAUDE.md) | 개발 원칙과 기술 규칙 |
| `docs/` | 설계·계획 이력, 음성 학습 자료 |

---

## 라이선스

비공개 프로젝트다. 외부 배포·재사용 라이선스는 아직 정하지 않았다.
