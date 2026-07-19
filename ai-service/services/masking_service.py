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
from constants.korean_pii import detect_korean_pii
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

# 이미 부여한 익명 라벨(Family_X1, Place_2, PHONE_1 …). 사전 치환으로 만든 라벨이
# 섞인 텍스트를 Gemini에 보내면, Gemini가 라벨 주변을 통째로 한 entity로 반환할 수
# 있다("서울시 Place_1 역삼동"). 그 값은 원문에 없어 최종 치환에 실패하고 잔존
# 검사에 걸린다. 라벨을 포함한 감지 결과는 무시한다(이미 익명화된 값).
_EXISTING_LABEL_PATTERN = re.compile(r"(?:Family_[MFX]|Place|PHONE|SSN|EMAIL)_\d+")

# 정규식 패턴: 1차 마스킹 대상
#
# 경계에 \b를 쓰면 안 된다. 한글은 \w라서 "010-1234-5678도"의 끝에는 단어 경계가
# 없고, 그러면 백트래킹으로 "010-1234"까지만 매치돼 **뒤 네 자리가 그대로 외부로
# 나간다.** "011-987-6543로"는 아예 매치되지 않았다. 숫자가 아님을 보는
# lookaround로 경계를 잡아야 조사가 붙어도 온전히 잡힌다.
# 전화번호로 보려면 **구조**가 있어야 한다. 경계만 느슨하게 풀었더니
# "1500000원을 냈어요"의 금액까지 전화번호로 잡혀 노트 원문이 망가졌다
# ("PHONE_1원을 냈어요"). 구분자도 국번 접두도 없는 맨 7~8자리는 전화번호로
# 볼 근거가 없다. 둘 중 하나는 있어야 잡는다:
#   ① 0으로 시작하는 국번(02/010/011/031…)  ② 자리 사이 구분자(- . 공백)
_PATTERNS = {
    "phone": re.compile(
        r"(?<![0-9])(?:"
        # ① 국번 접두가 있는 경우 — 구분자는 없어도 된다 (01012345678)
        r"0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}"
        r"|"
        # ② 국번이 없으면 구분자가 반드시 있어야 한다 (987-6543)
        r"\d{3,4}[-.\s]\d{4}"
        r")(?![0-9])"
    ),
    "ssn": re.compile(
        r"(?<![0-9])\d{6}[-\s]?\d{7}(?![0-9])"
    ),
    # 주민번호 뒷자리는 맨 7자리라 금액·날짜와 구별할 수 없다. 앞말이
    # 신분증임을 밝힐 때만 잡고, 숫자 부분(그룹 1)만 가린다.
    "ssn_tail": re.compile(
        r"(?:주민(?:등록)?번호|뒷자리)[^0-9]{0,10}(?<![0-9])(\d{6,7})(?![0-9])"
    ),
    "email": re.compile(
        r"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.\-])"
    ),
}


