# FastAPI AI 서비스 (Memory Link) Feature Plan

- 작성일: 2026-03-22
- 작성자: Feature Architect Agent
- 참조 문서: `docs/history/20260321_MemoryLink_implementation_plan.md`

---

## 목표 및 배경

Memory Link 플랫폼의 AI 핵심 기능 4개 엔드포인트를 FastAPI로 구현한다.
보호자가 업로드한 환자의 라이프 로그(사진) 기반으로 인지 재활 훈련 시나리오를 자동 생성하고,
LangGraph 기반 RAG 에이전트가 환자와 대화형 훈련을 수행한다.

### 구현 대상 엔드포인트

| 엔드포인트     | 역할                                              | Gemini 모델           |
| -------------- | ------------------------------------------------- | --------------------- |
| `POST /tag`    | 이미지 자동 태깅 (장소/사물 한국어 태그 추출)     | gemini-1.5-pro (Vision) |
| `POST /mask`   | PII 마스킹 / 식별자 치환                          | gemini-2.0-flash (빠른 마스킹) |
| `POST /scenario` | 훈련 시나리오 생성 (Guardrail 포함)             | gemini-1.5-pro     |
| `POST /chat`   | RAG 대화 에이전트 (Window Buffer Memory 10턴)     | gemini-1.5-pro     |

### NestJS ↔ FastAPI 연동 흐름

```
보호자 사진 업로드 (POST /memory-entries)
  └── NestJS → FastAPI POST /tag   → locationTag, objectTags 저장
  └── NestJS → FastAPI POST /mask  → maskedContext 저장

시나리오 생성 트리거 (POST /memory-entries/:id/scenario)
  └── NestJS → FastAPI POST /scenario → scenarioCache 저장

환자 훈련 대화 (POST /training/sessions/:id/message)
  └── NestJS → FastAPI POST /chat  → AI 응답 반환
```

---

## Phase 1: 컨텍스트 수집 결과 요약

### 기존 ai-service 현황

- `main.py`: FastAPI 앱 초기화, CORS 설정 완료. 라우터 미등록 상태.
- `requirements.txt`: fastapi 0.131.0, langchain 1.2.10, langgraph 1.0.9, pydantic 2.12.5, google-generativeai SDK 미설치 (openai SDK만 존재)
- `routers/`, `services/`, `models/` 디렉토리 미존재 → 전부 신규 생성

### 기존 코드 패턴 분석

**네이밍 컨벤션**
- Python: snake_case (파일명, 변수, 함수)
- TypeScript: camelCase (변수, 함수), PascalCase (클래스, 인터페이스), kebab-case (파일명)
- 인터페이스 접두사: `I` (예: `ITtsService`, `IAudioPlayer`)

**에러 처리 패턴 (NestJS 참조)**
- 타입이 있는 예외 클래스 사용 (ConflictException, UnauthorizedException 등)
- FastAPI에서는 `HTTPException` + 도메인별 커스텀 예외 클래스로 통일

**의존성 주입 패턴**
- NestJS: `@Injectable()` + 생성자 주입
- FastAPI: `Depends()` 함수형 의존성 주입으로 통일

**인터페이스 우선 설계 패턴 (기존 TTS 서비스 참조)**
- `ITtsService` → `WebSpeechTtsService`, `StaticFileTtsService` 구조 준수
- FastAPI에서도 ABC(Abstract Base Class) 인터페이스 → 구현체 구조 적용

---

## Phase 2: 도메인 모델링

### 2-1. 값 객체 (Value Object) 정의

#### TagResult (이미지 태깅 결과)

```
필드:
  - location_tag: str          # 장소 태그 (예: "거실", "공원")
  - object_tags: list[str]     # 사물 태그 목록 (예: ["소파", "강아지"])
  - confidence: float          # Gemini Vision 신뢰도 (0.0~1.0)

불변 조건:
  - location_tag은 빈 문자열 불가
  - object_tags는 최소 1개, 최대 10개
  - confidence는 0.0 이상 1.0 이하
```

#### MaskingResult (마스킹 처리 결과)

```
필드:
  - masked_text: str           # 식별자 치환 완료된 텍스트
  - entity_map: dict[str, str] # 원본→치환 매핑 (예: {"홍길동": "Family_M1"})
  - entity_count: int          # 치환된 식별자 수

불변 조건:
  - masked_text는 빈 문자열 불가
  - entity_map은 외부(Gemini API 포함)로 절대 전송 금지
  - masked_text 내에 entity_map의 원본 값이 잔존하면 안 됨 (누설 방지)

entity_map 네이밍 규칙:
  - 사람 이름: Family_M1, Family_F1, Family_M2 (성별 + 순번)
  - 장소명: Place_1, Place_2
  - 날짜: Date_1, Date_2
```

#### ScenarioResult (훈련 시나리오)

```
필드:
  - opening_question: str      # 훈련 시작 첫 질문 (TTS로 재생)
  - context_summary: str       # RAG 검색 인덱스용 요약 텍스트
  - guardrail_words: list[str] # 대화 중 언급 금지 단어 목록
  - scene_description: str     # 시나리오 배경 설명

불변 조건:
  - opening_question에 guardrail_words 포함 불가
  - context_summary 길이: 100~500자
  - guardrail_words는 target_words와 동일 집합
```

#### ChatMessage (대화 메시지)

```
필드:
  - role: Literal["ai", "patient"]
  - content: str
  - hint_triggered: bool       # 힌트 삽입 여부
  - hint_level: int            # 적용된 힌트 레벨 (0, 1, 2)

불변 조건:
  - content는 빈 문자열 불가
  - hint_level은 0, 1, 2 중 하나
  - guardrail_words가 content에 포함되면 FallbackError 발생
```

### 2-2. 유스케이스 (Use Case) 정의

#### UC-1: TagImage (이미지 자동 태깅)

```
유스케이스명: TagImage
Actor       : NestJS 백엔드 (보호자 사진 업로드 후 자동 호출)
사전 조건   : 이미지 파일(JPEG/PNG)이 Base64 인코딩되어 전달됨
             이미지 크기 5MB 이하

정상 흐름   :
  1. 입력 이미지를 Base64에서 바이트로 디코딩
  2. Gemini Vision API에 이미지 + 태깅 프롬프트 전송
  3. 응답 JSON 파싱 → TagResult 생성
  4. TagResult 반환

예외 흐름   :
  - 이미지 디코딩 실패 → ImageDecodeError
  - Gemini API 호출 실패 → GeminiApiError
  - 응답 파싱 실패 → TagParseError (빈 태그로 Fallback)
  - 이미지 크기 초과 → ImageSizeError

사후 조건   : location_tag, object_tags가 한국어로 채워진 TagResult 반환
```

