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
from threading import Lock

from interfaces.tts_engine import ITtsEngine

# 축출 시 상한이 아니라 이 비율까지 지운다. 상한에 딱 맞춰 지우면 다음 쓰기가
# 곧바로 다시 상한을 넘겨 미스마다 O(N) 스캔이 돌게 된다.
_EVICT_LOW_WATER_RATIO = 0.8


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
        # 캐시 총 바이트 추적 (None = 아직 실측 전). 미스마다 디렉토리를 스캔하지
        # 않으려고 메모리에 들고 있다가, 축출 스캔 때 실측으로 보정한다.
        self._tracked_bytes: int | None = None
        self._size_lock = Lock()

    def synthesize(self, text: str, voice: str) -> bytes:
        """캐시 히트면 즉시 반환, 미스면 엔진 합성 후 캐시에 저장."""
        path = self._cache_path(text, voice)
        # exists() 확인과 read_bytes() 사이에 축출 스레드가 파일을 지울 수 있다.
        # (FastAPI 동기 엔드포인트는 스레드풀에서 돈다.) 그 경합으로 502를 내지
        # 않도록, 사라졌으면 캐시 미스처럼 합성으로 넘어간다.
        try:
            audio = path.read_bytes()
            self._touch(path)  # 접근 시각 갱신 → LRU가 '최근 사용'을 반영
            return audio
        except FileNotFoundError:
            pass
        except OSError:
            # 손상/권한 문제도 캐시 미스로 취급(합성으로 복구 가능)
            pass

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
        self._maybe_evict(len(audio))
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

    def _maybe_evict(self, written_bytes: int) -> None:
        """캐시 크기를 추적하다가 상한을 넘겼을 때만 실제 축출(스캔)을 돌린다.

        예전엔 캐시 미스마다 디렉토리 전체를 glob+stat 했다. 200MB/10KB ≈ 2만 파일이면
        미스 한 번에 수만 syscall이라, 임의 텍스트 폭주이 CPU/IO DoS가 된다.
        이제 크기를 메모리에 들고 있다가 상한 초과 시에만 스캔한다.
        """
        if self._max_cache_bytes is None:
            return

        with self._size_lock:
            if self._tracked_bytes is None:
                # 최초 1회만 실측(프로세스 수명 동안 이후엔 증감으로 유지)
                self._tracked_bytes = self._scan_total_bytes()
            self._tracked_bytes += written_bytes
            if self._tracked_bytes <= self._max_cache_bytes:
                return

        self._evict_if_needed()

    def _scan_total_bytes(self) -> int:
        """캐시 디렉토리의 mp3 총 바이트를 실측한다(O(N))."""
        total = 0
        for p in self._cache_dir.glob("*.mp3"):
            try:
                total += p.stat().st_size
            except OSError:
                continue
        return total

    def _evict_if_needed(self) -> None:
        """상한 초과 시 오래된(mtime 오름차순) mp3부터 저수위까지 삭제한다.

        상한이 아니라 저수위(80%)까지 지우는 이유: 상한에 딱 맞춰 지우면 다음 쓰기가
        곧바로 다시 상한을 넘겨 미스마다 스캔이 돌아 O(N)으로 되돌아간다.
        여유를 만들어 두면 그만큼의 쓰기 동안은 스캔 없이 진행한다.
        """
        if self._max_cache_bytes is None:
            return

        low_water = int(self._max_cache_bytes * _EVICT_LOW_WATER_RATIO)

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

        if total > self._max_cache_bytes:
            for p, _mtime, size in sorted(entries, key=lambda e: e[1]):
                if total <= low_water:
                    break
                try:
                    p.unlink(missing_ok=True)
                    total -= size
                except OSError:
                    # 삭제 실패(권한/경합)는 다음 축출 기회로 미룬다.
                    continue

        # 스캔했으니 추적값을 실측으로 보정한다(누적 오차 제거)
        with self._size_lock:
            self._tracked_bytes = total