class MaskingService:
    """텍스트 PII 마스킹 서비스.

    1단계: 정규식으로 전화번호/주민번호/이메일을 **Gemini 호출 전에** 치환
    2단계: 한국어 사전으로 호칭 인명·기관명·광역지명을 **Gemini 호출 전에** 치환
    3단계: Gemini로 나머지 이름/장소명 감지 후 익명 식별자로 치환

    ── 신뢰 경계에 대한 정직한 서술 (과대평가 금지) ───────────────
    이 서비스는 "PII가 외부 LLM에 절대 닿지 않게" 만들지 못한다. 3단계는 이름·장소
    **감지 자체를 Gemini에 의뢰**하므로, 앞 두 단계가 못 잡은 PII는 감지되기 위해
    Gemini를 한 번 거친다. 그 결과는 사후 치환이다.

    방어선은 네 겹이고, 각자 덮는 범위가 다르다:
      1. 페르소나 토큰화(backend) — 프로필에 등록된 가족·장소. 외부에 원문 안 나감.
      2. 정규식(1단계) — 전화·주민번호·이메일. 형태가 확실해 사전 치환.
      3. 한국어 사전(2단계) — '앵커가 확실한' 인명(성+이름+직함)·기관명(○○병원)·
         광역지명(강남구). 사전 치환. 높은 정밀도·낮은 재현율.
      4. Gemini 감지(3단계) — 나머지(앵커 없는 맨이름, 세부 동/읍/면 등).
         **원문이 Gemini를 거친다.**

    즉 4층에 남는 PII는 여전히 Gemini에 노출된다. 완전 차단은 로컬 NER 등 외부
    호출 없는 감지기가 필요하다(별도 과제: project_local-ner-pii-debt).
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

        # 3. 정규식 1차 마스킹 (전화번호, 주민번호, 이메일) — Gemini 전에 치환
        text_after_regex = self._apply_regex_masking(raw_text, entity_map)

        # 3-1. 한국어 사전 마스킹 (호칭 인명·기관명·광역지명) — Gemini 전에 치환.
        #      감지를 외부에 의뢰하지 않고 여기서 확실한 것부터 가려, 원문이
        #      Gemini로 새는 양을 줄인다.
        text_after_korean = self._apply_korean_pii_masking(
            text_after_regex, entity_map, persona_tokens
        )

        # 4. Gemini 3차 마스킹 (사전 필터가 못 잡은 나머지 이름·장소명)
        try:
            gemini_entities = await self._detect_pii_with_gemini(text_after_korean)
            self._assign_labels(gemini_entities, entity_map, persona_tokens)
        except GeminiApiError:
            # Gemini API 실패 시 앞 단계 결과만으로 부분 마스킹 진행 (UC-2 예외 흐름)
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
        counters: dict[str, int] = {name: 0 for name in _PATTERNS}
        masked = text

        for pattern_name, pattern in _PATTERNS.items():
            # 원문 기준으로 수집한 뒤 치환한다(치환 중 finditer가 흔들리지 않도록).
            for match in pattern.finditer(text):
                # 캡처 그룹이 있으면 그 부분만 가린다. 앵커까지 함께 가리면
                # "주민번호 뒷자리 2031117" 전체가 라벨로 바뀌어 문장이 망가진다.
                original = match.group(1) if match.groups() else match.group()
                if not original:
                    continue
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

    def _apply_korean_pii_masking(
        self,
        text: str,
        entity_map: dict[str, str],
        persona_tokens: set[str],
    ) -> str:
        """한국어 사전 PII(호칭 인명·기관명·광역지명)를 감지·치환한 텍스트를 반환한다.

        Gemini에 넘기기 전에 확실한 것부터 라벨로 바꿔, 원문이 외부로 나가지 않게
        한다. 라벨 카운터는 _assign_labels가 entity_map 기준으로 이어받으므로 이후
        Gemini 결과와 충돌하지 않는다.
        """
        detected = detect_korean_pii(text)
        if not detected:
            return text

        entities = [{"original": o, "type": t} for o, t in detected]
        self._assign_labels(entities, entity_map, persona_tokens)

        masked = text
        # 긴 원본부터 치환(부분 문자열 오치환 방지)
        for original, _kind in sorted(detected, key=lambda x: len(x[0]), reverse=True):
            label = entity_map.get(original)
            if label:
                masked = masked.replace(original, label)
        return masked

    @staticmethod
    def _max_label_index(entity_map: dict[str, str], prefix: str) -> int:
        """entity_map에서 주어진 접두사(예: 'Place_', 'Family_M')의 최대 인덱스."""
        max_idx = 0
        for label in entity_map.values():
            if label.startswith(prefix):
                suffix = label[len(prefix):]
                if suffix.isdigit():
                    max_idx = max(max_idx, int(suffix))
        return max_idx

    def _assign_labels(
        self,
        entities: list[dict],
        entity_map: dict[str, str],
        persona_tokens: set[str] | None = None,
    ) -> None:
        """감지 결과(사전/Gemini 공통)를 entity_map에 라벨링한다.

        카운터를 entity_map의 기존 라벨에서 이어받아, 사전 치환과 Gemini 치환이
        같은 라벨(Place_1 등)을 중복 부여하지 않게 한다.
        페르소나 토큰과 겹치는 결과는 무시한다(이미 익명화된 자리표시자).
        """
        tokens = persona_tokens or set()
        person_counters: dict[str, int] = {
            "M": self._max_label_index(entity_map, "Family_M"),
            "F": self._max_label_index(entity_map, "Family_F"),
            "U": self._max_label_index(entity_map, "Family_X"),
        }
        place_counter = self._max_label_index(entity_map, "Place_")

        for entity in entities:
            original = entity.get("original", "").strip()
            entity_type = entity.get("type", "")
            if not original or original in entity_map:
                continue
            if self._overlaps_persona_token(original, tokens):
                continue
            # 이미 부여한 라벨이 섞인 감지 결과는 무시(잔존 검사 오류·중복 라벨 방지)
            if _EXISTING_LABEL_PATTERN.search(original):
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
