"""
RAG 대화 에이전트 라우터.
POST /chat → ChatService → ChatResponse
"""
from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import get_chat_service
from domain.entities import ScenarioResult
from domain.errors import GeminiApiError, InvalidHintLevelError, SessionNotFoundError
from models.chat import ChatRequest, ChatResponse
from services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat(
    body: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> ChatResponse:
    """환자 발화를 받아 AI 응답을 생성한다.

    - Window Buffer: 세션당 최대 10턴 보관
    - hint_level: 0(기본) / 1(첫 음절 힌트) / 2(양자택일)
    - Guardrail 위반 시 Fallback 응답 반환 (예외 전파 없음)
    - 사용 모델: gemini-1.5-pro

    세션이 없는 경우 자동으로 생성한다.
    """
    # 세션이 없으면 자동 생성 (첫 메시지인 경우)
    service.create_session(body.session_id)

    # ChatRequest에는 ScenarioResult가 없으므로 memory_entry_id로 RAG 검색만 수행
    # scenario는 NestJS가 전달하거나 별도 세션 스토어에서 조회해야 하지만,
    # MVP 단계에서는 빈 시나리오 placeholder를 사용한다
    # (실제 배포 시 NestJS가 scenario_cache에서 조회하여 전달)
    placeholder_scenario = ScenarioResult(
        opening_question="",
        context_summary="관련 기억 컨텍스트".ljust(100),
        guardrail_words=[],
        scene_description="",
    )

    try:
        result = await service.chat(
            session_id=body.session_id,
            user_message=body.user_message,
            hint_level=body.hint_level,
            scenario=placeholder_scenario,
        )
        return ChatResponse(
            session_id=body.session_id,
            ai_message=result.content,
            hint_triggered=result.hint_triggered,
            hint_level=result.hint_level,
        )

    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"세션 없음: {exc}",
        ) from exc

    except InvalidHintLevelError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"잘못된 힌트 레벨: {exc}",
        ) from exc

    except GeminiApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini API 오류: {exc}",
        ) from exc
