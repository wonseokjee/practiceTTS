"""`.env.example`이 코드와 어긋나는 것을 막는다.

배경: 백엔드가 ai-service 주소를 두 이름(AI_SERVICE_URL / FASTAPI_URL)으로
읽으면서 문서에는 하나만 있었다. 문서대로 설정하면 절반의 기능이 조용히
죽고, **부팅은 성공해서 런타임에만 깨진다.** 감사해보니 ai-service 쪽도
6개가 문서에 없고 1개(OPENAI_API_KEY)는 코드가 쓰지도 않는 잔재였다.

사람이 기억하는 방식이 실패했으므로 기계가 막는다.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_EXAMPLE = ROOT / ".env.example"

# 테스트 전용 스위치라 배포 설정이 아니다.
_TEST_ONLY = {"HOLDOUT"}

_PATTERNS = [
    re.compile(r"os\.environ\.get\(\s*[\"']([A-Z_0-9]+)[\"']"),
    re.compile(r"os\.getenv\(\s*[\"']([A-Z_0-9]+)[\"']"),
    re.compile(r"_int_env\(\s*[\"']([A-Z_0-9]+)[\"']"),
]

_SKIP_DIRS = {"venv", "__pycache__", ".git", "node_modules"}


def _collect_used() -> set[str]:
    used: set[str] = set()
    for path in ROOT.rglob("*.py"):
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        source = path.read_text(encoding="utf-8")
        for pattern in _PATTERNS:
            used.update(pattern.findall(source))
    return used - _TEST_ONLY


def _collect_declared() -> set[str]:
    declared: set[str] = set()
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        declared.add(line.split("=")[0].strip())
    return declared


def test_every_used_var_is_documented():
    missing = sorted(_collect_used() - _collect_declared())

    assert missing == [], f".env.example에 없는 환경변수: {missing}"


def test_no_leftover_vars_in_example():
    """설정했는데 아무 일도 안 일어나는 항목은 혼란만 만든다."""
    unused = sorted(_collect_declared() - _collect_used())

    assert unused == [], f"코드가 쓰지 않는 항목: {unused}"


def test_rate_limit_defaults_exceed_backend_per_user_limits():
    """전역 회로차단기가 백엔드 사용자별 한도보다 낮으면 병목이 된다.

    프록시 도입 후 이 서비스가 보는 IP는 전부 백엔드 하나다. 즉 IP 버킷이
    전역 한도가 됐다. 예전 값(tts 120 / stt 60)은 백엔드 한도(30 / 12)로
    나누면 동시 4~5명이면 포화라, 정상 사용자끼리 서로를 밀어냈을 것이다.
    """
    import dependencies

    tts = dependencies.get_tts_rate_limiter()
    stt = dependencies.get_stt_rate_limiter()

    # 백엔드 사용자당 한도 기준, 최소 10명은 동시에 쓸 수 있어야 한다.
    assert tts._max >= 30 * 10
    assert stt._max >= 12 * 10
