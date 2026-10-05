"""
Gemini API 클라이언트 구현체.
ILlmClient 인터페이스를 google-genai SDK로 구현한다.
다른 LLM으로 교체 시 이 파일만 수정하면 된다.

NOTE: 구 `google-generativeai` 패키지는 지원 종료되어 신 `google-genai`
(google.genai)로 마이그레이션됨. 호출부 계약(complete(messages, model,
generation_config={...}))은 그대로 유지하며, 내부에서 신 SDK 형식으로 변환한다.
"""
import asyncio
import base64
import io

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from domain.errors import (
    GeminiApiError,
    GeminiBlockedError,
    GeminiEmptyResponseError,
    GeminiRateLimitError,
    GeminiTimeoutError,
)
from interfaces.llm_client import ILlmClient

# Vision 처리를 위해 PIL 사용 (신 SDK는 contents에 PIL.Image를 직접 수용)
try:
    from PIL import Image as PILImage

    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


# 응답이 정책으로 막혔다는 뜻의 finish_reason. MAX_TOKENS·STOP은 막힌 게 아니다.
_BLOCKED_FINISH_REASONS = frozenset(
    {
        types.FinishReason.SAFETY,
        types.FinishReason.RECITATION,
        types.FinishReason.BLOCKLIST,
        types.FinishReason.PROHIBITED_CONTENT,
        types.FinishReason.SPII,
        types.FinishReason.IMAGE_SAFETY,
        types.FinishReason.IMAGE_PROHIBITED_CONTENT,
        types.FinishReason.IMAGE_RECITATION,
    }
)


def _text_or_raise(response: object, model: str) -> str:
    """응답에서 텍스트를 꺼낸다. 비었으면 이유별 예외로 바꾼다.

    `response.text`는 차단·빈 응답일 때 None을 돌려준다(예외가 아니다).
    그걸 호출부에 넘기면 `None.strip()` 같은 엉뚱한 예외로 터지므로,
    여기서 반드시 GeminiApiError 계열로 바꾼다.
    """
    text = getattr(response, "text", None)
    if text and text.strip():
        return text

    feedback = getattr(response, "prompt_feedback", None)
    block_reason = getattr(feedback, "block_reason", None)
    if block_reason:
        raise GeminiBlockedError(
            f"Gemini가 프롬프트를 차단했습니다 (모델: {model}, 사유: {block_reason})"
        )
    for candidate in getattr(response, "candidates", None) or []:
        finish = getattr(candidate, "finish_reason", None)
        if finish in _BLOCKED_FINISH_REASONS:
            raise GeminiBlockedError(
                f"Gemini가 응답을 차단했습니다 (모델: {model}, 사유: {finish})"
            )
    raise GeminiEmptyResponseError(f"Gemini 응답이 비어 있습니다 (모델: {model})")


def _classify(exc: Exception, label: str) -> GeminiApiError:
    """SDK·전송 예외를 이름 붙은 GeminiApiError로 바꾼다."""
    if isinstance(exc, GeminiApiError):
        return exc
    if isinstance(exc, (httpx.TimeoutException, asyncio.TimeoutError)):
        return GeminiTimeoutError(f"{label} 시간 초과: {exc}")
    if isinstance(exc, genai_errors.APIError) and exc.code == 429:
        return GeminiRateLimitError(f"{label} 속도 제한(429): {exc}")
    return GeminiApiError(f"{label} 실패: {exc}")


class GeminiClient(ILlmClient):
    """google-genai SDK 기반 Gemini API 클라이언트.

    교체 가능성:
      - OpenAI GPT-4o로 교체 시 이 파일만 수정
      - langchain_google_genai 래퍼로 교체 가능
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "gemini-2.5-flash-lite",
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다")
        # Client() 생성은 네트워크 호출이 없다(지연 초기화).
        self._client = genai.Client(api_key=api_key)
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

        kwargs:
          generation_config: {"temperature": float, ...} — GenerateContentConfig로 변환
        """
        try:
            # system role은 Gemini에서 system_instruction으로 처리
            system_instruction: str | None = None
            contents: list[types.Content] = []

            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    system_instruction = content
                elif role in ("user", "model", "assistant"):
                    # assistant → model 변환 (OpenAI 호환 형식 대응)
                    gemini_role = "model" if role == "assistant" else role
                    contents.append(
                        types.Content(
                            role=gemini_role,
                            parts=[types.Part(text=content)],
                        )
                    )

            if not contents:
                contents = [
                    types.Content(role="user", parts=[types.Part(text="안녕하세요")])
                ]

            # 호출부가 넘긴 generation_config(temperature 등)를 GenerateContentConfig로 변환
            gen_config = dict(kwargs.get("generation_config") or {})
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                **gen_config,
            )

            response = await self._client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return _text_or_raise(response, model)

        except GeminiApiError:
            raise
        except Exception as exc:
            raise _classify(exc, f"Gemini API 호출 (모델: {model})") from exc

    async def complete_with_vision(
        self,
        text_prompt: str,
        image_base64: str,
        model: str,
        **kwargs,
    ) -> str:
        """이미지(Base64)와 텍스트 프롬프트를 받아 Gemini Vision 응답 반환.

        kwargs.generation_config를 GenerateContentConfig로 변환해 전달한다
        (complete와 동일 — response_schema로 구조화 출력 강제 가능).
        """
        if not _PIL_AVAILABLE:
            raise GeminiApiError(
                "Vision 기능을 사용하려면 Pillow 라이브러리가 필요합니다: pip install Pillow"
            )

        try:
            # Base64 → PIL Image 변환 (신 SDK가 contents에서 PIL.Image를 직접 처리)
            image_bytes = base64.b64decode(image_base64)
            image = PILImage.open(io.BytesIO(image_bytes))

            gen_config = dict(kwargs.get("generation_config") or {})
            config = (
                types.GenerateContentConfig(**gen_config) if gen_config else None
            )
            response = await self._client.aio.models.generate_content(
                model=model,
                contents=[text_prompt, image],
                config=config,
            )
            return _text_or_raise(response, model)

        except GeminiApiError:
            raise
        except Exception as exc:
            raise _classify(exc, f"Gemini Vision API 호출 (모델: {model})") from exc