#### UC-2: MaskText (텍스트 PII 마스킹)

```
유스케이스명: MaskText
Actor       : NestJS 백엔드 (TagImage 완료 후 호출)
사전 조건   : 태깅 결과와 보호자가 입력한 에피소드 텍스트가 전달됨

정상 흐름   :
  1. 정규식으로 1차 패턴 매칭 (전화번호, 주민등록번호, 이메일)
  2. Gemini에게 나머지 식별자(이름, 장소명) 감지 요청
  3. entity_map 구성 (원본 → 익명 식별자)
  4. masked_text 생성 (원본 텍스트에서 치환)
  5. MaskingResult 반환 (entity_map은 내부 보관, 외부 미전달)

예외 흐름   :
  - 입력 텍스트 길이 초과 (5000자 이상) → TextTooLongError
  - Gemini API 실패 → 정규식 결과만으로 부분 마스킹 후 반환
  - 마스킹 후 원본 잔존 감지 → ResidualPiiError

사후 조건   : entity_map의 원본 값이 masked_text에 단 하나도 남지 않음
```

#### UC-3: GenerateScenario (훈련 시나리오 생성)

```
유스케이스명: GenerateScenario
Actor       : NestJS 백엔드 (보호자가 목표 단어 지정 후 트리거)
사전 조건   : masked_context, target_words(1~3개), emotion_tag가 전달됨

정상 흐름   :
  1. guardrail_words = target_words 복사
  2. 시나리오 생성 프롬프트 구성 ({GUARDRAIL_WORDS} 플레이스홀더 삽입)
  3. Gemini 1.5 Pro 호출
  4. 응답에서 guardrail_words 누설 여부 검증
  5. 누설 없으면 ScenarioResult 반환
  6. 누설 감지 시 Fallback 프롬프트로 재호출 (최대 2회)

예외 흐름   :
  - Guardrail 2회 위반 → ScenarioGuardrailError (Fallback 시나리오 사용)
  - Gemini API 실패 → GeminiApiError
  - target_words 비어있음 → EmptyTargetWordsError

사후 조건   :
  - opening_question에 guardrail_words 단 하나도 포함 안 됨
  - context_summary가 RAG 인덱싱에 적합한 길이(100~500자)
```

#### UC-4: ChatWithAgent (RAG 대화 에이전트)

```
유스케이스명: ChatWithAgent
Actor       : NestJS 백엔드 (환자 발화 STT 결과 전달)
사전 조건   :
  - session_id가 유효한 훈련 세션 ID
  - scenario (ScenarioResult)가 초기화되어 있음
  - hint_level이 0, 1, 2 중 하나

정상 흐름   :
  1. session_id로 LangGraph 체크포인터에서 Window Buffer 조회 (최대 10턴)
  2. hint_level에 따라 시스템 프롬프트 조정
     - 0: 일반 대화 프롬프트
     - 1: 첫 음절 힌트 삽입 ("아.." 형식)
     - 2: 양자택일 폐쇄형 질문 프롬프트
  3. RAG 검색: 관련 context_summary 벡터 검색
  4. Gemini 1.5 Pro 호출
  5. 응답에서 guardrail_words 누설 검증
  6. ChatMessage 반환

예외 흐름   :
  - guardrail_words 누설 감지 → GuardrailViolationError → Fallback 응답 생성
  - session_id 없음 → SessionNotFoundError
  - Gemini API 실패 → GeminiApiError
  - 힌트 레벨 범위 초과 → InvalidHintLevelError

사후 조건   :
  - Window Buffer에 이번 턴 대화 추가 (11번째 턴은 가장 오래된 것 제거)
  - 응답 content에 guardrail_words 없음
```

### 2-3. 레포지토리 / 서비스 인터페이스 정의

```python
# ai-service/interfaces/llm_client.py
from abc import ABC, abstractmethod
from typing import Any

class ILlmClient(ABC):
    """Gemini API 통신 추상 인터페이스"""

    @abstractmethod
    async def complete(self, messages: list[dict], model: str, **kwargs) -> str:
        """동기형 단일 응답 생성"""
        ...

    @abstractmethod
    async def complete_with_vision(
        self, text_prompt: str, image_base64: str, model: str
    ) -> str:
        """Vision 모달리티 포함 응답 생성"""
        ...


# ai-service/interfaces/vector_store.py
class IVectorStore(ABC):
    """벡터 검색 추상 인터페이스 (RAG용)"""

    @abstractmethod
    async def upsert(self, doc_id: str, text: str, metadata: dict) -> None:
        """문서 임베딩 후 저장"""
        ...

    @abstractmethod
    async def search(self, query: str, top_k: int = 3) -> list[dict]:
        """유사도 검색, metadata 포함 반환"""
        ...

    @abstractmethod
    async def delete(self, doc_id: str) -> None:
        """문서 삭제"""
        ...


# ai-service/interfaces/masking_store.py
class IMaskingStore(ABC):
    """entity_map 임시 보관 추상 인터페이스 (메모리 또는 Redis)"""

    @abstractmethod
    async def save(self, session_id: str, entity_map: dict[str, str]) -> None:
        ...

    @abstractmethod
    async def get(self, session_id: str) -> dict[str, str] | None:
        ...

    @abstractmethod
    async def delete(self, session_id: str) -> None:
        ...
```

---

## Phase 3: 레이어별 설계

### 아키텍처 매핑

FastAPI 프로젝트에서 클린 아키텍처를 다음과 같이 매핑한다.

```
┌─────────────────────────────────────────────────────────────────┐
│  Presentation Layer  routers/tagging.py, masking.py, ...       │
│  (FastAPI Router)    요청/응답 Pydantic 모델 변환, HTTP 응답 코드│
├─────────────────────────────────────────────────────────────────┤
│  Application Layer   services/tagging_service.py, ...          │
│  (Service Classes)   유스케이스 조율, 에러 처리, DTO 변환        │
├─────────────────────────────────────────────────────────────────┤
│  Domain Layer        domain/entities.py, interfaces/           │
│  (Entities + ABC)    값 객체 정의, 서비스 인터페이스(ABC)        │
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure Layer  infra/gemini_client.py, rag_service.py  │
│  (Impl Classes)      Gemini API, LangGraph, 인메모리 벡터스토어 │
└─────────────────────────────────────────────────────────────────┘
                     의존성 방향: 위 → 아래 (단방향)
```

### 3-1. 도메인 레이어 설계

**파일: `ai-service/domain/entities.py`**

외부 의존성 0개. Pydantic BaseModel 사용 (순수 데이터 계약).

