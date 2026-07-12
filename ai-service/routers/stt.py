"""서버 STT 라우터.

POST /stt (multipart: audio + lang + candidates[]) → 인식 결과(transcript/n-best).
정답을 아는 과제(퀴즈·검사 발화)에서 candidates를 phrase hint로 넘겨 인식률을 높인다.
"""
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)

from dependencies import client_key, get_stt_rate_limiter, get_stt_service
from infra.rate_limiter import SlidingWindowRateLimiter
from models.stt import SttNBestResponse, SttResponse
from services.stt_service import SttService

router = APIRouter(prefix="/stt", tags=["stt"])

# 재활 발화는 짧다(수 초). 과대 업로드 방지 상한.
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # 5MB


@router.post("", response_model=SttResponse, status_code=status.HTTP_200_OK)
async def recognize(
    request: Request,
    audio: UploadFile = File(...),
    lang: str = Form("ko-KR"),
    candidates: list[str] = Form(default=[]),
    service: SttService = Depends(get_stt_service),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_stt_rate_limiter),
) -> SttResponse:
    """WAV 오디오를 받아 (정답 후보 phrase hint와 함께) 인식한다.

    - audio: WAV(PCM 16kHz mono) 파일
    - lang: 언어 코드 (기본 ko-KR)
    - candidates: 정답 후보(phrase hint). 없으면 자유 인식.
    """
    # STT 엔진 폭주로 Azure 할당량을 소진시키는 것을 막는다(직접 노출 방어).
    if not rate_limiter.allow(client_key(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
        )
    wav_bytes = await audio.read()
    if not wav_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="오디오가 비어 있습니다.",
        )
    if len(wav_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="오디오가 너무 큽니다.",
        )

    try:
        result = service.recognize(
            wav_bytes, lang, [c for c in candidates if c]
        )
    except Exception as exc:  # 엔진 취소·네트워크 등 → 클라는 Web Speech로 폴백.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"STT 인식 실패: {exc}",
        ) from exc

    return SttResponse(
        transcript=result.transcript,
        confidence=result.confidence,
        nbest=[
            SttNBestResponse(text=n.text, confidence=n.confidence)
            for n in result.nbest
        ],
        engine=service.engine_name,
    )
