"""
Whisper 기반 STT 유스케이스.

- 모델은 최초 transcribe 호출 시 지연 로딩되며, 이후 프로세스 생존 기간 동안 재사용된다.
- CPU 환경에서 동작시키기 위해 fp16=False를 강제한다 (GPU 이전 시 True로 전환 가능).
- model_size는 생성자 또는 환경변수 WHISPER_MODEL_SIZE로 제어한다.
"""
import os


class SttService:
    """Whisper 음성 → 텍스트 변환 서비스.

    openai-whisper 패키지는 import 비용이 크므로 _ensure_model_loaded()에서
    지연 import한다. 서버 부팅 시간을 단축하기 위함이다.
    """

    def __init__(self, model_size: str = "base") -> None:
        # 환경변수 오버라이드 지원 (운영 환경에서 small/medium으로 교체 가능)
        env_model_size = os.getenv("WHISPER_MODEL_SIZE", "").strip()
        self._model_size = env_model_size or model_size
        # 지연 로딩: 최초 transcribe 호출 시 로딩
        self._model = None  # type: ignore[assignment]

    def _ensure_model_loaded(self) -> None:
        """첫 요청 시 Whisper 모델을 로딩한다. 이후 싱글턴 재사용."""
        if self._model is None:
            import whisper  # 지연 import (서버 부팅 속도 개선)

            self._model = whisper.load_model(self._model_size)

    @property
    def model_size(self) -> str:
        """현재 사용 중인 모델 크기."""
        return self._model_size

    async def transcribe(
        self,
        audio_path: str,
        language: str = "ko",
    ) -> dict:
        """오디오 파일 경로를 받아 Whisper 변환 결과를 dict로 반환한다.

        Args:
            audio_path: 디스크에 저장된 오디오 파일 경로.
            language: 언어 코드 (기본 "ko"). 자동 감지 오버헤드를 줄인다.

        Returns:
            dict with keys: text, language, duration, model_size.

        Raises:
            RuntimeError: Whisper 내부 변환 실패 시.
        """
        self._ensure_model_loaded()

        # Whisper transcribe 호출. fp16=False는 CPU 환경 필수 (GPU 이전 시 True).
        # 모델 객체의 transcribe는 동기 호출이지만, 외부 인터페이스는 async로 유지하여
        # 추후 스레드 풀 오프로드 전환 여지를 남긴다.
        result = self._model.transcribe(  # type: ignore[union-attr]
            audio_path,
            language=language,
            fp16=False,
        )

        # duration 계산: Whisper 결과의 segments 마지막 end를 우선 사용,
        # 없으면 result["duration"] 폴백, 둘 다 없으면 0.0.
        duration = self._compute_duration(result)

        text = (result.get("text") or "").strip()
        detected_language = result.get("language") or language

        return {
            "text": text,
            "language": detected_language,
            "duration": duration,
            "model_size": self._model_size,
        }

    @staticmethod
    def _compute_duration(result: dict) -> float:
        """Whisper 결과에서 오디오 총 길이(초)를 계산한다."""
        segments = result.get("segments") or []
        if segments:
            last_end = segments[-1].get("end")
            if isinstance(last_end, (int, float)):
                return float(last_end)

        raw_duration = result.get("duration")
        if isinstance(raw_duration, (int, float)):
            return float(raw_duration)

        return 0.0