```python
from pydantic import BaseModel, field_validator
from typing import Literal

class TagResult(BaseModel):
    location_tag: str
    object_tags: list[str]
    confidence: float

    @field_validator("object_tags")
    @classmethod
    def validate_tags(cls, v):
        if not (1 <= len(v) <= 10):
            raise ValueError("object_tags는 1~10개 사이여야 합니다")
        return v

class MaskingResult(BaseModel):
    masked_text: str
    entity_count: int
    # entity_map은 절대 응답에 포함하지 않음 (서비스 내부 전용)

class ScenarioResult(BaseModel):
    opening_question: str
    context_summary: str
    guardrail_words: list[str]
    scene_description: str

class ChatMessage(BaseModel):
    role: Literal["ai", "patient"]
    content: str
    hint_triggered: bool = False
    hint_level: int = 0
```

**파일: `ai-service/domain/errors.py`**

도메인 에러 계층 정의. 모든 에러는 이 파일에서 상속.

```python
class AiServiceError(Exception):
    """AI 서비스 최상위 에러"""
    pass

class ImageDecodeError(AiServiceError): pass
class ImageSizeError(AiServiceError): pass
class TagParseError(AiServiceError): pass
class TextTooLongError(AiServiceError): pass
class ResidualPiiError(AiServiceError): pass
class EmptyTargetWordsError(AiServiceError): pass
class ScenarioGuardrailError(AiServiceError): pass
class GuardrailViolationError(AiServiceError): pass
class SessionNotFoundError(AiServiceError): pass
class InvalidHintLevelError(AiServiceError): pass
class GeminiApiError(AiServiceError): pass
```

**파일: `ai-service/interfaces/llm_client.py`** (ABC 인터페이스, 위 2-3 명세 참조)
**파일: `ai-service/interfaces/vector_store.py`** (ABC 인터페이스, 위 2-3 명세 참조)
**파일: `ai-service/interfaces/masking_store.py`** (ABC 인터페이스, 위 2-3 명세 참조)

### 3-2. 애플리케이션 레이어 설계

각 서비스 클래스는 인터페이스(ABC)만 의존하며, 구현체는 생성자 주입으로 전달받는다.

**파일: `ai-service/services/tagging_service.py`**

```python
class TaggingService:
    def __init__(self, llm_client: ILlmClient):
        self._llm = llm_client

    async def tag_image(self, image_base64: str) -> TagResult:
        """
        1. Base64 디코딩 유효성 검증
        2. Gemini Vision 호출 (태깅 프롬프트)
        3. 응답 JSON → TagResult 파싱
        4. 파싱 실패 시 TagParseError 발생 (빈 Fallback 불가 - 재시도 요구)
        """
```

**파일: `ai-service/services/masking_service.py`**

```python
class MaskingService:
    def __init__(self, llm_client: ILlmClient, masking_store: IMaskingStore):
        self._llm = llm_client
        self._store = masking_store

    async def mask_text(self, raw_text: str, memory_entry_id: str) -> MaskingResult:
        """
        1. 텍스트 길이 검증 (5000자 이하)
        2. 정규식 1차 마스킹 (전화번호, 주민번호, 이메일)
        3. Gemini 2차 마스킹 (이름, 장소명)
        4. entity_map 구성 및 IMaskingStore에 저장 (memory_entry_id 키)
        5. 마스킹 후 잔존 PII 검증
        6. MaskingResult 반환 (entity_map 비포함)
        """

    def _build_entity_map(self, entities: list[dict]) -> dict[str, str]:
        """성별/타입별 순번 부여하여 익명 식별자 생성"""
```

**파일: `ai-service/services/scenario_service.py`**

```python
class ScenarioService:
    def __init__(self, llm_client: ILlmClient, vector_store: IVectorStore):
        self._llm = llm_client
        self._store = vector_store

    async def generate_scenario(
        self,
        masked_context: str,
        target_words: list[str],
        emotion_tag: str,
        memory_entry_id: str,
    ) -> ScenarioResult:
        """
        1. target_words 유효성 검증 (비어있으면 EmptyTargetWordsError)
        2. guardrail_words = target_words
        3. 시나리오 생성 프롬프트 구성 ({GUARDRAIL_WORDS} 플레이스홀더)
        4. Gemini 호출 → Guardrail 검증 (최대 2회 재시도)
        5. ScenarioResult 반환
        6. context_summary를 IVectorStore에 upsert (memory_entry_id 키)
        """

    def _check_guardrail(self, text: str, guardrail_words: list[str]) -> bool:
        """text에 guardrail_words 중 하나라도 포함되면 True 반환"""
```

**파일: `ai-service/services/chat_service.py`**

```python
class ChatService:
    def __init__(self, llm_client: ILlmClient, vector_store: IVectorStore):
        self._llm = llm_client
        self._store = vector_store
        # LangGraph checkpointer: session_id → Window Buffer (10턴)
        self._memory: dict[str, list[ChatMessage]] = {}

    async def chat(
        self,
        session_id: str,
        user_message: str,
        hint_level: int,
        scenario: ScenarioResult,
    ) -> ChatMessage:
        """
        1. session_id 유효성 검증
        2. hint_level 범위 검증 (0~2)
        3. Window Buffer 조회 (최대 10턴)
        4. hint_level에 따른 시스템 프롬프트 분기
        5. RAG 검색 (context_summary 기반)
        6. Gemini 호출
        7. Guardrail 검증 (위반 시 Fallback 응답)
        8. Window Buffer 업데이트 (11번째 이상 제거)
        9. ChatMessage 반환
        """

    def _build_system_prompt(
        self, hint_level: int, scenario: ScenarioResult, rag_context: str
    ) -> str:
        """힌트 레벨별 시스템 프롬프트 생성"""
```

### 3-3. 인프라스트럭처 레이어 설계

**파일: `ai-service/infra/gemini_client.py`**

ILlmClient를 구현. google-generativeai SDK 직접 사용.

```python
class GeminiClient(ILlmClient):
    """
    구현 대상: google.generativeai.AsyncClient
    교체 가능성:
      - OpenAI GPT-4o로 교체 시 이 파일만 수정
      - langchain_google_genai 래퍼로 교체 가능
    """
    def __init__(self, api_key: str, default_model: str = "gemini-1.5-pro"):
        self._client = google.generativeai.AsyncClient(api_key=api_key)
        self._default_model = default_model

    async def complete(self, messages: list[dict], model: str, **kwargs) -> str: ...
    async def complete_with_vision(
        self, text_prompt: str, image_base64: str, model: str
    ) -> str: ...
```

**파일: `ai-service/infra/in_memory_vector_store.py`**

IVectorStore를 구현. MVP 단계 인메모리 구현. Phase 2에서 pgvector/Chroma로 교체.

