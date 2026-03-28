"""이미지 태깅 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class TagRequest(BaseModel):
    """POST /tag 요청 모델."""

    image_base64: str  # Base64 인코딩된 이미지
    memory_entry_id: str  # UUID


class TagResponse(BaseModel):
    """POST /tag 응답 모델."""

    memory_entry_id: str
    location_tag: str
    object_tags: list[str]
    confidence: float
