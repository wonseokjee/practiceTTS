"""
데일리 퀴즈 생성 라우터.
POST /quiz/generate → QuizGeneratorService → QuizGenerateResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_quiz_generator_service
from domain.errors import (
    GeminiApiError,
    InvalidPatientNotesError,
    QuizGenerationTimeoutError,
)
from models.quiz import QuizGenerateRequest, QuizGenerateResponse
from services.quiz_service import QuizGeneratorService

router = APIRouter(prefix="/quiz", tags=["quiz"])


@router.post(
    "/generate",
    response_model=QuizGenerateResponse,
    status_code=status.HTTP_200_OK,
)
async def generate_quiz(
    body: QuizGenerateRequest,
    service: QuizGeneratorService = Depends(get_quiz_generator_service),
) -> QuizGenerateResponse:
    """환자 메모만으로 데일리 퀴즈(기본 5문제)를 생성한다.

    - 보호자 사적 데이터(mood/reflection/wish)는 요청 모델에 존재하지 않음 (보안 규칙)
    - JSON 파싱 실패 시 temperature=0 1회 재시도, 그래도 실패 시 규칙 기반 폴백 보충
    - 사용 모델: gemini-1.5-flash
    """
    try:
        return await service.generate_quiz(body)

    except InvalidPatientNotesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"INVALID_PATIENT_NOTES: {exc}",
        ) from exc

    except QuizGenerationTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"LLM_TIMEOUT: {exc}",
        ) from exc

    except GeminiApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM_UPSTREAM_ERROR: {exc}",
        ) from exc
