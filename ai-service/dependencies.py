"""
의존성 주입 팩토리 (Composition Root).
싱글턴 인스턴스를 생성하고 각 서비스에 주입한다.

패턴: 모듈 수준 변수로 싱글턴 보장 (FastAPI 프로세스 생존 기간 동안 유지).
구현체 교체 시 이 파일의 팩토리 함수만 수정하면 된다.
"""
import os

from infra.gemini_client import GeminiClient
from infra.in_memory_masking_store import InMemoryMaskingStore
from infra.in_memory_vector_store import InMemoryVectorStore
from services.chat_service import ChatService
from services.masking_service import MaskingService
from services.scenario_service import ScenarioService
from services.stt_service import SttService
from services.tagging_service import TaggingService

# 싱글턴 인스턴스 초기화
_gemini_client: GeminiClient | None = None
_vector_store: InMemoryVectorStore | None = None
_masking_store: InMemoryMaskingStore | None = None

_tagging_service: TaggingService | None = None
_masking_service: MaskingService | None = None
_scenario_service: ScenarioService | None = None
_chat_service: ChatService | None = None
_stt_service: SttService | None = None


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


def get_stt_service() -> SttService:
    """SttService 싱글턴 반환 (FastAPI Depends 용).

    Whisper 모델은 지연 로딩이므로 싱글턴 생성 시 모델은 아직 메모리에 적재되지 않는다.
    최초 transcribe 호출 시 내부적으로 load_model이 실행된다.
    """
    global _stt_service
    if _stt_service is None:
        _stt_service = SttService()
    return _stt_service
