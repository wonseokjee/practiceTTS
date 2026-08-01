"""
LLM 클라이언트 추상 인터페이스.
구현체(GeminiClient, OpenAIClient 등)는 이 인터페이스만 상속한다.
"""
from abc import ABC, abstractmethod


class ILlmClient(ABC):
    """Gemini API(또는 다른 LLM) 통신 추상 인터페이스."""

    @abstractmethod
    async def complete(
        self,
        messages: list[dict],
        model: str,
        **kwargs,
    ) -> str:
        """텍스트 메시지 목록을 받아 LLM 응답 문자열 반환.

        Args:
            messages: [{"role": "user"|"model"|"system", "content": str}] 형식
            model: 사용할 모델 이름 (예: "gemini-1.5-pro")
            **kwargs: 모델별 추가 파라미터 (temperature, max_tokens 등)

        Returns:
            LLM이 생성한 텍스트 응답

        Raises:
            GeminiApiError: API 호출 실패 시
        """
        ...

    @abstractmethod
    async def complete_with_vision(
        self,
        text_prompt: str,
        image_base64: str,
        model: str,
        **kwargs,
    ) -> str:
        """이미지(Base64)와 텍스트 프롬프트를 받아 Vision LLM 응답 반환.

        Args:
            text_prompt: 이미지 분석에 사용할 텍스트 프롬프트
            image_base64: Base64 인코딩된 이미지 데이터
            model: 사용할 Vision 모델 이름 (예: "gemini-1.5-pro")
            **kwargs: 모델별 추가 파라미터 (generation_config 등 — complete와 동일)

        Returns:
            LLM이 생성한 텍스트 응답

        Raises:
            GeminiApiError: API 호출 실패 시
        """
        ...