```python
class InMemoryVectorStore(IVectorStore):
    """
    MVP 단계: numpy cosine similarity 기반 인메모리 구현
    교체 가능성:
      - pgvector 교체 시 이 파일만 수정 (PostgreSQL pgvector 익스텐션)
      - Chroma/Qdrant 교체 시 어댑터 파일 하나 추가
    주의: 서버 재시작 시 벡터 데이터 소멸 → 재생성 필요
    """
    async def upsert(self, doc_id: str, text: str, metadata: dict) -> None: ...
    async def search(self, query: str, top_k: int = 3) -> list[dict]: ...
    async def delete(self, doc_id: str) -> None: ...
```

**파일: `ai-service/infra/in_memory_masking_store.py`**

IMaskingStore를 구현. entity_map을 프로세스 메모리에 저장.

```python
class InMemoryMaskingStore(IMaskingStore):
    """
    MVP 단계: dict 기반 인메모리 저장
    교체 가능성:
      - Redis 교체 시 RedisMaskingStore 파일 추가 후 의존성 교체
    주의: 서버 재시작 시 소멸 → 마스킹 재처리 필요
    """
```

### 3-4. 프레젠테이션 레이어 설계 (FastAPI Router)

**파일: `ai-service/routers/tagging.py`**

```python
router = APIRouter(prefix="/tag", tags=["tagging"])

@router.post("", response_model=TagResponse)
async def tag_image(
    body: TagRequest,
    service: TaggingService = Depends(get_tagging_service),
):
    """이미지 Base64 수신 → TagResult 반환"""
```

**파일: `ai-service/routers/masking.py`**

```python
router = APIRouter(prefix="/mask", tags=["masking"])

@router.post("", response_model=MaskResponse)
async def mask_text(
    body: MaskRequest,
    service: MaskingService = Depends(get_masking_service),
):
    """원본 텍스트 수신 → MaskingResult 반환 (entity_map 제외)"""
```

**파일: `ai-service/routers/scenario.py`**

```python
router = APIRouter(prefix="/scenario", tags=["scenario"])

@router.post("", response_model=ScenarioResponse)
async def generate_scenario(
    body: ScenarioRequest,
    service: ScenarioService = Depends(get_scenario_service),
):
    """masked_context + target_words → ScenarioResult 반환"""
```

**파일: `ai-service/routers/chat.py`**

```python
router = APIRouter(prefix="/chat", tags=["chat"])

@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    service: ChatService = Depends(get_chat_service),
):
    """session_id + user_message + hint_level → ChatMessage 반환"""
```

---

## Phase 4: 의존성 그래프 및 인터페이스 명세

### 4-1. 의존성 다이어그램

```
FastAPI Router (routers/)
  ├── tagging.py
  │     └── TaggingService (services/)
  │           └── ILlmClient (interfaces/) ←←← GeminiClient (infra/)
  │
  ├── masking.py
  │     └── MaskingService (services/)
  │           ├── ILlmClient (interfaces/) ←←← GeminiClient (infra/)
  │           └── IMaskingStore (interfaces/) ←←← InMemoryMaskingStore (infra/)
  │
  ├── scenario.py
  │     └── ScenarioService (services/)
  │           ├── ILlmClient (interfaces/) ←←← GeminiClient (infra/)
  │           └── IVectorStore (interfaces/) ←←← InMemoryVectorStore (infra/)
  │
  └── chat.py
        └── ChatService (services/)
              ├── ILlmClient (interfaces/) ←←← GeminiClient (infra/)
              └── IVectorStore (interfaces/) ←←← InMemoryVectorStore (infra/)

의존성 팩토리 (main.py 또는 dependencies.py)
  GeminiClient (싱글턴)
  InMemoryVectorStore (싱글턴)
  InMemoryMaskingStore (싱글턴)
  → 각 Service에 주입
```

### 4-2. Pydantic 요청/응답 모델 (models/ 디렉토리)

**파일: `ai-service/models/tagging.py`**

```python
class TagRequest(BaseModel):
    image_base64: str           # Base64 인코딩된 이미지
    memory_entry_id: str        # UUID

class TagResponse(BaseModel):
    memory_entry_id: str
    location_tag: str
    object_tags: list[str]
    confidence: float
```

**파일: `ai-service/models/masking.py`**

```python
class MaskRequest(BaseModel):
    raw_text: str               # 원본 텍스트 (보호자 입력 에피소드)
    memory_entry_id: str        # entity_map 저장 키로 사용

class MaskResponse(BaseModel):
    memory_entry_id: str
    masked_text: str
    entity_count: int
    # entity_map 절대 포함 금지
```

**파일: `ai-service/models/scenario.py`**

```python
class ScenarioRequest(BaseModel):
    masked_context: str
    target_words: list[str]     # 1~3개
    emotion_tag: str            # happy | calm | nostalgic | excited
    memory_entry_id: str

class ScenarioResponse(BaseModel):
    memory_entry_id: str
    opening_question: str
    context_summary: str
    scene_description: str
    # guardrail_words는 응답에서 제외 (보안)
```

**파일: `ai-service/models/chat.py`**

```python
class ChatRequest(BaseModel):
    session_id: str
    user_message: str
    hint_level: int             # 0 | 1 | 2
    memory_entry_id: str        # RAG 검색 범위 한정

class ChatResponse(BaseModel):
    session_id: str
    ai_message: str
    hint_triggered: bool
    hint_level: int
```

### 4-3. 프롬프트 상수 정의

**파일: `ai-service/prompts/tagging_prompt.py`**

```python
TAGGING_SYSTEM_PROMPT = """
당신은 이미지 분석 전문가입니다.
이미지를 보고 다음 JSON 형식으로만 응답하세요:
{
  "location_tag": "장소를 한국어로 (예: 거실, 공원, 식당)",
  "object_tags": ["사물1", "사물2", ...],
  "confidence": 0.0~1.0
}
응답은 반드시 JSON만 포함하세요. 추가 설명 금지.
"""
```

**파일: `ai-service/prompts/masking_prompt.py`**

```python
MASKING_SYSTEM_PROMPT = """
당신은 개인정보 보호 전문가입니다.
텍스트에서 개인 식별 정보(이름, 구체적 장소명)를 찾아 JSON으로 반환하세요:
{
  "entities": [
    {"original": "홍길동", "type": "person", "gender": "M"},
    {"original": "강남구 역삼동", "type": "place"}
  ]
}
전화번호, 주민번호, 이메일은 이미 처리됩니다.
"""
```

**파일: `ai-service/prompts/scenario_prompt.py`**

