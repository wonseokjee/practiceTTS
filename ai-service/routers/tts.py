"""On-demand TTS 라우터.

GET /tts?text=...&voice=... → Azure 뉴럴 음성 MP3(audio/mpeg).
같은 텍스트는 캐시로 재사용(무료·즉시). 프론트는 <audio src>로 바로 재생한다.
합성 실패 시 502 → 클라는 브라우저 Web Speech로 폴백한다.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from dependencies import get_tts_service
from services.tts_service import TtsService

router = APIRouter(prefix="/tts", tags=["tts"])

# 재활 문장은 짧다. 과대 요청 방지 상한.
MAX_TEXT_LEN = 500
DEFAULT_VOICE = "ko-KR-SunHiNeural"


@router.get("")
def synthesize(
    text: str = Query(..., min_length=1),
    voice: str = Query(DEFAULT_VOICE),
    service: TtsService = Depends(get_tts_service),
) -> Response:
    """텍스트를 뉴럴 음성 MP3로 합성해 반환한다(캐시 우선)."""
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
