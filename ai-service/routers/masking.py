"""
텍스트 PII 마스킹 라우터.
POST /mask → MaskingService → MaskResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_masking_service
from domain.errors import GeminiApiError, ResidualPiiError, TextTooLongError
from models.masking import MaskRequest, MaskResponse
from services.masking_service import MaskingService

router = APIRouter(prefix="/mask", tags=["masking"])


@router.post("", response_model=MaskResponse, status_code=status.HTTP_200_OK)
async def mask_text(
    body: MaskRequest,
    service: MaskingService = Depends(get_masking_service),
) -> MaskResponse:
    """원본 텍스트에서 개인 식별 정보를 마스킹하여 반환한다.

    - 최대 입력 길이: 5000자
    - entity_map은 응답에 포함되지 않음 (보안 규칙)
    - 사용 모델: gemini-2.0-flash
    """
    try:
        result = await service.mask_text(
            raw_text=body.raw_text,
            memory_entry_id=body.memory_entry_id,
        )
        return MaskResponse(
            memory_entry_id=body.memory_entry_id,
            masked_text=result.masked_text,
            entity_count=result.entity_count,
            degraded=result.degraded,
        )

    except TextTooLongError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"텍스트 길이 초과: {exc}",
        ) from exc

    except ResidualPiiError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"마스킹 후 잔존 PII 감지: {exc}",
        ) from exc

    except GeminiApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini API 오류: {exc}",
        ) from exc