```python
SCENARIO_SYSTEM_PROMPT = """
당신은 인지 재활 훈련 전문 치료사입니다.
아래 조건에 따라 훈련 시나리오를 생성하세요.

[중요 규칙]
다음 단어들을 시나리오에서 절대 직접 언급하지 마세요: {GUARDRAIL_WORDS}
이 단어들은 환자가 스스로 떠올려야 하는 목표 단어입니다.

[출력 형식]
{
  "opening_question": "훈련 시작 질문",
  "context_summary": "시나리오 배경 요약 (100~500자)",
  "scene_description": "시나리오 배경 설명"
}
"""

SCENARIO_FALLBACK_PROMPT = """
이전 응답에서 금지된 단어가 포함되었습니다.
목표 단어를 전혀 언급하지 않고 배경 상황만 묘사하는 질문을 새로 생성하세요.
목표 단어: {GUARDRAIL_WORDS}
"""
```

**파일: `ai-service/prompts/chat_prompt.py`**

```python
CHAT_SYSTEM_PROMPT_LEVEL_0 = """
당신은 따뜻한 인지 재활 훈련 도우미입니다.
다음 시나리오 상황에서 환자와 자연스럽게 대화하세요.

[시나리오]
{SCENE_DESCRIPTION}

[관련 기억 컨텍스트]
{RAG_CONTEXT}

[절대 금지]
다음 단어들을 직접 언급하지 마세요: {GUARDRAIL_WORDS}
"""

CHAT_SYSTEM_PROMPT_LEVEL_1 = CHAT_SYSTEM_PROMPT_LEVEL_0 + """

[힌트 지시]
환자가 답변을 어려워합니다.
답변 단어의 첫 음절을 "혹시 'ㅇ...' 으로 시작하는 걸까요?" 형식으로 자연스럽게 유도하세요.
"""

CHAT_SYSTEM_PROMPT_LEVEL_2 = CHAT_SYSTEM_PROMPT_LEVEL_0 + """

[힌트 지시]
환자가 계속 어려워합니다.
"A인가요, B인가요?" 형식의 양자택일 폐쇄형 질문으로 전환하세요.
"""

GUARDRAIL_FALLBACK_RESPONSE = "잠깐, 그 기억에 대해 조금 더 이야기해 볼까요? 그 날 기분이 어땠나요?"
```

---

## Phase 5: 테스트 전략

### 5-1. 단위 테스트 - 도메인 / 애플리케이션 레이어

**파일: `ai-service/tests/test_tagging_service.py`**

```
[TC-1] TaggingService - 정상 태깅
  Given: 유효한 Base64 이미지와 ILlmClient Mock이 주어졌을 때
         (Mock은 {"location_tag": "거실", "object_tags": ["소파"], "confidence": 0.9} 반환)
  When:  tag_image(image_base64) 호출
  Then:  TagResult.location_tag == "거실"
         TagResult.object_tags == ["소파"]
         ILlmClient.complete_with_vision이 정확히 1회 호출됨

[TC-2] TaggingService - Gemini 응답 파싱 실패
  Given: ILlmClient Mock이 유효하지 않은 JSON 문자열을 반환
  When:  tag_image(image_base64) 호출
  Then:  TagParseError 발생

[TC-3] TaggingService - 이미지 크기 초과
  Given: 5MB를 초과하는 Base64 문자열이 주어졌을 때
  When:  tag_image(image_base64) 호출
  Then:  ImageSizeError 발생
```

**파일: `ai-service/tests/test_masking_service.py`**

```
[TC-4] MaskingService - 이름 마스킹 정상
  Given: "홍길동이 역삼동 카페에서 커피를 마셨다" 텍스트와
         ILlmClient Mock이 entities=[{original:"홍길동", type:"person", gender:"M"},
         {original:"역삼동 카페", type:"place"}] 반환
  When:  mask_text(raw_text, memory_entry_id) 호출
  Then:  masked_text에 "홍길동", "역삼동" 미포함
         entity_count == 2
         IMaskingStore.save가 정확히 1회 호출됨

[TC-5] MaskingService - 마스킹 후 PII 잔존
  Given: 마스킹 서비스의 치환 로직 버그로 원본이 잔존하도록 Mock 설정
  When:  mask_text 호출
  Then:  ResidualPiiError 발생

[TC-6] MaskingService - 텍스트 길이 초과
  Given: 5001자 이상의 raw_text
  When:  mask_text 호출
  Then:  TextTooLongError 발생

[TC-7] MaskingService - entity_map 응답 비포함 검증
  Given: 정상 마스킹 완료
  When:  mask_text 호출 결과
  Then:  반환된 MaskingResult에 entity_map 필드 없음
```

**파일: `ai-service/tests/test_scenario_service.py`**

```
[TC-8] ScenarioService - Guardrail 정상 통과
  Given: masked_context, target_words=["사과"], emotion_tag="happy",
         ILlmClient Mock이 "사과"를 포함하지 않는 시나리오 반환
  When:  generate_scenario 호출
  Then:  ScenarioResult.opening_question에 "사과" 미포함
         IVectorStore.upsert가 정확히 1회 호출됨

[TC-9] ScenarioService - Guardrail 1차 위반 후 2차 성공
  Given: ILlmClient Mock이 1번째 호출 시 guardrail_words 포함 응답,
         2번째 호출 시 정상 응답 반환
  When:  generate_scenario 호출
  Then:  ScenarioResult 정상 반환
         ILlmClient.complete가 정확히 2회 호출됨

[TC-10] ScenarioService - Guardrail 2회 연속 위반
  Given: ILlmClient Mock이 2회 모두 guardrail_words 포함 응답 반환
  When:  generate_scenario 호출
  Then:  ScenarioGuardrailError 발생

[TC-11] ScenarioService - target_words 빈 배열
  Given: target_words=[]
  When:  generate_scenario 호출
  Then:  EmptyTargetWordsError 발생
```

**파일: `ai-service/tests/test_chat_service.py`**

```
[TC-12] ChatService - hint_level=0 일반 대화
  Given: 유효한 session_id, hint_level=0, ScenarioResult Mock,
         ILlmClient가 Guardrail 미위반 응답 반환
  When:  chat(session_id, user_message, hint_level, scenario) 호출
  Then:  ChatMessage.hint_triggered == False
         ChatMessage.hint_level == 0
         Window Buffer에 1턴 추가됨

[TC-13] ChatService - hint_level=2 양자택일 프롬프트 적용
  Given: hint_level=2
  When:  chat 호출
  Then:  사용된 시스템 프롬프트에 CHAT_SYSTEM_PROMPT_LEVEL_2 내용 포함
         ChatMessage.hint_level == 2

[TC-14] ChatService - Window Buffer 10턴 초과 시 순환
  Given: 기존 Window Buffer에 10턴 존재
  When:  11번째 chat 호출
  Then:  Window Buffer 크기 == 10 (가장 오래된 1턴 제거됨)

[TC-15] ChatService - Guardrail 위반 Fallback
  Given: ILlmClient가 guardrail_words 포함 응답 반환
  When:  chat 호출
  Then:  반환된 ChatMessage.content == GUARDRAIL_FALLBACK_RESPONSE
         GuardrailViolationError가 로그에 기록됨 (예외 전파 안 함)

[TC-16] ChatService - 유효하지 않은 hint_level
  Given: hint_level=3
  When:  chat 호출
  Then:  InvalidHintLevelError 발생
```

