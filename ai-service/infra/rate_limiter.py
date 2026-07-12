"""인메모리 슬라이딩 윈도우 레이트리밋.

/tts·/stt는 브라우저에서 직접 호출되고(인증 헤더를 못 붙이는 <audio src> 포함)
캐시 미스마다 Azure를 때리므로, 임의 텍스트 폭주로 Azure 할당량(비용)을 소진시켜
정상 사용자를 스로틀링시킬 수 있다. 클라이언트(키)별 요청 빈도를 제한해 이를 막는다.

- 외부 의존성 없이 단일 프로세스(uvicorn) 메모리에 윈도우를 유지한다.
- 다중 워커/수평 확장 시에는 Redis 등 공유 저장소 기반으로 교체해야 한다(부채).
"""
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Callable, Deque, Dict


class SlidingWindowRateLimiter:
    """키(예: 클라이언트 IP)별 최근 window_seconds 내 요청 수를 제한한다."""

    def __init__(
        self,
        max_requests: int,
        window_seconds: float,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_requests <= 0:
            raise ValueError("max_requests는 1 이상이어야 합니다.")
        if window_seconds <= 0:
            raise ValueError("window_seconds는 0보다 커야 합니다.")
        self._max = max_requests
        self._window = window_seconds
        self._time = time_fn
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        """요청을 허용하면 True(카운트 반영), 한도 초과면 False."""
        now = self._time()
        cutoff = now - self._window
        with self._lock:
            hits = self._hits[key]
            # 윈도우를 벗어난 오래된 기록 제거
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self._max:
                return False
            hits.append(now)
            return True
