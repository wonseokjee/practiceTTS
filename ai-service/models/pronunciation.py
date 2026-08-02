"""발음 평가(Pronunciation Assessment) 엔드포인트 모델 및 내부 결과 타입.

정답 텍스트(reference_text)를 아는 재활 과제에서, 환자 발화가 목표 단어/문장을
'얼마나 정확히' 발음했는지를 Azure Pronunciation Assessment로 음소 단위까지 채점한다.
기존 nameMatch(문자열 편집거리 근사)를 대체/보강하는 실채점 신호다.
"""
from dataclasses import dataclass, field

from pydantic import BaseModel, Field


# ─── 내부 도메인 결과 (엔진 무관) ─────────────────────────────


@dataclass
class PhonemeScore:
    """음소 단위 정확도 (내부)."""

    phoneme: str
    accuracy: float


@dataclass
class WordScore:
    """단어 단위 채점 (내부).

    error_type: "None" | "Omission"(빠뜨림) | "Insertion"(덧붙임) |
                "Mispronunciation"(오발음) — Azure가 miscue 분석으로 판정.
    """

    word: str
    accuracy: float
    error_type: str
    phonemes: list[PhonemeScore] = field(default_factory=list)


@dataclass
class PronunciationResult:
    """발음 평가 결과 (내부 도메인).

    점수는 모두 0~100. prosody_score는 SDK/언어가 지원하지 않으면 None.
    """

    recognized_text: str
    accuracy_score: float
    fluency_score: float
    completeness_score: float
    pronunciation_score: float
    prosody_score: float | None
    words: list[WordScore] = field(default_factory=list)


# ─── HTTP 응답 모델 ───────────────────────────────────────────


class PhonemeScoreResponse(BaseModel):
    phoneme: str
    accuracy: float


class WordScoreResponse(BaseModel):
    word: str
    accuracy: float
    error_type: str
    phonemes: list[PhonemeScoreResponse] = []


class PronunciationResponse(BaseModel):
    """POST /pronunciation 응답 모델."""

    recognized_text: str
    accuracy_score: float = Field(..., description="음소 정확도 평균 0~100")
    fluency_score: float = Field(..., description="유창성 0~100")
    completeness_score: float = Field(..., description="완성도(빠뜨림 없이 말한 비율) 0~100")
    pronunciation_score: float = Field(..., description="종합 발음 점수 0~100")
    prosody_score: float | None = Field(None, description="운율(억양·강세) 0~100, 미지원 시 null")
    words: list[WordScoreResponse] = []
    engine: str
