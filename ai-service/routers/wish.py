"""한마디→발화연습 변환 라우터 (Pattern 1).
POST /wish/to-practice → WishToPracticeService → WishToPracticeResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_wish_service
from domain.errors import WishConversionError
from models.wish import WishToPracticeRequest, WishToPracticeResponse
from services.wish_service import WishToPracticeService

router = APIRouter(prefix="/wish", tags=["wish"])


@router.post(
    "/to-practice",
    response_model=WishToPracticeResponse,
    status_code=status.HTTP_200_OK,
)
async def wish_to_practice(
    body: WishToPracticeRequest,
    service: WishToPracticeService = Depends(get_wish_service),
) -> WishToPracticeResponse:
    """보호자 한마디를 환자 발화 연습(따라말하기 + 빈칸)으로 변환한다.

    - echo_sentence는 LLM 없이 한마디 그대로 (따라말하기)
    - fill_blank는 LLM 시도 후 실패 시 규칙 기반 폴백 → 항상 200 보장
    - 입력에 금칙어 포함 시 422
    """
    try:
        return await service.convert(body)
    except WishConversionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"WISH_CONVERSION_REJECTED: {exc}",
        ) from exc
