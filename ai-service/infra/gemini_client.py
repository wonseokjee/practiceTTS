"""
Gemini API 클라이언트 구현체.
ILlmClient 인터페이스를 google-generativeai SDK로 구현한다.
다른 LLM으로 교체 시 이 파일만 수정하면 된다.
"""
import asyncio
import base64
import io
import os

import google.generativeai as genai

from domain.errors import GeminiApiError
from interfaces.llm_client import ILlmClient

# Vision 처리를 위해 PIL 사용
try:
    from PIL import Image as PILImage

    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


class GeminiClient(ILlmClient):
    """google-generativeai SDK 기반 Gemini API 클라이언트.

    교체 가능성:
      - OpenAI GPT-4o로 교체 시 이 파일만 수정
      - langchain_google_genai 래퍼로 교체 가능
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "gemini-1.5-pro",
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다")
        genai.configure(api_key=api_key)
        self._default_model = default_model

    async def complete(
        self,
        messages: list[dict],
        model: str,
        **kwargs,
    ) -> str:
        """텍스트 메시지 목록을 받아 Gemini 응답 반환.

        messages 형식:
          [{"role": "user"|"model"|"system", "content": str}]
        """
        try:
            gemini_model = genai.GenerativeModel(model_name=model)

            # system role은 Gemini에서 system_instruction으로 처리
            system_instruction: str | None = None
            history: list[dict] = []

            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    system_instruction = content
                elif role in ("user", "model", "assistant"):
                    # assistant → model 변환 (OpenAI 호환 형식 대응)
                    gemini_role = "model" if role == "assistant" else role
                    history.append({"role": gemini_role, "parts": [content]})

            # system_instruction이 있으면 모델 재생성
            if system_instruction:
                gemini_model = genai.GenerativeModel(
                    model_name=model,
                    system_instruction=system_instruction,
                )

            response = await asyncio.to_thread(
                gemini_model.generate_content,
                history if history else [{"role": "user", "parts": ["안녕하세요"]}],
                **kwargs,
            )
            return response.text

        except Exception as exc:
            raise GeminiApiError(
                f"Gemini API 호출 실패 (모델: {model}): {exc}"
            ) from exc

    async def complete_with_vision(
        self,
        text_prompt: str,
        image_base64: str,
        model: str,
    ) -> str:
        """이미지(Base64)와 텍스트 프롬프트를 받아 Gemini Vision 응답 반환."""
        if not _PIL_AVAILABLE:
            raise GeminiApiError(
                "Vision 기능을 사용하려면 Pillow 라이브러리가 필요합니다: pip install Pillow"
            )

        try:
            # Base64 → PIL Image 변환
            image_bytes = base64.b64decode(image_base64)
            image = PILImage.open(io.BytesIO(image_bytes))

            gemini_model = genai.GenerativeModel(model_name=model)

            response = await asyncio.to_thread(
                gemini_model.generate_content,
                [text_prompt, image],
            )
            return response.text

        except GeminiApiError:
            raise
        except Exception as exc:
            raise GeminiApiError(
                f"Gemini Vision API 호출 실패 (모델: {model}): {exc}"
            ) from exc
