"""MaskingService 테스트 — 특히 페르소나 토큰 보존 (Gemini 실호출 없이 mock).

핵심 회귀: backend가 실명을 [손자1]/[장소1] 토큰으로 치환해 보내는데, /mask가
그 토큰을 다시 Family_M1 등으로 치환해버리면 backend의 역치환이 깨져 환자에게
실명 대신 라벨이나 [Family_M1] 찌꺼기가 노출된다.
"""
import json

import pytest

from domain.errors import GeminiApiError
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


# ── 정규식 PII는 Gemini에 나가기 전에 치환된다 ────────────────
#
# 회귀 배경: _apply_regex_masking이 entity_map만 채우고 원문을 그대로 반환해,
# 그 원문이 _detect_pii_with_gemini로 나갔다. 즉 마스킹이 Gemini 응답을 사후
# 라벨링할 뿐이라 전화번호·주민번호·이메일이 외부 LLM을 그대로 거쳤다.


@pytest.mark.asyncio
async def test_phone_not_sent_to_gemini():
    service, llm = build_service([])

    await service.mask_text("연락처는 010-1234-5678 이에요", ENTRY_ID)

    sent = llm.prompts[0]
    assert "010-1234-5678" not in sent
    assert "PHONE_1" in sent


@pytest.mark.asyncio
async def test_ssn_and_email_not_sent_to_gemini():
    service, llm = build_service([])

    await service.mask_text(
        "주민번호 900101-1234567, 메일 hong@example.com", ENTRY_ID
    )

    sent = llm.prompts[0]
    assert "900101-1234567" not in sent
    assert "hong@example.com" not in sent
    assert "SSN_1" in sent
    assert "EMAIL_1" in sent


@pytest.mark.asyncio
async def test_regex_pii_still_masked_in_result():
    """Gemini로 나가는 텍스트뿐 아니라 최종 결과에서도 여전히 마스킹된다."""
    service, _ = build_service([])

    result = await service.mask_text("전화 010-1234-5678", ENTRY_ID)

    assert "010-1234-5678" not in result.masked_text
    assert "PHONE_1" in result.masked_text


@pytest.mark.asyncio
async def test_persona_token_survives_regex_masking():
    """정규식 치환이 페르소나 토큰을 건드리지 않는다."""
    service, llm = build_service([])

    result = await service.mask_text(
        "[손자1]에게 010-1234-5678로 전화했어요", ENTRY_ID
    )

    assert "[손자1]" in llm.prompts[0]  # Gemini에 나갈 때도 토큰 보존
    assert "[손자1]" in result.masked_text
    assert "010-1234-5678" not in result.masked_text


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


class TestDegradedSignal:
    """Gemini 실패를 호출자에게 알리는지 (fail-open 회귀 방지).

    예전에는 `except GeminiApiError: pass`로 조용히 넘어가, 실명이 남은
    텍스트가 "마스킹 완료" 200으로 반환됐다. 잔존 검증은 entity_map에 있는
    키만 보므로 감지 실패한 PII는 원리상 절대 잡지 못한다.
    """

    @pytest.mark.asyncio
    async def test_gemini_failure_marks_result_degraded(self):
        class FailingLlm:
            async def complete(self, messages, model):  # noqa: ANN001
                raise GeminiApiError("타임아웃")

        service, _ = build_service([])
        service._llm = FailingLlm()
        result = await service.mask_text("남편 이름은 박정호예요", "entry-1")

        assert result.degraded is True

    @pytest.mark.asyncio
    async def test_successful_masking_is_not_degraded(self):
        service, _ = build_service([])
        result = await service.mask_text("평범한 문장입니다", "entry-2")

        assert result.degraded is False


# ── 영어(en-US) 메모 ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_english_phone_and_person_masked_before_gemini():
    """영어 메모의 미국 전화·호칭 인명은 Gemini에 가기 전에 로컬에서 가려진다."""
    service, llm = build_service([])
    result = await service.mask_text(
        "Call (212) 555-0123 and ask for Dr. Patel about my son Michael",
        ENTRY_ID,
        lang="en-US",
    )
    assert "555-0123" not in result.masked_text
    assert "212" not in result.masked_text
    assert "Patel" not in result.masked_text
    assert "Michael" not in result.masked_text
    # Gemini로 나간 프롬프트에도 원문이 없다
    assert all("555-0123" not in p and "Patel" not in p for p in llm.prompts)


@pytest.mark.asyncio
async def test_english_years_and_amounts_untouched():
    service, _ = build_service([])
    text = "In 1953 we paid $1,500 for the car"
    result = await service.mask_text(text, ENTRY_ID, lang="en-US")
    assert result.masked_text == text


@pytest.mark.asyncio
async def test_english_labels_not_duplicated_across_layers():
    """영어 계층과 한국 정규식이 각자 전화를 잡아도 같은 라벨을 두 번 쓰지 않는다."""
    service, _ = build_service([])
    result = await service.mask_text(
        "Home (212) 555-0123 and mobile 010-1234-5678", ENTRY_ID, lang="en-US"
    )
    labels = [w for w in result.masked_text.split() if w.startswith("PHONE_")]
    assert len(labels) == len(set(labels)) == 2


@pytest.mark.asyncio
async def test_unsupported_lang_rejected_not_defaulted_to_korean():
    from services.masking_service import UnsupportedMaskingLangError

    service, _ = build_service([])
    with pytest.raises(UnsupportedMaskingLangError):
        await service.mask_text("agua", ENTRY_ID, lang="es-US")


@pytest.mark.asyncio
async def test_korean_default_unchanged():
    service, _ = build_service([])
    result = await service.mask_text("연락처는 010-1234-5678이에요", ENTRY_ID)
    assert "5678" not in result.masked_text