### 5-2. 인테그레이션 테스트 - 인프라스트럭처 레이어

**파일: `ai-service/tests/integration/test_gemini_client.py`**

```
[IT-1] GeminiClient - 실제 API 호출 (GEMINI_API_KEY 필요)
  Given: 유효한 API Key, 간단한 메시지
  When:  complete(messages=[{"role": "user", "content": "안녕"}]) 호출
  Then:  응답 str 반환, 길이 > 0
         (CI 환경에서는 SKIP 마커 적용)

[IT-2] InMemoryVectorStore - upsert 후 search
  Given: 3개의 문서를 upsert
  When:  관련 쿼리로 search(top_k=2) 호출
  Then:  2개 결과 반환, 가장 관련성 높은 문서가 1순위
```

### 5-3. E2E 테스트 - FastAPI 엔드포인트

**파일: `ai-service/tests/e2e/test_endpoints.py`**

```
[E2E-1] POST /tag - 이미지 태깅 성공
  Given: TestClient, 유효한 TagRequest Body (Mock GeminiClient 주입)
  When:  POST /tag 요청
  Then:  HTTP 200, response.location_tag != "", response.object_tags 길이 >= 1

[E2E-2] POST /mask - 마스킹 성공
  Given: TestClient, MaskRequest Body
  When:  POST /mask 요청
  Then:  HTTP 200, response.masked_text에 entity_map 원본 미포함
         response에 entity_map 필드 없음

[E2E-3] POST /scenario - 시나리오 생성 성공
  Given: TestClient, ScenarioRequest Body
  When:  POST /scenario 요청
  Then:  HTTP 200, response.opening_question != ""

[E2E-4] POST /chat - 대화 응답 성공
  Given: TestClient, ChatRequest Body (hint_level=0)
  When:  POST /chat 요청
  Then:  HTTP 200, response.ai_message != ""

[E2E-5] POST /tag - 이미지 크기 초과 에러
  Given: 5MB 초과 이미지
  When:  POST /tag 요청
  Then:  HTTP 422, error detail에 "이미지 크기" 포함
```

### 5-4. 테스트 더블 전략

| 대상              | 전략   | 이유                                         |
| ----------------- | ------ | -------------------------------------------- |
| Gemini API        | Mock   | 외부 API 비용 절감, 응답 결정론적 제어 필요  |
| IVectorStore      | Fake   | InMemoryVectorStore 자체가 Fake로 활용 가능  |
| IMaskingStore     | Fake   | InMemoryMaskingStore 자체가 Fake로 활용 가능 |
| LangGraph 체크포인터 | Stub | 고정된 Window Buffer 반환으로 테스트 격리    |

---

## Phase 6: 위험 요소 및 기술 부채 분석

### 6-1. 기술적 위험 요소

| 위험 요소                         | 발생 가능성 | 영향도 | 대응 방안                                                                    |
| --------------------------------- | :---------: | :----: | ---------------------------------------------------------------------------- |
| Guardrail 우회 (Gemini 할루시네이션) | 보통        | 높음   | 정규식 사후 검증 + 2회 재시도 + GUARDRAIL_FALLBACK_RESPONSE 적용            |
| entity_map 외부 누설               | 낮음        | 높음   | MaskResponse 모델에 entity_map 필드 미포함 + 응답 직렬화 검증 테스트        |
| InMemoryVectorStore 서버 재시작 소멸 | 높음        | 보통   | 시나리오 생성 시 IVectorStore 항상 upsert → 재시작 후 /scenario 재호출로 복구 |
| Gemini API 레이턴시 (2~5초)        | 높음        | 보통   | 시나리오는 업로드 시 비동기 생성, 대화는 SSE 스트리밍 응답 (Phase 2)         |
| google-generativeai SDK 미설치     | 높음        | 높음   | requirements.txt에 google-generativeai 추가 필수 (현재 openai만 존재)        |
| LangGraph 메모리 누수              | 보통        | 보통   | 세션 완료(`/complete`) 시 Window Buffer 명시적 삭제 처리                     |
| 한국어 마스킹 정확도               | 보통        | 높음   | Gemini 마스킹 전 confidence 확인, 낮으면 수동 확인 요청 플래그 반환          |

### 6-2. SOLID 원칙 준수 점검

**S - 단일 책임 원칙**
- TaggingService: 이미지 태깅만 담당. Guardrail 로직은 별도 `GuardrailChecker` 유틸로 분리.
- MaskingService: 마스킹 처리만 담당. entity_map 저장은 IMaskingStore에 위임.
- ChatService: 대화 흐름 조율만 담당. 프롬프트 구성은 `prompts/` 상수 파일에 분리.
- 준수: 각 서비스 클래스는 1개의 책임 보유.

**O - 개방-폐쇄 원칙**
- 새로운 힌트 레벨(hint_level=3) 추가: `prompts/chat_prompt.py`에 상수 추가 + ChatService의 분기 1줄 추가. 기존 레벨 0~2 코드 수정 불필요.
- 새로운 감정 태그 추가: ScenarioRequest 유효성 검증 Enum 수정만 필요.
- 준수: 확장에 열려있고, 기존 로직 수정 최소화.

**L - 리스코프 치환 원칙**
- ILlmClient: GeminiClient를 MockLlmClient로 교체 시 동일 인터페이스 준수.
- IVectorStore: InMemoryVectorStore를 PgVectorStore로 교체 시 동일 메서드 시그니처.
- 준수: 모든 구현체가 ABC 계약을 완전히 이행.

**I - 인터페이스 분리 원칙**
- ILlmClient: `complete`와 `complete_with_vision` 2개 메서드만 보유. 불필요한 메서드 없음.
- IVectorStore: `upsert`, `search`, `delete` 3개만 보유.
- IMaskingStore: `save`, `get`, `delete` 3개만 보유.
- 준수: 각 인터페이스가 최소 필요 메서드만 포함.

**D - 의존성 역전 원칙**
- ScenarioService, ChatService, MaskingService 모두 ABC(인터페이스)에 의존.
- 구현체(GeminiClient, InMemoryVectorStore)는 `dependencies.py`에서 생성 후 주입.
- 준수: 고수준 모듈이 저수준 구현에 직접 의존하지 않음.

