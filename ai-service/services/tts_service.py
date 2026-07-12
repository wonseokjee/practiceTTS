"""TTS 오케스트레이션 + 파일 캐싱.

같은 (voice, text)는 최초 1회만 엔진으로 합성하고 이후엔 캐시(MP3)를 반환한다
(CLAUDE.md 하이브리드 캐싱의 On-demand 절반). 엔진 교체는 주입 엔진만 바꾸면 되고
캐시 경로/전략은 여기에 국한된다.

캐시는 크기 상한(max_cache_bytes)을 두어 오래된 항목부터 축출한다(LRU, mtime 기준).
상한이 없으면 임의 텍스트 폭주로 디스크를 무한히 채울 수 있다(디스크 DoS).
"""
import hashlib
import os
import uuid
from pathlib import Path

from interfaces.tts_engine import ITtsEngine


class TtsService:
    """음성 합성 서비스 (엔진 무관 경계 + 파일 캐시 + LRU 축출)."""

    def __init__(
        self,
        engine: ITtsEngine,
        cache_dir: str,
        max_cache_bytes: int | None = None,
    ) -> None:
        self._engine = engine
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        # None 또는 0 이하면 무제한(하위호환). 양수면 그 크기를 넘으면 축출.
        self._max_cache_bytes = (
            max_cache_bytes if max_cache_bytes and max_cache_bytes > 0 else None
        )

    def synthesize(self, text: str, voice: str) -> bytes:
        """캐시 히트면 즉시 반환, 미스면 엔진 합성 후 캐시에 저장."""
        path = self._cache_path(text, voice)
        if path.exists():
            # 접근 시각을 갱신해 LRU가 '최근 사용'을 반영하도록 한다.
            self._touch(path)
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
        self._evict_if_needed()
        return audio

    @property
    def engine_name(self) -> str:
        return self._engine.name

    def _cache_path(self, text: str, voice: str) -> Path:
        raw = f"{voice}|{text}".encode("utf-8")
        key = hashlib.sha256(raw).hexdigest()[:16]
        return self._cache_dir / f"{key}.mp3"

    def _touch(self, path: Path) -> None:
        """접근 시각(mtime) 갱신 — 실패해도 무시(캐시 반환을 막지 않음)."""
        try:
            os.utime(path, None)
        except OSError:
            pass

    def _evict_if_needed(self) -> None:
        """캐시 총량이 상한을 넘으면 오래된(mtime 오름차순) mp3부터 삭제한다."""
        if self._max_cache_bytes is None:
            return

        # (경로, mtime, size) 수집 — 열거 중 파일이 사라질 수 있어 개별 stat 보호.
        entries: list[tuple[Path, float, int]] = []
        total = 0
        for p in self._cache_dir.glob("*.mp3"):
            try:
                st = p.stat()
            except OSError:
                continue
            entries.append((p, st.st_mtime, st.st_size))
            total += st.st_size

        if total <= self._max_cache_bytes:
            return

        for p, _mtime, size in sorted(entries, key=lambda e: e[1]):
            if total <= self._max_cache_bytes:
                break
            try:
                p.unlink(missing_ok=True)
                total -= size
            except OSError:
                # 삭제 실패(권한/경합)는 다음 축출 기회로 미룬다.
                continue
