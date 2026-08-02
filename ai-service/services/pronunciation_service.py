"""발음 평가 오케스트레이션 서비스.

엔진 어댑터(IPronunciationAssessor)를 감싸 채점 결과를 반환한다.
엔진 교체(Azure↔wav2vec2 등)는 주입되는 엔진만 바꾸면 되며,
라우터/채점 등 호출부는 그대로 재사용된다.
"""
from interfaces.pronunciation_assessor import IPronunciationAssessor
from models.pronunciation import PronunciationResult


class PronunciationService:
    """발음 평가 서비스 (엔진 무관 경계)."""

    def __init__(self, assessor: IPronunciationAssessor) -> None:
        self._assessor = assessor

    def assess(
        self,
        wav_bytes: bytes,
        reference_text: str,
        lang: str,
    ) -> PronunciationResult:
        """오디오를 정답 텍스트 기준으로 채점해 결과를 반환한다."""
        return self._assessor.assess(wav_bytes, reference_text, lang)

    @property
    def engine_name(self) -> str:
        return self._assessor.name
