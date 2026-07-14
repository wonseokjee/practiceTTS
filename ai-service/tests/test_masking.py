"""MaskingService 테스트 — 특히 페르소나 토큰 보존 (Gemini 실호출 없이 mock).

핵심 회귀: backend가 실명을 [손자1]/[장소1] 토큰으로 치환해 보내는데, /mask가
그 토큰을 다시 Family_M1 등으로 치환해버리면 backend의 역치환이 깨져 환자에게
실명 대신 라벨이나 [Family_M1] 찌꺼기가 노출된다.
"""
import json

import pytest

from infra.in_memory_masking_store import InMemoryMaskingStore
from services.masking_service import MaskingService

ENTRY_ID = "11111111-1111-1111-1111-111111111111"


class FakeLlm:
    """지정한 entities JSON을 그대로 돌려주는 가짜 LLM."""

    def __init__(self, entities: list[dict]) -> None:
        self._entities = entities
        self.prompts: list[str] = []

    async def complete(self, messages, model):  # noqa: ANN001
        self.prompts.append(messages[-1]["content"])
        return json.dumps({"entities": self._entities})


def build_service(entities: list[dict]) -> tuple[MaskingService, FakeLlm]:
    llm = FakeLlm(entities)
    return MaskingService(llm_client=llm, masking_store=InMemoryMaskingStore()), llm


# ── 페르소나 토큰 보존 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_persona_token_survives_when_gemini_flags_whole_token():
    """Gemini가 '[손자1]' 전체를 사람 이름으로 잡아도 토큰은 살아남는다."""
    service, _ = build_service(
        [{"original": "[손자1]", "type": "person", "gender": "M"}]
    )

    result = await service.mask_text("[손자1]이랑 바다에 갔어요", ENTRY_ID)

    assert "[손자1]" in result.masked_text
    assert "Family_" not in result.masked_text


@pytest.mark.asyncio
async def test_persona_token_survives_when_gemini_flags_inner_text():
    """Gemini가 토큰 내부('손자1')만 잡아도 토큰은 훼손되지 않는다."""
    service, _ = build_service(
        [{"original": "손자1", "type": "person", "gender": "M"}]
    )

    result = await service.mask_text("[손자1]과 산책했어요", ENTRY_ID)

    assert result.masked_text == "[손자1]과 산책했어요"


@pytest.mark.asyncio
async def test_place_token_survives():
    service, _ = build_service([{"original": "[장소1]", "type": "place"}])

    result = await service.mask_text("[장소1]에 다녀왔어요", ENTRY_ID)

    assert "[장소1]" in result.masked_text
    assert "Place_" not in result.masked_text


@pytest.mark.asyncio
async def test_real_pii_still_masked_alongside_tokens():
    """토큰은 보존하되, 토큰 밖의 진짜 PII는 그대로 마스킹해야 한다."""
    service, _ = build_service(
        [
            {"original": "[손자1]", "type": "person", "gender": "M"},
            {"original": "삼성서울병원", "type": "place"},
        ]
    )

    result = await service.mask_text(
        "[손자1]이랑 삼성서울병원에 갔어요", ENTRY_ID
    )

    assert "[손자1]" in result.masked_text  # 토큰 보존
    assert "삼성서울병원" not in result.masked_text  # 실제 PII는 익명화
    assert "Place_1" in result.masked_text


# ── 기존 마스킹 동작 (회귀) ───────────────────────────────────


@pytest.mark.asyncio
async def test_masks_person_and_place_without_tokens():
    service, _ = build_service(
        [
            {"original": "홍길동", "type": "person", "gender": "M"},
            {"original": "강남구", "type": "place"},
        ]
    )

    result = await service.mask_text("홍길동과 강남구에 갔다", ENTRY_ID)

    assert "홍길동" not in result.masked_text
    assert "강남구" not in result.masked_text
    assert result.entity_count == 2


@pytest.mark.asyncio
async def test_entity_map_not_exposed_in_result():
    """entity_map은 응답에 실려선 안 된다(외부 미전달 규칙)."""
    service, _ = build_service(
        [{"original": "홍길동", "type": "person", "gender": "M"}]
    )

    result = await service.mask_text("홍길동과 갔다", ENTRY_ID)

    assert not hasattr(result, "entity_map")
