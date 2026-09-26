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

    def allow(self, key: str, cost: int = 1) -> bool:
        """요청을 허용하면 True(카운트 반영), 한도 초과면 False.

        `cost`는 이 요청이 실제로 치르는 호출 수다(기본 1). 한 요청이 유료 호출을 여러 번
        내면(예: /pronunciation의 경쟁자 채점) 요청 수가 아니라 **호출 수**로 세야 Azure
        할당량을 지키는 회로차단기가 된다. 한도를 넘기면 **아무것도 차감하지 않는다**.
        """
        if cost < 1:
            raise ValueError("cost는 1 이상이어야 합니다.")
        now = self._time()
        cutoff = now - self._window
        with self._lock:
            self._prune(cutoff)

            hits = self._hits[key]
            # 윈도우를 벗어난 오래된 기록 제거
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) + cost > self._max:
                return False
            hits.extend([now] * cost)
            return True

    def _prune(self, cutoff: float) -> None:
        """윈도우가 완전히 비워진 키를 제거한다 (호출자가 락을 쥔 상태여야 함).

        이게 없으면 _hits는 본 적 있는 키마다 항목을 남겨 무한히 커진다.
        키가 클라이언트 IP라 위조 가능한 헤더에서 온다면 그 자체로 메모리 DoS가
        된다 — 레이트리밋이 막으려던 바로 그 공격에 문을 열어주는 셈.
        """
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or hits[-1] <= cutoff
        ]
        for key in stale:
            del self._hits[key]
