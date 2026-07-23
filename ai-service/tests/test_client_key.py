"""client_key(레이트리밋 키) 테스트.

핵심 회귀: X-Forwarded-For는 클라이언트가 자유롭게 넣는 헤더다. 무조건 신뢰하면
공격자가 요청마다 임의 XFF를 넣어 매번 새 버킷을 받아 한도를 완전히 우회하고,
레이트리밋터 내부 맵을 위조 IP로 부풀린다. 보호장치가 DoS 벡터가 된다.
"""
import os

from dependencies import client_key


class FakeRequest:
    def __init__(self, headers: dict[str, str], host: str | None) -> None:
        self.headers = headers
        self.client = type("C", (), {"host": host})() if host else None


def test_ignores_forwarded_header_by_default(monkeypatch):
    """기본값: XFF를 무시하고 소켓 IP를 쓴다 (우회 차단)."""
    monkeypatch.delenv("TRUST_PROXY_HEADER", raising=False)
    req = FakeRequest({"x-forwarded-for": "1.2.3.4"}, host="10.0.0.9")

    assert client_key(req) == "10.0.0.9"


def test_forged_forwarded_headers_share_one_bucket(monkeypatch):
    """위조 XFF를 매번 바꿔도 같은 소켓 IP면 같은 키 → 한도가 실제로 적용된다."""
    monkeypatch.delenv("TRUST_PROXY_HEADER", raising=False)
    keys = {
        client_key(FakeRequest({"x-forwarded-for": f"9.9.9.{i}"}, host="10.0.0.9"))
        for i in range(50)
    }

    assert keys == {"10.0.0.9"}


def test_honors_forwarded_header_when_behind_trusted_proxy(monkeypatch):
    """신뢰 프록시 뒤에 배포할 때만 XFF를 존중한다."""
    monkeypatch.setenv("TRUST_PROXY_HEADER", "true")
    req = FakeRequest({"x-forwarded-for": "1.2.3.4, 10.0.0.1"}, host="10.0.0.9")

    assert client_key(req) == "1.2.3.4"


def test_falls_back_to_unknown_without_client(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADER", raising=False)
    assert client_key(FakeRequest({}, host=None)) == "unknown"
