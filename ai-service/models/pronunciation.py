"""발음 평가(Pronunciation Assessment) 엔드포인트 모델 및 내부 결과 타입.

정답 텍스트(reference_text)를 아는 재활 과제에서, 환자 발화가 목표 단어/문장을
'얼마나 정확히' 발음했는지를 Azure Pronunciation Assessment로 음소 단위까지 채점한다.
기존 nameMatch(문자열 편집거리 근사)를 대체/보강하는 실채점 신호다.
"""
from dataclasses import dataclass, field
from typing import Literal

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


@dataclass
class CompetitorScore:
    """경쟁자 참조로 같은 녹음을 채점한 결과 (내부).

    source: "neighbor"(호출자가 넘긴 이웃 단어) | "stt"(후보 없는 인식 결과)
    status: "ok" | "no_match"(그 참조로는 인식 못함 — 점수 0) | "error"(호출 실패 —
            accuracy_score를 쓰면 안 된다)
    """

    text: str
    source: str
    accuracy_score: float
    recognized_text: str
    status: str


@dataclass
class CompetitorAssessment:
    """목표 채점 + 경쟁자 채점 (내부).

    competitors가 None이면 경쟁자를 채점하지 않았다(skipped_reason에 이유).
    stt_status: None(요청 안 함) | "ok" | "empty"(인식 결과 없음) | "error"(호출 실패)
    """

    target: PronunciationResult
    competitors: list[CompetitorScore] | None = None
    stt_transcript: str | None = None
    stt_status: str | None = None
    skipped_reason: str | None = None


# ─── HTTP 응답 모델 ───────────────────────────────────────────


class PhonemeScoreResponse(BaseModel):
    phoneme: str
    accuracy: float


class WordScoreResponse(BaseModel):
    word: str
    accuracy: float
    error_type: str
    phonemes: list[PhonemeScoreResponse] = []


class CompetitorScoreResponse(BaseModel):
    text: str
    source: Literal["neighbor", "stt"]
    accuracy_score: float
    recognized_text: str
    status: Literal["ok", "no_match", "error"]


class PronunciationResponse(BaseModel):
    """POST /pronunciation 응답 모델.

    아래 네 필드(competitor_scores·stt_transcript·stt_status·competitors_skipped)는
    **경쟁자 모드(요청에 competitors 또는 stt_competitor)에서만** 나간다. 라우터가
    `response_model_exclude_unset=True`라 설정하지 않으면 키 자체가 없다 — 경쟁자를 안
    쓰는 요청의 응답은 예전과 같은 키 집합이다(`test_pronunciation_router.py`).
    """

    recognized_text: str
    accuracy_score: float = Field(..., description="음소 정확도 평균 0~100")
    fluency_score: float = Field(..., description="유창성 0~100")
    completeness_score: float = Field(..., description="완성도(빠뜨림 없이 말한 비율) 0~100")
    pronunciation_score: float = Field(..., description="종합 발음 점수 0~100")
    prosody_score: float | None = Field(None, description="운율(억양·강세) 0~100, 미지원 시 null")
    words: list[WordScoreResponse] = []
    engine: str
    competitor_scores: list[CompetitorScoreResponse] | None = Field(
        None, description="경쟁자 참조별 점수. 경쟁자를 채점하지 않았으면 없다(competitors_skipped 참고)"
    )
    stt_transcript: str | None = Field(None, description="후보 없는 인식 결과(요청했을 때만)")
    stt_status: Literal["ok", "empty", "error"] | None = Field(
        None, description="인식 호출 결과. error면 경쟁자 비교를 못 한 것이다"
    )
    competitors_skipped: Literal["target_below_pass", "no_match"] | None = Field(
        None, description="목표 점수가 정답선 미만이거나 인식 실패라 경쟁자를 안 불렀다"
    )
