"""STT 엔진 추상 인터페이스.

구현체(AzureSttEngine, WhisperSttEngine 등)는 이 인터페이스만 상속한다.
엔진 교체(Azure↔Whisper)가 이 경계 안으로 국한되도록 설계한다.
"""
from abc import ABC, abstractmethod

from models.stt import SttResult


class ISttEngine(ABC):
    """음성 인식 엔진 추상 인터페이스."""

    @abstractmethod
    def recognize(
        self,
        wav_bytes: bytes,
        lang: str,
        candidates: list[str],
    ) -> SttResult:
        """WAV(PCM 16kHz mono) 오디오를 인식해 결과를 반환한다.

        Args:
            wav_bytes: WAV 오디오 바이트 (PCM 16kHz mono 권장)
            lang: 언어 코드 (예: "ko-KR")
            candidates: 정답 후보(phrase hint) — 제약 인식 정확도 향상용. 없으면 자유 인식.

        Returns:
            SttResult (transcript, confidence, nbest)

        Raises:
            RuntimeError: 인식 실패(취소·오류) 시
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """엔진 식별자(예: "azure")."""
        ...
