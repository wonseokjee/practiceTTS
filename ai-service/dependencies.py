"""
의존성 주입 팩토리 (Composition Root).
싱글턴 인스턴스를 생성하고 각 서비스에 주입한다.

패턴: 모듈 수준 변수로 싱글턴 보장 (FastAPI 프로세스 생존 기간 동안 유지).
구현체 교체 시 이 파일의 팩토리 함수만 수정하면 된다.
"""
import os

from fastapi import HTTPException, status

from infra.gemini_client import GeminiClient
from infra.in_memory_masking_store import InMemoryMaskingStore
from infra.in_memory_vector_store import InMemoryVectorStore
from services.chat_service import ChatService
from services.masking_service import MaskingService
from services.quiz_service import QuizGeneratorService
from services.scenario_service import ScenarioService
from services.tagging_service import TaggingService

# 싱글턴 인스턴스 초기화
_gemini_client: GeminiClient | None = None
_vector_store: InMemoryVectorStore | None = None
_masking_store: InMemoryMaskingStore | None = None

_tagging_service: TaggingService | None = None
_masking_service: MaskingService | None = None
_scenario_service: ScenarioService | None = None
_chat_service: ChatService | None = None
_quiz_generator_service: QuizGeneratorService | None = None


def _get_gemini_client() -> GeminiClient:
    """GeminiClient 싱글턴 반환."""
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY", "")
        _gemini_client = GeminiClient(api_key=api_key)
    return _gemini_client


def _get_vector_store() -> InMemoryVectorStore:
    """InMemoryVectorStore 싱글턴 반환."""
    global _vector_store
    if _vector_store is None:
        _vector_store = InMemoryVectorStore()
    return _vector_store


def _get_masking_store() -> InMemoryMaskingStore:
    """InMemoryMaskingStore 싱글턴 반환."""
    global _masking_store
    if _masking_store is None:
        _masking_store = InMemoryMaskingStore()
    return _masking_store


# FastAPI Depends() 주입 함수들


def get_tagging_service() -> TaggingService:
    """TaggingService 싱글턴 반환 (FastAPI Depends 용)."""
    global _tagging_service
    if _tagging_service is None:
        _tagging_service = TaggingService(llm_client=_get_gemini_client())
    return _tagging_service


def get_masking_service() -> MaskingService:
    """MaskingService 싱글턴 반환 (FastAPI Depends 용)."""
    global _masking_service
    if _masking_service is None:
        _masking_service = MaskingService(
            llm_client=_get_gemini_client(),
            masking_store=_get_masking_store(),
        )
    return _masking_service


def get_scenario_service() -> ScenarioService:
    """ScenarioService 싱글턴 반환 (FastAPI Depends 용)."""
    global _scenario_service
    if _scenario_service is None:
        _scenario_service = ScenarioService(
            llm_client=_get_gemini_client(),
            vector_store=_get_vector_store(),
        )
    return _scenario_service


def get_chat_service() -> ChatService:
    """ChatService 싱글턴 반환 (FastAPI Depends 용)."""
    global _chat_service
    if _chat_service is None:
        _chat_service = ChatService(
            llm_client=_get_gemini_client(),
            vector_store=_get_vector_store(),
        )
    return _chat_service


def get_quiz_generator_service() -> QuizGeneratorService:
    """QuizGeneratorService 싱글턴 반환 (FastAPI Depends 용).

    GEMINI_API_KEY 미설정 시 GeminiClient 생성자가 ValueError를 던지는데,
    그대로 두면 의존성 주입 단계에서 처리되지 않은 500이 발생한다.
    이를 구조화된 503(LLM_NOT_CONFIGURED)으로 변환해, 상위(NestJS)와 운영자가
    '일시적 LLM 오류'가 아니라 '서비스 미구성'임을 구분할 수 있게 한다.
    """
    global _quiz_generator_service
    if _quiz_generator_service is None:
        try:
            _quiz_generator_service = QuizGeneratorService(
                llm_client=_get_gemini_client(),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"LLM_NOT_CONFIGURED: {exc}",
            ) from exc
    return _quiz_generator_service
