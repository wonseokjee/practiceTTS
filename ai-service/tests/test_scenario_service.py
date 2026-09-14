"""ScenarioService 보안 회귀 테스트.

gstack /cso 2026-09-14 발견 2건 수정 검증: masked_context/emotion_tag가
system_instruction(=role:"system" 메시지)에 섞이지 않고 user 턴으로만 전달되는지
확인한다. 이전엔 이 서비스에 테스트가 전혀 없었다 — 최소 회귀 가드만 추가한다.
"""
import json

import pytest

from interfaces.llm_client import ILlmClient
from interfaces.vector_store import IVectorStore
from services.scenario_service import ScenarioService


class FakeLlmClient(ILlmClient):
    def __init__(self, *, raw: str):
        self._raw = raw
        self.captured_messages: list[list[dict]] = []

    async def complete(self, messages, model, **kwargs) -> str:
        self.captured_messages.append(messages)
        return self._raw

    async def complete_with_vision(self, *args, **kwargs) -> str:
        raise NotImplementedError


class FakeVectorStore(IVectorStore):
    async def upsert(self, doc_id: str, text: str, metadata: dict) -> None:
        pass

    async def search(self, query: str, top_k: int = 3) -> list[dict]:
        return []

    async def delete(self, doc_id: str) -> None:
        pass


def valid_scenario_json() -> str:
    return json.dumps(
        {
            "opening_question": "오늘은 어디에 다녀오셨나요?",
            "context_summary": "공원에서 산책하며 즐거운 시간을 보냈다.",
            "scene_description": "화창한 공원",
        },
        ensure_ascii=False,
    )


class Test시스템프롬프트에_자유텍스트_미포함:
    """masked_context/emotion_tag는 user 턴에만 실려야 한다(★ 핵심 보안 회귀)."""

    async def test_masked_context는_system_메시지에_없고_user_메시지에만_있다(self):
        # Arrange
        fake_llm = FakeLlmClient(raw=valid_scenario_json())
        service = ScenarioService(fake_llm, FakeVectorStore())
        secret_marker = "[아들1]과 공원에서 산책했다-마커12345"

        # Act
        await service.generate_scenario(
            masked_context=secret_marker,
            target_words=["산책"],
            emotion_tag="happy",
            memory_entry_id="mem-1",
        )

        # Assert
        assert fake_llm.captured_messages, "LLM이 호출되지 않았다"
        messages = fake_llm.captured_messages[0]
        system_texts = [m["content"] for m in messages if m["role"] == "system"]
        user_texts = [m["content"] for m in messages if m["role"] == "user"]

        assert not any(secret_marker in t for t in system_texts), (
            "masked_context가 system(=system_instruction) 메시지로 유출됨"
        )
        assert any(secret_marker in t for t in user_texts), (
            "masked_context가 user 메시지 어디에도 없음"
        )

    async def test_emotion_tag도_system_메시지에_없다(self):
        fake_llm = FakeLlmClient(raw=valid_scenario_json())
        service = ScenarioService(fake_llm, FakeVectorStore())

        await service.generate_scenario(
            masked_context="평범한 하루였다",
            target_words=["산책"],
            emotion_tag="극비-감정태그-마커999",
            memory_entry_id="mem-1",
        )

        messages = fake_llm.captured_messages[0]
        system_texts = [m["content"] for m in messages if m["role"] == "system"]
        assert not any("극비-감정태그-마커999" in t for t in system_texts)
