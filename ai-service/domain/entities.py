"""
도메인 엔티티 (값 객체) 정의.
외부 의존성 없음. Pydantic BaseModel만 사용.
"""
from typing import Literal

from pydantic import BaseModel, field_validator


class TagResult(BaseModel):
    """이미지 태깅 결과 값 객체."""

    location_tag: str
    object_tags: list[str]
    confidence: float

    @field_validator("location_tag")
    @classmethod
    def validate_location_tag(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("location_tag는 빈 문자열일 수 없습니다")
        return v

    @field_validator("object_tags")
    @classmethod
    def validate_object_tags(cls, v: list[str]) -> list[str]:
        if not (1 <= len(v) <= 10):
            raise ValueError("object_tags는 1~10개 사이여야 합니다")
        return v

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("confidence는 0.0~1.0 사이여야 합니다")
        return v


class MaskingResult(BaseModel):
    """마스킹 처리 결과 값 객체.

    entity_map은 보안상 이 객체에 포함하지 않는다.
    entity_map은 IMaskingStore에만 저장된다.
    """

    masked_text: str
    entity_count: int

    @field_validator("masked_text")
    @classmethod
    def validate_masked_text(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("masked_text는 빈 문자열일 수 없습니다")
        return v


class ScenarioResult(BaseModel):
    """훈련 시나리오 값 객체.

    guardrail_words는 내부 검증 전용 필드로, 외부 응답에 포함하지 않는다.
    """

    opening_question: str
    context_summary: str
    guardrail_words: list[str]
    scene_description: str

    @field_validator("context_summary")
    @classmethod
    def validate_context_summary(cls, v: str) -> str:
        if not (100 <= len(v) <= 500):
            raise ValueError(
                f"context_summary는 100~500자 사이여야 합니다 (현재: {len(v)}자)"
            )
        return v


class ChatMessage(BaseModel):
    """대화 메시지 값 객체."""

    role: Literal["ai", "patient"]
    content: str
    hint_triggered: bool = False
    hint_level: int = 0

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content는 빈 문자열일 수 없습니다")
        return v

    @field_validator("hint_level")
    @classmethod
    def validate_hint_level(cls, v: int) -> int:
        if v not in (0, 1, 2):
            raise ValueError("hint_level은 0, 1, 2 중 하나여야 합니다")
        return v
