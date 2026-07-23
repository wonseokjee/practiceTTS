"""TTS 엔진 추상 인터페이스.

구현체(AzureTtsEngine 등)는 이 인터페이스만 상속한다. 엔진 교체(Azure↔기타)가
이 경계 안으로 국한되도록 설계한다.
"""
from abc import ABC, abstractmethod


class ITtsEngine(ABC):
    """텍스트 음성 합성 엔진 추상 인터페이스."""

    @abstractmethod
    def synthesize(self, text: str, voice: str) -> bytes:
        """텍스트를 음성으로 합성해 오디오 바이트(MP3)를 반환한다.

        Args:
            text: 합성할 텍스트
            voice: 음성 이름 (예: "ko-KR-SunHiNeural")

        Returns:
            MP3 오디오 바이트

        Raises:
            RuntimeError: 합성 실패(취소·오류) 시
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """엔진 식별자(예: "azure")."""
        ...
