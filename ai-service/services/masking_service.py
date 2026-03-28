"""
텍스트 PII 마스킹 유스케이스 (UC-2: MaskText).
ILlmClient, IMaskingStore 인터페이스에만 의존하며 구현체는 생성자로 주입받는다.

보안 규칙:
  - entity_map은 외부 응답에 절대 포함 금지
  - entity_map은 Gemini API에도 전송 금지
  - entity_map은 IMaskingStore에만 저장
"""
import json
import re

from domain.entities import MaskingResult
from domain.errors import GeminiApiError, ResidualPiiError, TextTooLongError
from interfaces.llm_client import ILlmClient
from interfaces.masking_store import IMaskingStore
from prompts.masking_prompt import MASKING_SYSTEM_PROMPT

# 최대 입력 텍스트 길이
_MAX_TEXT_LENGTH = 5000
# 마스킹 모델 (빠른 flash 모델 사용)
_MASKING_MODEL = "gemini-2.0-flash"

# 정규식 패턴: 1차 마스킹 대상
_PATTERNS = {
    "phone": re.compile(
        r"\b(?:0\d{1,2}[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b"
    ),
    "ssn": re.compile(
        r"\b\d{6}[-\s]?\d{7}\b"
    ),
    "email": re.compile(
        r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"
    ),
}


class MaskingService:
    """텍스트 PII 마스킹 서비스.

    1단계: 정규식으로 전화번호/주민번호/이메일 마스킹
    2단계: Gemini로 이름/장소명 감지 후 익명 식별자로 치환
    """

    def __init__(
        self,
        llm_client: ILlmClient,
        masking_store: IMaskingStore,
    ) -> None:
        self._llm = llm_client
        self._store = masking_store

    async def mask_text(
        self,
        raw_text: str,
        memory_entry_id: str,
    ) -> MaskingResult:
        """원본 텍스트를 마스킹하여 MaskingResult 반환.

        Args:
            raw_text: 원본 에피소드 텍스트
            memory_entry_id: entity_map 저장 키 (UUID)

        Returns:
            MaskingResult (masked_text, entity_count). entity_map 미포함.

        Raises:
            TextTooLongError: 텍스트 5000자 초과
            ResidualPiiError: 마스킹 후 원본 식별자 잔존
        """
        # 1. 텍스트 길이 검증
        if len(raw_text) > _MAX_TEXT_LENGTH:
            raise TextTooLongError(
                f"입력 텍스트({len(raw_text)}자)가 허용 한도({_MAX_TEXT_LENGTH}자)를 초과했습니다"
            )

        # 2. entity_map 초기화 (원본 → 익명 식별자)
        entity_map: dict[str, str] = {}

        # 3. 정규식 1차 마스킹 (전화번호, 주민번호, 이메일)
        text_after_regex = self._apply_regex_masking(raw_text, entity_map)

        # 4. Gemini 2차 마스킹 (이름, 장소명)
        try:
            gemini_entities = await self._detect_pii_with_gemini(text_after_regex)
            self._merge_gemini_entities(gemini_entities, entity_map)
        except GeminiApiError:
            # Gemini API 실패 시 정규식 결과만으로 부분 마스킹 진행 (UC-2 예외 흐름)
            pass

        # 5. entity_map 기반 텍스트 치환
        masked_text = self._apply_entity_map(raw_text, entity_map)

        # 6. entity_map을 IMaskingStore에 저장 (외부 미전달)
        await self._store.save(memory_entry_id, entity_map)

        # 7. 잔존 PII 검증
        self._verify_no_residual_pii(masked_text, entity_map)

        return MaskingResult(
            masked_text=masked_text,
            entity_count=len(entity_map),
        )

    def _apply_regex_masking(
        self,
        text: str,
        entity_map: dict[str, str],
    ) -> str:
        """정규식으로 전화번호/주민번호/이메일을 감지하고 entity_map에 추가."""
        counters: dict[str, int] = {"phone": 0, "ssn": 0, "email": 0}

        for pattern_name, pattern in _PATTERNS.items():
            for match in pattern.finditer(text):
                original = match.group()
                if original not in entity_map:
                    counters[pattern_name] += 1
                    label = f"{pattern_name.upper()}_{counters[pattern_name]}"
                    entity_map[original] = label

        return text

    async def _detect_pii_with_gemini(
        self,
        text: str,
    ) -> list[dict]:
        """Gemini에게 이름/장소명 감지 요청.

        Returns:
            [{"original": str, "type": "person"|"place", "gender": "M"|"F"|"U"}]
        """
        messages = [
            {"role": "system", "content": MASKING_SYSTEM_PROMPT},
            {"role": "user", "content": f"다음 텍스트에서 개인 식별 정보를 찾아주세요:\n\n{text}"},
        ]
        raw_response = await self._llm.complete(
            messages=messages,
            model=_MASKING_MODEL,
        )

        # 마크다운 코드펜스 제거 후 파싱
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1]).strip()

        data = json.loads(cleaned)
        return data.get("entities", [])

    def _merge_gemini_entities(
        self,
        entities: list[dict],
        entity_map: dict[str, str],
    ) -> None:
        """Gemini 감지 결과를 entity_map에 병합."""
        person_counters: dict[str, int] = {"M": 0, "F": 0, "U": 0}
        place_counter = 0

        for entity in entities:
            original = entity.get("original", "").strip()
            entity_type = entity.get("type", "")
            if not original or original in entity_map:
                continue

            if entity_type == "person":
                gender = entity.get("gender", "U").upper()
                if gender not in person_counters:
                    gender = "U"
                person_counters[gender] += 1
                gender_label = {"M": "M", "F": "F", "U": "X"}[gender]
                entity_map[original] = f"Family_{gender_label}{person_counters[gender]}"

            elif entity_type == "place":
                place_counter += 1
                entity_map[original] = f"Place_{place_counter}"

    def _apply_entity_map(
        self,
        text: str,
        entity_map: dict[str, str],
    ) -> str:
        """원본 텍스트에 entity_map을 적용하여 치환된 텍스트 반환."""
        result = text
        # 긴 원본값을 먼저 치환 (부분 문자열 오치환 방지)
        for original in sorted(entity_map.keys(), key=len, reverse=True):
            result = result.replace(original, entity_map[original])
        return result

    def _verify_no_residual_pii(
        self,
        masked_text: str,
        entity_map: dict[str, str],
    ) -> None:
        """마스킹된 텍스트에 원본 식별자가 잔존하는지 검증.

        Raises:
            ResidualPiiError: 원본 식별자가 하나라도 잔존하는 경우
        """
        for original in entity_map.keys():
            if original in masked_text:
                raise ResidualPiiError(
                    f"마스킹 후에도 식별자가 텍스트에 잔존합니다: '{original}'"
                )
