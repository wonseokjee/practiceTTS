"""SlidingWindowRateLimiter 단위 테스트 (주입 시계로 시간 결정적 검증)."""
import pytest

from infra.rate_limiter import SlidingWindowRateLimiter


class FakeClock:
    """수동으로 진행시키는 단조 시계."""

    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_allows_up_to_limit_then_blocks():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(3, 60.0, time_fn=clock)

    assert limiter.allow("ip1") is True
    assert limiter.allow("ip1") is True
    assert limiter.allow("ip1") is True
    # 4번째는 한도 초과 → 차단
    assert limiter.allow("ip1") is False


def test_keys_are_independent():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(1, 60.0, time_fn=clock)

    assert limiter.allow("ip1") is True
    assert limiter.allow("ip1") is False
    # 다른 키는 별도 카운트
    assert limiter.allow("ip2") is True


def test_window_slides_and_frees_slots():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(2, 60.0, time_fn=clock)

    assert limiter.allow("ip1") is True  # t=0
    assert limiter.allow("ip1") is True  # t=0
    assert limiter.allow("ip1") is False  # 한도 초과

    clock.advance(61.0)  # 두 기록 모두 윈도우 밖으로
    assert limiter.allow("ip1") is True


def test_partial_window_expiry():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(2, 60.0, time_fn=clock)

    assert limiter.allow("ip1") is True  # t=0
    clock.advance(30.0)
    assert limiter.allow("ip1") is True  # t=30 → 한도 도달
    assert limiter.allow("ip1") is False  # t=30 여전히 초과

    clock.advance(31.0)  # t=61 → t=0 기록만 만료(t=30 기록은 유효)
    assert limiter.allow("ip1") is True  # 한 자리 확보
    assert limiter.allow("ip1") is False  # 다시 한도


def test_expired_keys_are_pruned_not_leaked():
    """윈도우가 지난 키는 제거된다.

    이게 없으면 본 적 있는 키마다 항목이 영구히 남아, 위조 IP를 흘리는 공격자가
    레이트리밋터 자체를 메모리 DoS 벡터로 쓸 수 있다.
    """
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(5, 60.0, time_fn=clock)

    for i in range(100):
        limiter.allow(f"ip-{i}")
    assert len(limiter._hits) == 100

    clock.advance(61.0)  # 모든 기록이 윈도우 밖으로
    limiter.allow("ip-new")  # allow 시점에 프루닝

    # 만료된 100개는 사라지고 방금 것만 남는다
    assert len(limiter._hits) == 1
    assert "ip-new" in limiter._hits


def test_pruning_does_not_drop_active_keys():
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(5, 60.0, time_fn=clock)

    limiter.allow("old")
    clock.advance(30.0)
    limiter.allow("recent")
    clock.advance(31.0)  # old(t=0)만 만료, recent(t=30)는 유효
    limiter.allow("new")

    assert "old" not in limiter._hits
    assert "recent" in limiter._hits


def test_invalid_config_raises():
    with pytest.raises(ValueError):
        SlidingWindowRateLimiter(0, 60.0)
    with pytest.raises(ValueError):
        SlidingWindowRateLimiter(1, 0.0)
