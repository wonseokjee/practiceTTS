"""STT(음성 인식) 엔드포인트 모델 및 내부 결과 타입."""
from dataclasses import dataclass, field

from pydantic import BaseModel


@dataclass
class SttNBestItem:
    """엔진 n-best 후보 (내부)."""

    text: str
    confidence: float


@dataclass
class SttResult:
    """엔진 인식 결과 (내부 도메인)."""

    transcript: str
    confidence: float
    nbest: list[SttNBestItem] = field(default_factory=list)


class SttNBestResponse(BaseModel):
    """응답 n-best 후보."""

    text: str
    confidence: float


class SttResponse(BaseModel):
    """POST /stt 응답 모델."""

    transcript: str
    confidence: float
    nbest: list[SttNBestResponse] = []
    engine: str
