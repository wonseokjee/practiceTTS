"""GeminiClient 오류 분리 — 차단·빈 응답·시간 초과·429를 이름 붙은 예외로.

예전에는 안전 필터 차단 시 `response.text`(None)를 예외 없이 돌려줬고, 모든
실패를 `except Exception` 하나로 GeminiApiError에 묶었다. 그래서 호출부에서
`None.strip()`이 AttributeError로 터졌다(마스킹은 degraded로 못 내려가고 500).
"""
import base64
import io
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors as genai_errors
from google.genai import types

from domain.errors import (
    GeminiApiError,
    GeminiBlockedError,
    GeminiEmptyResponseError,
    GeminiRateLimitError,
    GeminiTimeoutError,
)
from infra.gemini_client import GeminiClient
from infra.in_memory_masking_store import InMemoryMaskingStore
from services.masking_service import MaskingService


class _FakeModels:
    def __init__(self, outcome: object) -> None:
        self._outcome = outcome

    async def generate_content(self, **_kwargs):  # noqa: ANN003
        if isinstance(self._outcome, BaseException):
            raise self._outcome
        return self._outcome


def _client(outcome: object) -> GeminiClient:
    client = GeminiClient(api_key="test-key")
    client._client = SimpleNamespace(aio=SimpleNamespace(models=_FakeModels(outcome)))
    return client


def _response(text, *, block_reason=None, finish_reason=None):  # noqa: ANN001
    return SimpleNamespace(
        text=text,
        prompt_feedback=SimpleNamespace(block_reason=block_reason),
        candidates=[SimpleNamespace(finish_reason=finish_reason)]
        if finish_reason is not None
        else [],
    )


MESSAGES = [{"role": "user", "content": "안녕"}]


async def _complete(outcome: object) -> str:
    return await _client(outcome).complete(MESSAGES, model="gemini-test")


class TestTextExtraction:
    async def test_정상_응답은_텍스트를_그대로_돌려준다(self):
        assert await _complete(_response('{"ok": true}')) == '{"ok": true}'

    async def test_프롬프트_차단은_Blocked(self):
        with pytest.raises(GeminiBlockedError, match="프롬프트"):
            await _complete(_response(None, block_reason=types.BlockedReason.SAFETY))

    @pytest.mark.parametrize(
        "reason",
        [
            types.FinishReason.SAFETY,
            types.FinishReason.PROHIBITED_CONTENT,
            types.FinishReason.BLOCKLIST,
            types.FinishReason.SPII,
            types.FinishReason.RECITATION,
        ],
    )
    async def test_응답_차단_finish_reason은_Blocked(self, reason):
        with pytest.raises(GeminiBlockedError):
            await _complete(_response(None, finish_reason=reason))

    @pytest.mark.parametrize(
        "response",
        [
            _response(None),
            _response(""),
            _response("   \n"),
            _response(None, finish_reason=types.FinishReason.STOP),
            # 토큰 한도로 잘려 텍스트가 없는 것은 정책 차단이 아니다
            _response(None, finish_reason=types.FinishReason.MAX_TOKENS),
        ],
    )
    async def test_차단_표시_없이_비면_Empty(self, response):
        with pytest.raises(GeminiEmptyResponseError):
            await _complete(response)


class TestTransportErrors:
    async def test_HTTP_타임아웃은_Timeout(self):
        with pytest.raises(GeminiTimeoutError):
            await _complete(httpx.ReadTimeout("read timed out"))

    async def test_429는_RateLimit(self):
        exc = genai_errors.ClientError(
            429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}
        )
        with pytest.raises(GeminiRateLimitError):
            await _complete(exc)

    async def test_그_밖의_API_오류는_하위_분류_없는_GeminiApiError(self):
        exc = genai_errors.ClientError(
            400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}}
        )
        with pytest.raises(GeminiApiError) as info:
            await _complete(exc)
        assert type(info.value) is GeminiApiError

    async def test_원인_예외가_보존된다(self):
        original = httpx.ConnectTimeout("connect")
        with pytest.raises(GeminiTimeoutError) as info:
            await _complete(original)
        assert info.value.__cause__ is original


@pytest.mark.parametrize(
    "cls",
    [GeminiBlockedError, GeminiEmptyResponseError, GeminiTimeoutError, GeminiRateLimitError],
)
def test_하위_클래스는_모두_GeminiApiError다(cls):
    """기존 호출부의 `except GeminiApiError`(502·degraded)가 그대로 잡는다."""
    assert issubclass(cls, GeminiApiError)


async def test_vision도_빈_응답을_예외로_바꾼다():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="PNG")
    image_b64 = base64.b64encode(buf.getvalue()).decode()

    with pytest.raises(GeminiBlockedError):
        await _client(
            _response(None, finish_reason=types.FinishReason.IMAGE_SAFETY)
        ).complete_with_vision("태그를 붙여 주세요", image_b64, model="gemini-test")


async def test_마스킹은_차단_응답에서_500이_아니라_degraded로_내려간다():
    """호출부 계약 — 예전엔 None.strip()이 AttributeError로 터져 라우터가 500을 냈다."""
    blocked = _client(_response(None, finish_reason=types.FinishReason.SAFETY))
    service = MaskingService(llm_client=blocked, masking_store=InMemoryMaskingStore())

    result = await service.mask_text("남편 이름은 박정호예요", "entry-1")

    assert result.degraded is True
