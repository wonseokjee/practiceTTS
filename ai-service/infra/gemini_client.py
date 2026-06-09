"""
Gemini API 클라이언트 구현체.
ILlmClient 인터페이스를 google-genai SDK로 구현한다.
다른 LLM으로 교체 시 이 파일만 수정하면 된다.

NOTE: 구 `google-generativeai` 패키지는 지원 종료되어 신 `google-genai`
(google.genai)로 마이그레이션됨. 호출부 계약(complete(messages, model,
generation_config={...}))은 그대로 유지하며, 내부에서 신 SDK 형식으로 변환한다.
"""
import base64
import io

from google import genai
from google.genai import types

from domain.errors import GeminiApiError
from interfaces.llm_client import ILlmClient

# Vision 처리를 위해 PIL 사용 (신 SDK는 contents에 PIL.Image를 직접 수용)
try:
    from PIL import Image as PILImage

    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


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
            # Base64 → PIL Image 변환 (신 SDK가 contents에서 PIL.Image를 직접 처리)
            image_bytes = base64.b64decode(image_base64)
            image = PILImage.open(io.BytesIO(image_bytes))

            response = await self._client.aio.models.generate_content(
                model=model,
                contents=[text_prompt, image],
            )
            return response.text

        except GeminiApiError:
            raise
        except Exception as exc:
            raise GeminiApiError(
                f"Gemini Vision API 호출 실패 (모델: {model}): {exc}"
            ) from exc
