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
# 마스킹 모델 (gemini-2.0-flash는 retired되어 404 → 2.5-flash로 교체)
_MASKING_MODEL = "gemini-2.5-flash"

# 페르소나 토큰(예: [손자1], [장소1]).
#
# backend가 프로필의 실명·지명을 미리 치환해 넣은 자리표시자다. 이미 익명화된
# 값이라 마스킹 대상이 아니며, 훼손되면 backend의 역치환이 실패해 환자에게
# 실명 대신 라벨이나 [Family_M1] 같은 찌꺼기가 노출된다.
# 프롬프트로도 "무시하라"고 지시하지만, LLM 준수를 믿지 않고 코드로 강제한다.
_PERSONA_TOKEN_PATTERN = re.compile(r"\[[^\[\]\n]{1,30}\]")

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

    1단계: 정규식으로 전화번호/주민번호/이메일을 **Gemini 호출 전에** 치환
    2단계: Gemini로 이름/장소명 감지 후 익명 식별자로 치환

    ── 신뢰 경계에 대한 정직한 서술 (과대평가 금지) ───────────────
    이 서비스는 "PII가 외부 LLM에 절대 닿지 않게" 만들지 못한다. 2단계는 이름·장소
    **감지 자체를 Gemini에 의뢰**하므로, 정규식으로 잡지 못하는 PII(사람 이름,
    기관명, 주소 등)는 감지되기 위해 Gemini를 한 번 거친다. 그 결과는 사후 치환이다.

    실제 방어선은 두 겹이고, 각자 덮는 범위가 다르다:
      1. 페르소나 토큰화(backend) — 프로필에 등록된 가족·장소를 LLM에 보내기 전에
         [손자1]/[장소1]로 치환. 외부에 원문이 나가지 않는 유일한 층.
      2. 정규식 마스킹(여기 1단계) — 전화·주민번호·이메일. 형태가 확실해 사전 치환 가능.
      3. Gemini 감지(여기 2단계) — 나머지 이름·장소. **원문이 Gemini를 거친다.**

    즉 미등록 인물·기관명은 Gemini에 노출된다. 이를 없애려면 로컬 NER 등
    외부 호출 없는 감지기가 필요하다(별도 과제).
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

        # 2-1. 이미 익명화된 페르소나 토큰을 보호 대상으로 수집
        persona_tokens = set(_PERSONA_TOKEN_PATTERN.findall(raw_text))

        # 3. 정규식 1차 마스킹 (전화번호, 주민번호, 이메일)
        text_after_regex = self._apply_regex_masking(raw_text, entity_map)

        # 4. Gemini 2차 마스킹 (이름, 장소명)
        try:
            gemini_entities = await self._detect_pii_with_gemini(text_after_regex)
            self._merge_gemini_entities(
                gemini_entities, entity_map, persona_tokens
            )
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
        """정규식으로 전화번호/주민번호/이메일을 감지·치환한 텍스트를 반환한다.

        중요: 감지만 하고 원문을 그대로 돌려주면, 그 원문이 _detect_pii_with_gemini를
        통해 외부 LLM으로 나간다(마스킹이 사후 라벨링에 그친다). 정규식으로 확실히
        잡을 수 있는 PII는 Gemini에 보내기 **전에** 실제로 치환해야 한다.
        """
        counters: dict[str, int] = {"phone": 0, "ssn": 0, "email": 0}
        masked = text

        for pattern_name, pattern in _PATTERNS.items():
            # 원문 기준으로 수집한 뒤 치환한다(치환 중 finditer가 흔들리지 않도록).
            for match in pattern.finditer(text):
                original = match.group()
                if original not in entity_map:
                    counters[pattern_name] += 1
                    label = f"{pattern_name.upper()}_{counters[pattern_name]}"
                    entity_map[original] = label

        # 긴 원본부터 치환(부분 문자열 오치환 방지)
        for original in sorted(entity_map.keys(), key=len, reverse=True):
            masked = masked.replace(original, entity_map[original])

        return masked

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

    @staticmethod
    def _overlaps_persona_token(original: str, persona_tokens: set[str]) -> bool:
        """감지된 원본이 페르소나 토큰과 겹치는지 판단.

        Gemini가 "[손자1]" 전체를 사람 이름으로 잡거나("original" == 토큰),
        "손자1"/"장소" 처럼 토큰 내부 일부만 잡는 경우를 모두 걸러낸다.
        """
        return any(
            original in token or token in original for token in persona_tokens
        )

    def _merge_gemini_entities(
        self,
        entities: list[dict],
        entity_map: dict[str, str],
        persona_tokens: set[str] | None = None,
    ) -> None:
        """Gemini 감지 결과를 entity_map에 병합.

        페르소나 토큰과 겹치는 감지 결과는 무시한다 — 이미 익명화된 자리표시자를
        다시 치환하면 backend의 역치환이 깨진다.
        """
        person_counters: dict[str, int] = {"M": 0, "F": 0, "U": 0}
        place_counter = 0
        tokens = persona_tokens or set()

        for entity in entities:
            original = entity.get("original", "").strip()
            entity_type = entity.get("type", "")
            if not original or original in entity_map:
                continue
            if self._overlaps_persona_token(original, tokens):
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
