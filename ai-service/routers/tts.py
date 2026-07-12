"""On-demand TTS 라우터.

GET /tts?text=...&voice=... → Azure 뉴럴 음성 MP3(audio/mpeg).
같은 텍스트는 캐시로 재사용(무료·즉시). 프론트는 <audio src>로 바로 재생한다.
합성 실패 시 502 → 클라는 브라우저 Web Speech로 폴백한다.
"""
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)

from dependencies import client_key, get_tts_rate_limiter, get_tts_service
from infra.azure_tts import ALLOWED_VOICES, DEFAULT_VOICE
from infra.rate_limiter import SlidingWindowRateLimiter
from services.tts_service import TtsService

router = APIRouter(prefix="/tts", tags=["tts"])

# 재활 문장은 짧다. 과대 요청 방지 상한.
MAX_TEXT_LEN = 500


@router.get("")
def synthesize(
    request: Request,
    text: str = Query(..., min_length=1),
    voice: str = Query(DEFAULT_VOICE),
    service: TtsService = Depends(get_tts_service),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_tts_rate_limiter),
) -> Response:
    """텍스트를 뉴럴 음성 MP3로 합성해 반환한다(캐시 우선)."""
    # 임의 텍스트 폭주로 Azure 할당량을 소진시키는 것을 막는다(직접 노출 방어).
    if not rate_limiter.allow(client_key(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
        )
    trimmed = text.strip()
    if not trimmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="텍스트가 비어 있습니다.",
        )
    if len(trimmed) > MAX_TEXT_LEN:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="텍스트가 너무 깁니다.",
        )
    # voice는 그대로 SSML에 들어가므로 화이트리스트로 제한(인젝션/SSRF 차단).
    if voice not in ALLOWED_VOICES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="지원하지 않는 음성입니다.",
        )

    try:
        audio = service.synthesize(trimmed, voice)
    except Exception as exc:  # 엔진 취소·네트워크 등 → 클라는 Web Speech로 폴백.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"TTS 합성 실패: {exc}",
        ) from exc

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
