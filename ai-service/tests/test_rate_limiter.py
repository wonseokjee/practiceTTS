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


def test_invalid_config_raises():
    with pytest.raises(ValueError):
        SlidingWindowRateLimiter(0, 60.0)
    with pytest.raises(ValueError):
        SlidingWindowRateLimiter(1, 0.0)
