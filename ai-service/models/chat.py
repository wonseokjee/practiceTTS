"""RAG 대화 에이전트 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class ChatRequest(BaseModel):
    """POST /chat 요청 모델."""

    session_id: str
    user_message: str
    hint_level: int  # 0 | 1 | 2
    memory_entry_id: str  # RAG 검색 범위 한정


class ScenarioPayload(BaseModel):
    """ChatRequest에 포함되는 시나리오 정보 (간소화된 ScenarioResult DTO)."""

    opening_question: str
    context_summary: str
    scene_description: str
    guardrail_words: list[str]


class ChatResponse(BaseModel):
    """POST /chat 응답 모델."""

    session_id: str
    ai_message: str
    hint_triggered: bool
    hint_level: int
