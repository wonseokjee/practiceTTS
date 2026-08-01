"""WishToPracticeService 단위 테스트 (Pattern 1).

검증:
  - LLM 정상 → echo + LLM 빈칸, fallback_used=False
  - LLM 깨짐/오류/타임아웃 → 규칙 기반 폴백, fallback_used=True (항상 200)
  - 정답이 한마디에 없으면(환각) 폴백으로 대체
  - 금칙어 한마디 → WishConversionError
  - echo_sentence는 항상 한마디 원문
"""
import asyncio
import json

import pytest

from domain.errors import GeminiApiError, WishConversionError
from interfaces.llm_client import ILlmClient
from models.wish import WishToPracticeRequest
from services.wish_service import WishToPracticeService


class FakeLlmClient(ILlmClient):
    def __init__(self, *, raw=None, error=None, delay=0.0):
        self._raw, self._error, self._delay = raw, error, delay
        self.call_count = 0
        self.captured_kwargs: list[dict] = []

    async def complete(self, messages, model, **kwargs) -> str:
        self.call_count += 1
        self.captured_kwargs.append(kwargs)
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error is not None:
            raise self._error
        return self._raw if self._raw is not None else "{}"

    async def complete_with_vision(self, *a, **k) -> str:
        raise NotImplementedError


def req(msg="보고 싶었어 우리 손녀"):
    return WishToPracticeRequest(wish_message=msg)


class TestLLM정상:
    async def test_echo는_한마디_원문이고_빈칸은_LLM결과다(self):
        raw = json.dumps(
            {"prompt": "보고 싶었어 우리 ___", "answer": "손녀", "hint_first_char": "손"},
            ensure_ascii=False,
        )
        svc = WishToPracticeService(FakeLlmClient(raw=raw))

        res = await svc.convert(req())

        assert res.echo_sentence == "보고 싶었어 우리 손녀"
        assert res.fallback_used is False
        assert res.fill_blank.answer == "손녀"
        assert "_" in res.fill_blank.prompt
        assert res.fill_blank.hint_first_char == "손"

    async def test_구조화출력_스키마를_강제한다(self):
        """LLM 호출 generation_config에 JSON 모드 + FillBlankOut 스키마가 실린다."""
        from models.wish import FillBlankOut

        raw = json.dumps(
            {"prompt": "보고 싶었어 우리 ___", "answer": "손녀", "hint_first_char": "손"},
            ensure_ascii=False,
        )
        fake = FakeLlmClient(raw=raw)

        await WishToPracticeService(fake).convert(req())

        gc = fake.captured_kwargs[0]["generation_config"]
        assert gc["response_mime_type"] == "application/json"
        assert gc["response_schema"] is FillBlankOut


class TestLLM실패시폴백:
    async def test_JSON깨짐이면_규칙기반_폴백한다(self):
        svc = WishToPracticeService(FakeLlmClient(raw="이건 JSON 아님"))

        res = await svc.convert(req())

        assert res.fallback_used is True
        assert "_" in res.fill_blank.prompt
        # 폴백 정답은 한마디 안의 토큰
        assert res.fill_blank.answer.replace(" ", "") in req().wish_message.replace(" ", "")

    async def test_LLM오류면_폴백하고_200을_보장한다(self):
        svc = WishToPracticeService(FakeLlmClient(error=GeminiApiError("down")))

        res = await svc.convert(req())

        assert res.fallback_used is True
        assert res.echo_sentence == req().wish_message

    async def test_타임아웃이면_폴백한다(self, monkeypatch):
        from services import wish_service as mod

        monkeypatch.setattr(mod, "_LLM_TIMEOUT_SECONDS", 0.05)
        svc = WishToPracticeService(FakeLlmClient(raw="{}", delay=0.3))

        res = await svc.convert(req())

        assert res.fallback_used is True

    async def test_정답이_한마디에_없으면_폴백으로_대체한다(self):
        # LLM이 한마디에 없는 단어를 정답으로 줌(환각)
        raw = json.dumps(
            {"prompt": "___를 사랑해", "answer": "비행기", "hint_first_char": "비"},
            ensure_ascii=False,
        )
        svc = WishToPracticeService(FakeLlmClient(raw=raw))

        res = await svc.convert(req("우리 손녀 사랑해"))

        assert res.fallback_used is True
        assert res.fill_blank.answer != "비행기"


class TestGuard:
    async def test_금칙어_한마디는_WishConversionError(self):
        svc = WishToPracticeService(FakeLlmClient(raw="{}"))

        with pytest.raises(WishConversionError):
            await svc.convert(req("사고 나서 무서웠어"))

    async def test_빈_한마디는_Pydantic이_거부한다(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            WishToPracticeRequest(wish_message="   ")