### 6-3. 확장성 시나리오 검토

**"Gemini API를 GPT-4o로 교체한다면?"**
- `ai-service/infra/gemini_client.py` 대신 `openai_client.py` 신규 작성 (ILlmClient 계약 준수)
- `dependencies.py`에서 주입 대상만 교체 (1줄 수정)
- 모든 Service 클래스 수정 불필요 (ILlmClient 계약만 준수)
- 평가: 수용 가능, 영향 범위 최소

**"인메모리 벡터 스토어를 pgvector로 교체한다면?"**
- `ai-service/infra/pg_vector_store.py` 신규 작성 (IVectorStore 구현)
- `dependencies.py` 주입 대상 교체
- DB 마이그레이션 스크립트 1개 추가
- 평가: 수용 가능, 서비스 로직 무수정

**"힌트 레벨을 3단계에서 5단계로 확장한다면?"**
- `prompts/chat_prompt.py`에 LEVEL_3, LEVEL_4 상수 추가
- `ChatService._build_system_prompt` 분기 추가 (2줄)
- `ChatRequest` Pydantic 검증 범위 수정 (0~4)
- 평가: 수용 가능, 변경 범위 명확

**"마스킹 entity_map을 세션 간 공유해야 한다면 (Redis 도입)?"**
- `ai-service/infra/redis_masking_store.py` 신규 작성
- `dependencies.py` 주입 대상만 교체
- MaskingService 코드 무수정
- 평가: 수용 가능, 완벽한 교체 가능성

---

## Phase 7: 파일 구조 및 구현 체크리스트

### 최종 디렉토리 구조

```
ai-service/
├── main.py                             [MODIFY] - 라우터 4개 등록
├── requirements.txt                    [MODIFY] - google-generativeai, numpy 추가
├── dependencies.py                     [NEW]    - 의존성 팩토리 (싱글턴 관리)
├── domain/
│   ├── __init__.py                     [NEW]
│   └── entities.py                     [NEW]    - TagResult, MaskingResult, ScenarioResult, ChatMessage
├── domain/
│   └── errors.py                       [NEW]    - AiServiceError 계층 정의
├── interfaces/
│   ├── __init__.py                     [NEW]
│   ├── llm_client.py                   [NEW]    - ILlmClient ABC
│   ├── vector_store.py                 [NEW]    - IVectorStore ABC
│   └── masking_store.py                [NEW]    - IMaskingStore ABC
├── services/
│   ├── __init__.py                     [NEW]
│   ├── tagging_service.py              [NEW]    - TaggingService
│   ├── masking_service.py              [NEW]    - MaskingService
│   ├── scenario_service.py             [NEW]    - ScenarioService
│   └── chat_service.py                 [NEW]    - ChatService
├── infra/
│   ├── __init__.py                     [NEW]
│   ├── gemini_client.py                [NEW]    - GeminiClient (ILlmClient 구현)
│   ├── in_memory_vector_store.py       [NEW]    - InMemoryVectorStore (IVectorStore 구현)
│   └── in_memory_masking_store.py      [NEW]    - InMemoryMaskingStore (IMaskingStore 구현)
├── models/
│   ├── __init__.py                     [NEW]
│   ├── tagging.py                      [NEW]    - TagRequest, TagResponse
│   ├── masking.py                      [NEW]    - MaskRequest, MaskResponse
│   ├── scenario.py                     [NEW]    - ScenarioRequest, ScenarioResponse
│   └── chat.py                         [NEW]    - ChatRequest, ChatResponse
├── routers/
│   ├── __init__.py                     [NEW]
│   ├── tagging.py                      [NEW]    - POST /tag
│   ├── masking.py                      [NEW]    - POST /mask
│   ├── scenario.py                     [NEW]    - POST /scenario
│   └── chat.py                         [NEW]    - POST /chat
├── prompts/
│   ├── __init__.py                     [NEW]
│   ├── tagging_prompt.py               [NEW]    - TAGGING_SYSTEM_PROMPT
│   ├── masking_prompt.py               [NEW]    - MASKING_SYSTEM_PROMPT
│   ├── scenario_prompt.py              [NEW]    - SCENARIO_SYSTEM_PROMPT, SCENARIO_FALLBACK_PROMPT
│   └── chat_prompt.py                  [NEW]    - CHAT_SYSTEM_PROMPT_LEVEL_0~2, GUARDRAIL_FALLBACK_RESPONSE
└── tests/
    ├── __init__.py                     [NEW]
    ├── test_tagging_service.py         [NEW]    - TC-1~3
    ├── test_masking_service.py         [NEW]    - TC-4~7
    ├── test_scenario_service.py        [NEW]    - TC-8~11
    ├── test_chat_service.py            [NEW]    - TC-12~16
    ├── integration/
    │   ├── __init__.py                 [NEW]
    │   └── test_gemini_client.py       [NEW]    - IT-1~2
    └── e2e/
        ├── __init__.py                 [NEW]
        └── test_endpoints.py           [NEW]    - E2E-1~5
```

### 구현 체크리스트 (레이어 순서)

#### Domain Layer
- [ ] [쉬움] `domain/entities.py`: TagResult, MaskingResult, ScenarioResult, ChatMessage 정의
  - [ ] Pydantic field_validator로 불변 조건 구현
  - [ ] MaskingResult에 entity_map 필드 의도적 제외
- [ ] [쉬움] `domain/errors.py`: AiServiceError 계층 14개 에러 클래스 정의
- [ ] [보통] `interfaces/llm_client.py`: ILlmClient ABC 정의
- [ ] [보통] `interfaces/vector_store.py`: IVectorStore ABC 정의
- [ ] [보통] `interfaces/masking_store.py`: IMaskingStore ABC 정의

#### Prompts (순수 상수, 외부 의존성 0)
- [ ] [쉬움] `prompts/tagging_prompt.py`: TAGGING_SYSTEM_PROMPT 작성
- [ ] [쉬움] `prompts/masking_prompt.py`: MASKING_SYSTEM_PROMPT 작성
- [ ] [보통] `prompts/scenario_prompt.py`: SCENARIO_SYSTEM_PROMPT, FALLBACK_PROMPT 작성
- [ ] [보통] `prompts/chat_prompt.py`: LEVEL_0~2 프롬프트, GUARDRAIL_FALLBACK_RESPONSE 작성

