"""발음 평가 엔진 추상 인터페이스.

구현체(AzurePronunciationAssessor 등)는 이 인터페이스만 상속한다.
엔진 교체(Azure↔wav2vec2 등)가 이 경계 안으로 국한되도록 설계한다.
"""
from abc import ABC, abstractmethod

from models.pronunciation import PronunciationResult


class IPronunciationAssessor(ABC):
    """발음 평가 엔진 추상 인터페이스."""

    @abstractmethod
    def assess(
        self,
        wav_bytes: bytes,
        reference_text: str,
        lang: str,
    ) -> PronunciationResult:
        """WAV 오디오를 정답 텍스트 기준으로 채점한다.

        Args:
            wav_bytes: WAV 오디오 바이트 (PCM 16kHz mono 권장)
            reference_text: 환자가 말하도록 제시된 목표 단어/문장(정답)
            lang: 언어 코드 (예: "ko-KR")

        Returns:
            PronunciationResult (정확도·유창성·완성도·종합·운율 + 단어/음소별)

        Raises:
            RuntimeError: 평가 실패(취소·오류) 시
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """엔진 식별자(예: "azure")."""
        ...
