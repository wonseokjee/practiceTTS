"""
Whisper STT 라우터.
POST /stt/transcribe → SttService.transcribe → TranscribeResponse
"""
import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from dependencies import get_stt_service
from models.stt import TranscribeResponse
from services.stt_service import SttService

router = APIRouter(prefix="/stt", tags=["stt"])

# 업로드 허용 확장자 (Whisper + ffmpeg 조합에서 지원되는 대표 포맷)
_ALLOWED_EXTENSIONS = frozenset({"webm", "wav", "mp3", "m4a", "ogg"})
# 파일 크기 상한: 10MB (Whisper 처리 메모리/디스크 보호 목적)
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    status_code=status.HTTP_200_OK,
)
async def transcribe_audio(
    file: UploadFile = File(..., description="변환할 오디오 파일"),
    language: str = Form("ko", description="언어 코드 (기본 ko)"),
    service: SttService = Depends(get_stt_service),
) -> TranscribeResponse:
    """업로드된 오디오를 Whisper로 변환하여 텍스트로 반환한다.

    - 지원 확장자: webm, wav, mp3, m4a, ogg
    - 최대 크기: 10MB
    - 언어 기본값: ko
    - 사용 모델: env WHISPER_MODEL_SIZE 또는 "base"
    """
    # 1. 확장자 검증 (filename이 없는 경우도 방어)
    extension = _extract_extension(file.filename)
    if extension not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"지원하지 않는 오디오 형식입니다: '{extension or '알 수 없음'}'. "
                f"허용 확장자: {sorted(_ALLOWED_EXTENSIONS)}"
            ),
        )

    # 2. 파일 읽기 및 크기 검증
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="빈 오디오 파일입니다.",
        )
    if len(audio_bytes) > _MAX_FILE_SIZE_BYTES:
        size_mb = len(audio_bytes) / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"오디오 파일 크기({size_mb:.1f}MB)가 허용 한도(10MB)를 초과했습니다."
            ),
        )

    # 3. 임시 파일에 저장 → Whisper 변환 → 삭제
    tmp_path: str | None = None
    try:
        # delete=False: 일부 환경에서 tempfile 컨텍스트 종료 시 잠금 문제를 회피
        with tempfile.NamedTemporaryFile(
            suffix=f".{extension}", delete=False
        ) as tmp_file:
            tmp_file.write(audio_bytes)
            tmp_path = tmp_file.name

        try:
            result = await service.transcribe(audio_path=tmp_path, language=language)
        except RuntimeError as exc:
            # Whisper 내부 변환 실패 (ffmpeg 누락, 오디오 디코딩 실패 등)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Whisper 변환 실패: {exc}",
            ) from exc
        except FileNotFoundError as exc:
            # ffmpeg 실행 파일 누락 시 빈번히 발생
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "오디오 전처리에 실패했습니다. ffmpeg 설치를 확인하세요."
                ),
            ) from exc
        except MemoryError as exc:
            # 모델 로딩 중 메모리 부족 → 임시적 서비스 불가로 간주
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="STT 서비스가 일시적으로 사용 불가능합니다 (메모리 부족).",
            ) from exc

        return TranscribeResponse(
            text=result["text"],
            language=result["language"],
            duration=result["duration"],
            model_size=result["model_size"],
        )

    finally:
        # 임시 파일 정리 (디스크 누수 방지)
        if tmp_path is not None:
            try:
                os.remove(tmp_path)
            except OSError:
                # 이미 삭제되었거나 잠금이 걸린 경우 무시 (서버 로그는 별도 처리)
                pass


def _extract_extension(filename: str | None) -> str:
    """파일명에서 확장자를 소문자로 추출한다. 확장자가 없으면 빈 문자열."""
    if not filename:
        return ""
    _, _, ext = filename.rpartition(".")
    return ext.lower()
