"""
훈련 시나리오 생성 라우터.
POST /scenario → ScenarioService → ScenarioResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_scenario_service
from domain.errors import (
    EmptyTargetWordsError,
    GeminiApiError,
    ScenarioGuardrailError,
)
from models.scenario import ScenarioRequest, ScenarioResponse
from services.scenario_service import ScenarioService

router = APIRouter(prefix="/scenario", tags=["scenario"])


@router.post("", response_model=ScenarioResponse, status_code=status.HTTP_200_OK)
async def generate_scenario(
    body: ScenarioRequest,
    service: ScenarioService = Depends(get_scenario_service),
) -> ScenarioResponse:
    """마스킹된 컨텍스트와 목표 단어로 훈련 시나리오를 생성한다.

    - guardrail_words(target_words)는 응답에 포함되지 않음 (보안 규칙)
    - Guardrail 위반 시 최대 2회 재시도
    - 사용 모델: gemini-1.5-pro
    """
    try:
        result = await service.generate_scenario(
            masked_context=body.masked_context,
            target_words=body.target_words,
            emotion_tag=body.emotion_tag,
            memory_entry_id=body.memory_entry_id,
        )
        # guardrail_words는 ScenarioResponse에 포함하지 않음 (보안 규칙)
        return ScenarioResponse(
            memory_entry_id=body.memory_entry_id,
            opening_question=result.opening_question,
            context_summary=result.context_summary,
            scene_description=result.scene_description,
        )

    except EmptyTargetWordsError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"목표 단어 누락: {exc}",
        ) from exc

    except ScenarioGuardrailError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Guardrail 위반 반복 초과: {exc}",
        ) from exc

    except GeminiApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini API 오류: {exc}",
        ) from exc
