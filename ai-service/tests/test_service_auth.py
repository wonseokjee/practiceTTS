"""서비스 간 인증(X-Service-Token) 테스트.

이 서비스는 Gemini와 Azure를 호출한다. 인증이 없으면 포트에 닿는 누구나
남의 API 할당량을 태우고, /mask에 임의 텍스트를 넣어 외부 LLM으로 흘려보낼 수
있다. 의료 성격 데이터라 후자가 특히 문제다.

브라우저가 직접 부르는 /stt·/tts는 토큰을 걸 수 없다(브라우저에 심은 토큰은
비밀이 아니다). 그 둘이 계속 열려 있는지도 함께 고정한다.
"""
import os

import pytest
from fastapi.testclient import TestClient

import main

TOKEN = "test-service-token-0123456789"

# 백엔드만 호출하는 엔드포인트 — 토큰으로 막혀야 한다.
BACKEND_ONLY = [
    ("/tag", "post"),
    ("/mask", "post"),
    ("/scenario", "post"),
    ("/chat", "post"),
    ("/wish/to-practice", "post"),
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", TOKEN)
    with TestClient(main.app) as c:
        yield c


@pytest.mark.parametrize("path,method", BACKEND_ONLY)
def test_backend_only_endpoint_rejects_missing_token(client, path, method):
    """토큰 없이 부르면 401 — 본문 검증(422)까지 가면 안 된다."""
    res = getattr(client, method)(path, json={})

    assert res.status_code == 401


@pytest.mark.parametrize("path,method", BACKEND_ONLY)
def test_backend_only_endpoint_rejects_wrong_token(client, path, method):
    res = getattr(client, method)(path, json={}, headers={"X-Service-Token": "wrong"})

    assert res.status_code == 401


@pytest.mark.parametrize("path,method", BACKEND_ONLY)
def test_backend_only_endpoint_accepts_valid_token(client, path, method):
    """올바른 토큰이면 인증을 통과한다.

    빈 본문이라 핸들러는 422(검증 실패)를 낸다 — 401이 아니라는 것이
    인증을 통과했다는 증거다.
    """
    res = getattr(client, method)(path, json={}, headers={"X-Service-Token": TOKEN})

    assert res.status_code != 401
    assert res.status_code != 503


def test_fails_closed_when_token_not_configured(monkeypatch):
    """토큰을 설정하지 않으면 열어두지 않고 막는다.

    설정을 잊었을 때 조용히 열린 상태로 남는 편이 훨씬 위험하다.
    """
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    with TestClient(main.app) as c:
        res = c.post("/mask", json={})

    assert res.status_code == 503


def test_token_comparison_is_not_prefix_based(client):
    """토큰의 앞부분만 맞아도 통과하면 안 된다."""
    res = client.post("/mask", json={}, headers={"X-Service-Token": TOKEN[:10]})

    assert res.status_code == 401


@pytest.mark.parametrize("path", ["/tts", "/stt"])
def test_browser_endpoints_stay_open(client, path):
    """브라우저가 직접 부르는 경로는 토큰 없이도 401이 되지 않는다.

    브라우저에 심은 토큰은 비밀이 아니라 의미가 없다. 이쪽은 레이트리밋으로
    막고 있고, 근본 해결은 백엔드 프록시로 옮기는 것이다(별도 과제).
    """
    res = client.get(path) if path == "/tts" else client.post(path)

    assert res.status_code != 401
    assert res.status_code != 503
