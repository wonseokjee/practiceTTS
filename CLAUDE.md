# Project: practiveTTS

## Tech Stack
- **Backend**: NestJS
- **Frontend**: React
- **LLM 기능**: FastAPI
- **Database**: PostgreSQL
- **ORM**: TypeORM (NestJS 기본)
- **상태 관리**: Zustand
- **패키지 매니저**: npm
- **API 통신**: Axios
- **CSS / UI**: Tailwind CSS
- **인증 방식**: JWT
- **테스트**: Jest (NestJS) / Vitest (React)
- **코드 스타일**: ESLint + Prettier
- **LLM SDK**: LangChain
- **TTS**: Azure TTS (ko-KR-SunHiNeural)

## 개발 원칙
- Backend(NestJS)와 Frontend(React)는 별도 서비스로 분리
- LLM 관련 기능은 FastAPI 서비스로 독립 구성
- 각 서비스 간 통신은 REST API 또는 WebSocket 사용
- 모든 서비스는 npm으로 패키지 관리
- 코드 스타일은 ESLint + Prettier로 통일

## TTS 전략 (하이브리드 캐싱)
- TTS 요청 시 PostgreSQL 캐시 테이블(tts_cache)을 먼저 조회
- 캐시 존재 시: 저장된 음성 파일 직접 반환 (빠름, 무료)
- 캐시 없을 시: Azure TTS API 호출 → 파일 저장 → DB 메타데이터 저장 → 반환
- **Pre-generated**: 고정 지시문, 피드백 문구, 커리큘럼 단어/문장 (배포 시 미리 생성)
- **On-demand + 캐싱**: LLM 생성 동적 피드백, 사용자 맞춤 문장

## 언어 설정

모든 대화는 한국어로 진행한다. gstack 스킬 실행 시 질문, 설명, 응답 등 모든 출력을 한국어로 작성한다.

## gstack

Use the `/gstack-browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/gstack-office-hours`, `/gstack-plan-ceo-review`, `/gstack-plan-eng-review`, `/gstack-plan-design-review`, `/gstack-design-consultation`, `/gstack-review`, `/gstack-ship`, `/gstack-land-and-deploy`, `/gstack-canary`, `/gstack-benchmark`, `/gstack-browse`, `/gstack-qa`, `/gstack-qa-only`, `/gstack-design-review`, `/gstack-setup-browser-cookies`, `/gstack-setup-deploy`, `/gstack-retro`, `/gstack-investigate`, `/gstack-document-release`, `/gstack-codex`, `/gstack-cso`, `/gstack-autoplan`, `/gstack-careful`, `/gstack-freeze`, `/gstack-guard`, `/gstack-unfreeze`, `/gstack-upgrade`

## 디렉토리 구조 (예시)
```
practiveTTS/
├── backend/            # NestJS 백엔드
├── frontend/           # React 프론트엔드
├── ai-service/         # FastAPI LLM 서비스
└── tts-cache/          # 생성된 음성 파일 저장소
    ├── pregenerated/   # 사전 생성 음성
    └── dynamic/        # On-demand 캐시 음성
```
