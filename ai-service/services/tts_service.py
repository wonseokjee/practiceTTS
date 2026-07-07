"""TTS 오케스트레이션 + 파일 캐싱.

같은 (voice, text)는 최초 1회만 엔진으로 합성하고 이후엔 캐시(MP3)를 반환한다
(CLAUDE.md 하이브리드 캐싱의 On-demand 절반). 엔진 교체는 주입 엔진만 바꾸면 되고
캐시 경로/전략은 여기에 국한된다.
"""
import hashlib
import uuid
from pathlib import Path

from interfaces.tts_engine import ITtsEngine


class TtsService:
    """음성 합성 서비스 (엔진 무관 경계 + 파일 캐시)."""

    def __init__(self, engine: ITtsEngine, cache_dir: str) -> None:
        self._engine = engine
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    def synthesize(self, text: str, voice: str) -> bytes:
        """캐시 히트면 즉시 반환, 미스면 엔진 합성 후 캐시에 저장."""
        path = self._cache_path(text, voice)
        if path.exists():
            return path.read_bytes()

        audio = self._engine.synthesize(text, voice)
        # 부분쓰기가 캐시로 노출되지 않도록 임시파일에 쓰고 원자적 교체.
        # 동시 최초요청이 같은 tmp를 밟지 않도록 tmp 이름에 uuid를 부여한다.
        tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
        try:
            tmp.write_bytes(audio)
            tmp.replace(path)
        finally:
            # replace 실패 등으로 tmp가 남으면 정리.
            if tmp.exists():
                tmp.unlink(missing_ok=True)
        return audio

    @property
    def engine_name(self) -> str:
        return self._engine.name

    def _cache_path(self, text: str, voice: str) -> Path:
        raw = f"{voice}|{text}".encode("utf-8")
        key = hashlib.sha256(raw).hexdigest()[:16]
        return self._cache_dir / f"{key}.mp3"
