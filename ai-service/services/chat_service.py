"""
RAG 대화 에이전트 유스케이스 (UC-4: ChatWithAgent).
ILlmClient, IVectorStore 인터페이스에만 의존하며 구현체는 생성자로 주입받는다.

Window Buffer 정책:
  - session_id별 최대 10턴(사용자+AI 각각 1개) 보관
  - 11번째 턴 추가 시 가장 오래된 턴 제거

Guardrail 정책:
  - 응답에 guardrail_words 포함 감지 시 GuardrailViolationError
  - ChatService 내부에서 처리 (예외 전파 없음) → GUARDRAIL_FALLBACK_RESPONSE 반환
"""
from collections import deque

from domain.entities import ChatMessage, ScenarioResult
from domain.errors import GeminiApiError, InvalidHintLevelError, SessionNotFoundError
from interfaces.llm_client import ILlmClient
from interfaces.vector_store import IVectorStore
from prompts.chat_prompt import (
    CHAT_SYSTEM_PROMPT_LEVEL_0,
    CHAT_SYSTEM_PROMPT_LEVEL_1,
    CHAT_SYSTEM_PROMPT_LEVEL_2,
    GUARDRAIL_FALLBACK_RESPONSE,
)

# 대화 에이전트 모델
_CHAT_MODEL = "gemini-1.5-pro"
# Window Buffer 최대 턴 수 (사용자 발화 + AI 응답 각 1개 = 1턴)
_MAX_WINDOW_SIZE = 10

# 힌트 레벨별 시스템 프롬프트 매핑
_PROMPT_BY_LEVEL = {
    0: CHAT_SYSTEM_PROMPT_LEVEL_0,
    1: CHAT_SYSTEM_PROMPT_LEVEL_1,
    2: CHAT_SYSTEM_PROMPT_LEVEL_2,
}


class ChatService:
    """RAG 대화 에이전트 서비스.

    세션별 Window Buffer 메모리와 RAG 검색을 결합하여
    환자와 인지 재활 대화를 수행한다.
    """

    def __init__(
        self,
        llm_client: ILlmClient,
        vector_store: IVectorStore,
    ) -> None:
        self._llm = llm_client
        self._store = vector_store
        # session_id → deque[{"role": str, "content": str}] (최대 10턴)
        self._memory: dict[str, deque] = {}

    def create_session(self, session_id: str) -> None:
        """새 대화 세션을 초기화한다. 이미 존재하면 무시."""
        if session_id not in self._memory:
            self._memory[session_id] = deque(maxlen=_MAX_WINDOW_SIZE * 2)

    async def chat(
        self,
        session_id: str,
        user_message: str,
        hint_level: int,
        scenario: ScenarioResult,
    ) -> ChatMessage:
        """환자 발화를 받아 AI 응답을 생성하고 ChatMessage 반환.

        Args:
            session_id: 훈련 세션 ID
            user_message: 환자 발화 (STT 결과)
            hint_level: 힌트 레벨 (0, 1, 2)
            scenario: 현재 훈련 시나리오 (ScenarioResult)

        Returns:
            ChatMessage (role="ai", content, hint_triggered, hint_level)

        Raises:
            SessionNotFoundError: session_id가 존재하지 않음
            InvalidHintLevelError: hint_level이 0~2 범위 밖
            GeminiApiError: Gemini API 호출 실패
        """
        # 1. session_id 유효성 검증
        if session_id not in self._memory:
            raise SessionNotFoundError(
                f"세션을 찾을 수 없습니다: {session_id}. "
                "먼저 create_session()을 호출하거나 /chat 요청 전 세션을 초기화하세요."
            )

        # 2. hint_level 범위 검증
        if hint_level not in (0, 1, 2):
            raise InvalidHintLevelError(
                f"hint_level({hint_level})이 허용 범위(0~2)를 벗어났습니다"
            )

        # 3. RAG 검색: scenario context_summary와 관련된 컨텍스트 조회
        rag_results = await self._store.search(
            query=user_message,
            top_k=3,
        )
        rag_context = self._format_rag_context(rag_results)

        # 4. 시스템 프롬프트 구성 (hint_level별 분기)
        system_prompt = self._build_system_prompt(
            hint_level=hint_level,
            scenario=scenario,
            rag_context=rag_context,
        )

        # 5. Window Buffer에서 대화 이력 조회
        history = list(self._memory[session_id])

        # 6. Gemini 호출용 메시지 구성
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})

        # 7. Gemini 호출
        ai_response = await self._llm.complete(
            messages=messages,
            model=_CHAT_MODEL,
        )

        # 8. Guardrail 검증 (위반 시 Fallback 응답 사용, 예외 전파 안 함)
        guardrail_triggered = self._check_guardrail(
            text=ai_response,
            guardrail_words=scenario.guardrail_words,
        )
        if guardrail_triggered:
            ai_response = GUARDRAIL_FALLBACK_RESPONSE

        # 9. Window Buffer 업데이트 (deque maxlen으로 자동 관리)
        self._memory[session_id].append({"role": "user", "content": user_message})
        self._memory[session_id].append({"role": "model", "content": ai_response})

        return ChatMessage(
            role="ai",
            content=ai_response,
            hint_triggered=hint_level > 0,
            hint_level=hint_level,
        )

    def _build_system_prompt(
        self,
        hint_level: int,
        scenario: ScenarioResult,
        rag_context: str,
    ) -> str:
        """힌트 레벨별 시스템 프롬프트 생성."""
        template = _PROMPT_BY_LEVEL[hint_level]
        guardrail_words_str = ", ".join(scenario.guardrail_words)
        return template.format(
            SCENE_DESCRIPTION=scenario.scene_description,
            RAG_CONTEXT=rag_context,
            GUARDRAIL_WORDS=guardrail_words_str,
        )

    def _format_rag_context(self, rag_results: list[dict]) -> str:
        """RAG 검색 결과를 프롬프트에 삽입할 텍스트로 변환."""
        if not rag_results:
            return "(관련 기억 컨텍스트 없음)"
        return "\n".join(
            f"- {result['text']}" for result in rag_results
        )

    def _check_guardrail(self, text: str, guardrail_words: list[str]) -> bool:
        """텍스트에 guardrail_words 중 하나라도 포함되면 True 반환 (위반)."""
        text_lower = text.lower()
        return any(word.lower() in text_lower for word in guardrail_words)