#### Infrastructure Layer
- [ ] [보통] `infra/in_memory_masking_store.py`: IMaskingStore 구현 (dict 기반)
- [ ] [보통] `infra/in_memory_vector_store.py`: IVectorStore 구현 (numpy cosine similarity)
- [ ] [어려움] `infra/gemini_client.py`: ILlmClient 구현
  - [ ] google.generativeai.AsyncClient 비동기 클라이언트 설정
  - [ ] complete() 메서드 구현 (재시도 로직 포함)
  - [ ] complete_with_vision() 메서드 구현 (이미지 Base64 처리)
  - [ ] GeminiApiError로 예외 래핑

#### Application Layer (Services)
- [ ] [보통] `services/tagging_service.py`: TaggingService 구현
  - [ ] 이미지 크기 검증 (5MB)
  - [ ] Gemini Vision 호출 및 JSON 파싱
  - [ ] TagParseError Fallback 처리
- [ ] [보통] `services/masking_service.py`: MaskingService 구현
  - [ ] 정규식 1차 마스킹 (전화번호, 주민번호, 이메일)
  - [ ] Gemini 2차 마스킹 (이름, 장소명)
  - [ ] entity_map 구성 및 IMaskingStore 저장
  - [ ] 마스킹 후 잔존 PII 검증
- [ ] [어려움] `services/scenario_service.py`: ScenarioService 구현
  - [ ] Guardrail 검증 로직 (정규식 + 포함 여부 검사)
  - [ ] 2회 재시도 로직 (Fallback 프롬프트 전환)
  - [ ] ScenarioResult → IVectorStore upsert
- [ ] [어려움] `services/chat_service.py`: ChatService 구현
  - [ ] LangGraph Window Buffer Memory (session_id 키, 최대 10턴)
  - [ ] hint_level별 시스템 프롬프트 분기
  - [ ] RAG 검색 통합 (IVectorStore.search)
  - [ ] Guardrail 실시간 검증 + GUARDRAIL_FALLBACK_RESPONSE

#### Presentation Layer (Routers + Models)
- [ ] [쉬움] `models/tagging.py`, `models/masking.py`, `models/scenario.py`, `models/chat.py`: Pydantic 모델 정의
- [ ] [보통] `routers/tagging.py`: POST /tag 라우터 구현
  - [ ] HTTP 예외 변환 (ImageSizeError → 422, GeminiApiError → 503)
- [ ] [보통] `routers/masking.py`: POST /mask 라우터 구현
- [ ] [보통] `routers/scenario.py`: POST /scenario 라우터 구현
- [ ] [보통] `routers/chat.py`: POST /chat 라우터 구현
- [ ] [보통] `dependencies.py`: 서비스 의존성 팩토리 구현 (Depends 등록)
- [ ] [쉬움] `main.py`: 라우터 4개 include_router 등록

#### requirements.txt 수정
- [ ] [쉬움] `google-generativeai` 패키지 추가 (최신 버전)
- [ ] `numpy` 패키지 추가 (InMemoryVectorStore cosine similarity용)

#### Tests
- [ ] [보통] `tests/test_tagging_service.py`: TC-1~3 구현
- [ ] [보통] `tests/test_masking_service.py`: TC-4~7 구현
- [ ] [보통] `tests/test_scenario_service.py`: TC-8~11 구현
- [ ] [어려움] `tests/test_chat_service.py`: TC-12~16 구현
- [ ] [어려움] `tests/integration/test_gemini_client.py`: IT-1~2 구현 (CI skip 마커)
- [ ] [보통] `tests/e2e/test_endpoints.py`: E2E-1~5 구현

---

## 에러 처리 전략

### 레이어별 에러 처리

```
Domain Layer (errors.py)
  AiServiceError
  ├── ImageDecodeError / ImageSizeError / TagParseError
  ├── TextTooLongError / ResidualPiiError
  ├── EmptyTargetWordsError / ScenarioGuardrailError
  ├── GuardrailViolationError / SessionNotFoundError / InvalidHintLevelError
  └── GeminiApiError

Application Layer (services/)
  - 도메인 에러를 그대로 raise (변환 없음)
  - GuardrailViolationError는 로그만 기록 후 Fallback 응답 반환 (예외 전파 안 함)

Infrastructure Layer (infra/)
  - google.api_core.exceptions.GoogleAPIError → GeminiApiError로 래핑
  - numpy 연산 실패 → RuntimeError로 래핑

Presentation Layer (routers/)
  에러 → HTTP 상태 코드 매핑:
  - ImageSizeError, TextTooLongError, EmptyTargetWordsError → 422 Unprocessable Entity
  - SessionNotFoundError                                     → 404 Not Found
  - GeminiApiError                                           → 503 Service Unavailable
  - ScenarioGuardrailError                                   → 500 Internal Server Error
  - 그 외 AiServiceError                                     → 500 Internal Server Error
```

---

## User Review Required (미결 결정 사항)

1. **벡터 임베딩 모델 선택**
   MVP에서 InMemoryVectorStore의 임베딩 방식을 어떻게 할지 결정 필요.
   - 옵션 A: numpy 기반 TF-IDF (외부 의존성 없음, 정확도 낮음)
   - 옵션 B: `sentence-transformers` 로컬 모델 (정확도 높음, 초기 로드 ~30초)
   - 옵션 C: OpenAI text-embedding-3-small API (비용 발생, 정확도 최고)
   - **권장**: MVP는 옵션 A로 시작, Phase 2에서 pgvector + 옵션 C로 교체

2. **google-generativeai SDK vs langchain_google_genai 선택**
   현재 requirements.txt에는 openai SDK만 설치됨.
   - 옵션 A: `google-generativeai` SDK 직접 사용 (GeminiClient 구현, LangChain 비의존)
   - 옵션 B: `langchain_google_genai` 래퍼 사용 (LangChain 생태계 통일)
   - **권장**: 옵션 A (외부 의존성 최소화, Gemini API 직접 제어)

3. **대화 응답 스트리밍 여부**
   현재 설계는 동기 응답(일반 HTTP 200). Gemini 응답 지연(2~5초)으로 UX 저하 우려.
   - 옵션 A: 현재 방식 유지 (간단, MVP 적합)
   - 옵션 B: SSE(Server-Sent Events) 스트리밍 응답 (Phase 2 도입)
   - **권장**: MVP는 옵션 A, Phase 2에서 옵션 B로 전환 (router 분리 설계 준수 시 변경 용이)

4. **Guardrail 검증 방식**
   현재 설계는 단순 문자열 포함 여부(`word in text`).
   - 옵션 A: 문자열 포함 검사 (빠름, 오탐 가능 - "사과나무"에서 "사과" 감지)
   - 옵션 B: 형태소 분석기(KoNLPy) 기반 어절 분리 후 비교 (정확, 의존성 추가)
   - **권장**: MVP는 옵션 A + 공백 패딩 처리, Phase 2에서 옵션 B 도입
