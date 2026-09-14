"""
훈련 시나리오 생성 유스케이스 (UC-3: GenerateScenario).
ILlmClient, IVectorStore 인터페이스에만 의존하며 구현체는 생성자로 주입받는다.

Guardrail 정책:
  - 생성된 시나리오에 target_words(guardrail_words)가 포함되면 위반
  - 최대 2회 재시도 (Fallback 프롬프트 사용)
  - 2회 초과 시 ScenarioGuardrailError 발생
"""
import json

from domain.entities import ScenarioResult
from models.scenario import ScenarioLLMOut
from domain.errors import (
    EmptyTargetWordsError,
    GeminiApiError,
    ScenarioGuardrailError,
)
from interfaces.llm_client import ILlmClient
from interfaces.vector_store import IVectorStore
from prompts.scenario_prompt import (
    SCENARIO_FALLBACK_PROMPT,
    SCENARIO_SYSTEM_PROMPT,
    SCENARIO_USER_DATA_TEMPLATE,
)

# 시나리오 생성 모델 (gemini-1.5-pro는 retired되어 404 → 2.5-flash로 교체)
_SCENARIO_MODEL = "gemini-2.5-flash"
# Guardrail 최대 재시도 횟수
_MAX_GUARDRAIL_RETRIES = 2


class ScenarioService:
    """훈련 시나리오 생성 서비스.

    Gemini로 시나리오를 생성하고, Guardrail 검증을 통해
    target_words가 시나리오에 노출되지 않도록 보장한다.
    """

    def __init__(
        self,
        llm_client: ILlmClient,
        vector_store: IVectorStore,
    ) -> None:
        self._llm = llm_client
        self._store = vector_store

    async def generate_scenario(
        self,
        masked_context: str,
        target_words: list[str],
        emotion_tag: str,
        memory_entry_id: str,
    ) -> ScenarioResult:
        """마스킹된 컨텍스트와 목표 단어로 훈련 시나리오 생성.

        Args:
            masked_context: 마스킹 처리된 에피소드 텍스트
            target_words: 환자가 떠올려야 할 목표 단어 목록 (1~3개)
            emotion_tag: 감정 태그 (happy|calm|nostalgic|excited)
            memory_entry_id: RAG 인덱싱 키 (UUID)

        Returns:
            ScenarioResult (opening_question, context_summary, scene_description, guardrail_words)

        Raises:
            EmptyTargetWordsError: target_words가 비어 있음
            ScenarioGuardrailError: Guardrail 위반 2회 초과
            GeminiApiError: Gemini API 호출 실패
        """
        # 1. 입력 검증
        if not target_words:
            raise EmptyTargetWordsError(
                "target_words가 비어 있습니다. 최소 1개 이상의 목표 단어가 필요합니다"
            )

        # 2. guardrail_words = target_words 복사
        guardrail_words = list(target_words)
        guardrail_words_str = ", ".join(guardrail_words)

        # 3. 초기 프롬프트로 시나리오 생성 (Guardrail 검증 포함, 최대 2회 재시도)
        scenario_result = await self._generate_with_guardrail(
            masked_context=masked_context,
            emotion_tag=emotion_tag,
            guardrail_words=guardrail_words,
            guardrail_words_str=guardrail_words_str,
        )

        # 4. context_summary를 IVectorStore에 upsert (RAG 인덱싱)
        await self._store.upsert(
            doc_id=memory_entry_id,
            text=scenario_result.context_summary,
            metadata={
                "memory_entry_id": memory_entry_id,
                "emotion_tag": emotion_tag,
                "guardrail_words": guardrail_words,
            },
        )

        return scenario_result

    async def _generate_with_guardrail(
        self,
        masked_context: str,
        emotion_tag: str,
        guardrail_words: list[str],
        guardrail_words_str: str,
    ) -> ScenarioResult:
        """Guardrail 검증을 포함한 시나리오 생성 (최대 재시도 포함).

        system_prompt는 고정 지시문만 담고, masked_context/emotion_tag(자유
        텍스트 출처)는 user_data로 분리해 user 턴에 실어 보낸다 — system
        롤(=system_instruction 슬롯)에는 신뢰된 지시문만 남긴다.
        """
        # 초기 프롬프트 구성
        system_prompt = SCENARIO_SYSTEM_PROMPT.format(
            GUARDRAIL_WORDS=guardrail_words_str,
        )
        user_data = SCENARIO_USER_DATA_TEMPLATE.format(
            EMOTION_TAG=emotion_tag,
            MASKED_CONTEXT=masked_context,
        )

        for attempt in range(_MAX_GUARDRAIL_RETRIES + 1):
            if attempt == 0:
                # 첫 번째 시도: 초기 프롬프트
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_data},
                ]
            else:
                # 재시도: Fallback 프롬프트
                fallback_prompt = SCENARIO_FALLBACK_PROMPT.format(
                    GUARDRAIL_WORDS=guardrail_words_str,
                )
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_data},
                    {
                        "role": "model",
                        "content": "(이전 응답에 금지 단어가 포함되어 재시도합니다)",
                    },
                    {"role": "user", "content": fallback_prompt},
                ]

            raw_response = await self._llm.complete(
                messages=messages,
                model=_SCENARIO_MODEL,
                # 구조화 출력: ScenarioLLMOut 3키의 유효 JSON만 반환하도록 강제
                # (형식만; context_summary 길이 보정 등 의미 처리는 파서가 담당).
                generation_config={
                    "response_mime_type": "application/json",
                    "response_schema": ScenarioLLMOut,
                },
            )

            # 응답 파싱
            scenario = self._parse_scenario_response(
                raw_response=raw_response,
                guardrail_words=guardrail_words,
            )

            # Guardrail 검증
            if not self._check_guardrail(scenario.opening_question, guardrail_words):
                return scenario

            # Guardrail 위반: 재시도 횟수 소진 시 에러
            if attempt >= _MAX_GUARDRAIL_RETRIES:
                raise ScenarioGuardrailError(
                    f"Guardrail 위반이 {_MAX_GUARDRAIL_RETRIES}회를 초과했습니다. "
                    f"시나리오 생성에 실패했습니다. guardrail_words: {guardrail_words}"
                )

        # 이 코드에 도달할 수 없지만 타입 체커를 위해 추가
        raise ScenarioGuardrailError("시나리오 생성에 실패했습니다")

    def _parse_scenario_response(
        self,
        raw_response: str,
        guardrail_words: list[str],
    ) -> ScenarioResult:
        """Gemini 응답을 파싱하여 ScenarioResult 반환."""
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1]).strip()

        data = json.loads(cleaned)

        context_summary = data.get("context_summary", "")
        # context_summary 길이 보정: 100자 미만이면 패딩 추가
        if len(context_summary) < 100:
            context_summary = context_summary + " " * (100 - len(context_summary))
        # 500자 초과 시 잘라내기
        context_summary = context_summary[:500]

        return ScenarioResult(
            opening_question=data.get("opening_question", ""),
            context_summary=context_summary.strip().ljust(100),
            guardrail_words=guardrail_words,
            scene_description=data.get("scene_description", ""),
        )

    def _check_guardrail(self, text: str, guardrail_words: list[str]) -> bool:
        """텍스트에 guardrail_words 중 하나라도 포함되면 True 반환 (위반)."""
        text_lower = text.lower()
        return any(word.lower() in text_lower for word in guardrail_words)
