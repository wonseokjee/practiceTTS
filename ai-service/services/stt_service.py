"""STT 오케스트레이션 서비스.

엔진 어댑터(ISttEngine)를 감싸 인식 결과를 반환한다. 엔진 교체(Azure↔Whisper)는
주입되는 엔진만 바꾸면 되며, 라우터/채점 등 호출부는 그대로 재사용된다.
"""
from interfaces.stt_engine import ISttEngine
from models.stt import SttResult


class SttService:
    """음성 인식 서비스 (엔진 무관 경계)."""

    def __init__(self, engine: ISttEngine) -> None:
        self._engine = engine

    def recognize(
        self,
        wav_bytes: bytes,
        lang: str,
        candidates: list[str],
    ) -> SttResult:
        """오디오를 인식해 결과를 반환한다."""
        return self._engine.recognize(wav_bytes, lang, candidates)

    @property
    def engine_name(self) -> str:
        return self._engine.name
