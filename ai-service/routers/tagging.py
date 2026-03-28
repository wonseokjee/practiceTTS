"""
이미지 태깅 라우터.
POST /tag → TaggingService → TagResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_tagging_service
from domain.errors import GeminiApiError, ImageDecodeError, ImageSizeError, TagParseError
from models.tagging import TagRequest, TagResponse
from services.tagging_service import TaggingService

router = APIRouter(prefix="/tag", tags=["tagging"])


@router.post("", response_model=TagResponse, status_code=status.HTTP_200_OK)
async def tag_image(
    body: TagRequest,
    service: TaggingService = Depends(get_tagging_service),
) -> TagResponse:
    """Base64 이미지를 분석하여 장소/사물 태그를 추출한다.

    - 이미지 최대 크기: 5MB
    - 사용 모델: gemini-1.5-pro (Vision)
    """
    try:
        result = await service.tag_image(image_base64=body.image_base64)
        return TagResponse(
            memory_entry_id=body.memory_entry_id,
            location_tag=result.location_tag,
            object_tags=result.object_tags,
            confidence=result.confidence,
        )

    except ImageDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"이미지 디코딩 실패: {exc}",
        ) from exc

    except ImageSizeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"이미지 크기 초과: {exc}",
        ) from exc

    except TagParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"태깅 응답 파싱 실패: {exc}",
        ) from exc

    except GeminiApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini API 오류: {exc}",
        ) from exc
