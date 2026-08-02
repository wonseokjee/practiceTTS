"""이미지 태깅 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class TagRequest(BaseModel):
    """POST /tag 요청 모델."""

    image_base64: str  # Base64 인코딩된 이미지
    memory_entry_id: str  # UUID


class TagLLMOut(BaseModel):
    """LLM(Vision) 구조화 출력 강제용 스키마.

    Gemini가 이 3개 키의 유효 JSON만 반환하도록 response_schema로 넘긴다
    (memory_entry_id는 LLM 출력이 아니라 서비스가 붙인다).
    """

    location_tag: str
    object_tags: list[str]
    confidence: float


class TagResponse(BaseModel):
    """POST /tag 응답 모델."""

    memory_entry_id: str
    location_tag: str
    object_tags: list[str]
    confidence: float
