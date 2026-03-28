"""훈련 시나리오 생성 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class ScenarioRequest(BaseModel):
    """POST /scenario 요청 모델."""

    masked_context: str
    target_words: list[str]  # 1~3개
    emotion_tag: str  # happy | calm | nostalgic | excited
    memory_entry_id: str


class ScenarioResponse(BaseModel):
    """POST /scenario 응답 모델.

    보안 규칙: guardrail_words는 이 모델에 포함 금지 (환자에게 노출 방지).
    """

    memory_entry_id: str
    opening_question: str
    context_summary: str
    scene_description: str
