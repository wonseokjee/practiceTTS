"""
이미지 태깅 유스케이스 (UC-1: TagImage).
ILlmClient 인터페이스에만 의존하며 구현체는 생성자로 주입받는다.
"""
import base64
import json

from domain.entities import TagResult
from domain.errors import GeminiApiError, ImageDecodeError, ImageSizeError, TagParseError
from interfaces.llm_client import ILlmClient
from prompts.tagging_prompt import TAGGING_SYSTEM_PROMPT

# 이미지 최대 허용 크기: 5MB (Base64 인코딩 전 원본 기준)
_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
# Vision 모델 (gemini-1.5-pro는 retired되어 404 → 2.5-flash로 교체)
_VISION_MODEL = "gemini-2.5-flash"


class TaggingService:
    """이미지 자동 태깅 서비스.

    Gemini Vision API를 통해 이미지에서 장소 태그와 사물 태그를 추출한다.
    """

    def __init__(self, llm_client: ILlmClient) -> None:
        self._llm = llm_client

    async def tag_image(self, image_base64: str) -> TagResult:
        """Base64 이미지를 분석하여 TagResult 반환.

        Args:
            image_base64: Base64 인코딩된 이미지 데이터

        Returns:
            TagResult (location_tag, object_tags, confidence)

        Raises:
            ImageDecodeError: Base64 디코딩 실패
            ImageSizeError: 이미지 크기 5MB 초과
            TagParseError: Gemini 응답 JSON 파싱 실패
            GeminiApiError: Gemini API 호출 실패
        """
        # 1. Base64 디코딩 및 크기 검증
        image_bytes = self._decode_and_validate(image_base64)

        # 2. Gemini Vision API 호출
        try:
            raw_response = await self._llm.complete_with_vision(
                text_prompt=TAGGING_SYSTEM_PROMPT,
                image_base64=image_base64,
                model=_VISION_MODEL,
            )
        except GeminiApiError:
            raise

        # 3. 응답 JSON 파싱 → TagResult 생성
        return self._parse_tag_response(raw_response)

    def _decode_and_validate(self, image_base64: str) -> bytes:
        """Base64 디코딩 및 이미지 크기 검증."""
        try:
            image_bytes = base64.b64decode(image_base64, validate=True)
        except Exception as exc:
            raise ImageDecodeError(
                f"Base64 이미지 디코딩에 실패했습니다: {exc}"
            ) from exc

        if len(image_bytes) > _MAX_IMAGE_SIZE_BYTES:
            size_mb = len(image_bytes) / (1024 * 1024)
            raise ImageSizeError(
                f"이미지 크기({size_mb:.1f}MB)가 허용 한도(5MB)를 초과했습니다"
            )

        return image_bytes

    def _parse_tag_response(self, raw_response: str) -> TagResult:
        """Gemini 응답 문자열을 파싱하여 TagResult 반환.

        JSON 블록이 마크다운 코드펜스에 감싸진 경우도 처리한다.
        """
        try:
            # 마크다운 코드펜스 제거 (```json ... ```)
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                # 첫 줄(```json) 과 마지막 줄(```) 제거
                cleaned = "\n".join(lines[1:-1]).strip()

            data = json.loads(cleaned)

            return TagResult(
                location_tag=data.get("location_tag", ""),
                object_tags=data.get("object_tags", []),
                confidence=float(data.get("confidence", 0.5)),
            )
        except Exception as exc:
            raise TagParseError(
                f"Gemini 태깅 응답 파싱에 실패했습니다. 원본 응답: {raw_response[:200]}"
            ) from exc
