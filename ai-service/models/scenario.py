"""훈련 시나리오 생성 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class ScenarioRequest(BaseModel):
    """POST /scenario 요청 모델."""

    masked_context: str
    target_words: list[str]  # 1~3개
    emotion_tag: str  # happy | calm | nostalgic | excited
    memory_entry_id: str


class ScenarioLLMOut(BaseModel):
    """LLM 구조화 출력(JSON 모드) 강제용 스키마.

    Gemini가 이 3개 키의 유효 JSON만 반환하도록 response_schema로 넘긴다. guardrail_words는
    LLM 출력이 아니라 호출부가 주입하므로 여기 없다(응답 모델과 동일하게 환자 미노출).
    context_summary 길이 보정 등 의미 처리는 서비스가 계속 담당.
    """

    opening_question: str
    context_summary: str
    scene_description: str


class ScenarioResponse(BaseModel):
    """POST /scenario 응답 모델.

    보안 규칙: guardrail_words는 이 모델에 포함 금지 (환자에게 노출 방지).
    """

    memory_entry_id: str
    opening_question: str
    context_summary: str
    scene_description: str
