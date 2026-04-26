"""STT(Whisper) 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class TranscribeResponse(BaseModel):
    """POST /stt/transcribe 응답 모델.

    Attributes:
        text: Whisper가 변환한 텍스트 (앞뒤 공백 제거).
        language: 실제 사용된 언어 코드 (요청 시 지정한 값 또는 모델이 탐지한 값).
        duration: 오디오 길이(초). segments 기반으로 계산.
        model_size: 변환에 사용된 Whisper 모델 크기 (base, small, medium 등).
    """

    text: str
    language: str
    duration: float
    model_size: str
