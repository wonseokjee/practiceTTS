"""Azure Speech TTS 엔진 구현.

텍스트를 Azure 뉴럴 음성(기본 ko-KR-SunHiNeural)으로 합성해 MP3 바이트로 반환한다.
어르신·실어증 대상이라 SSML prosody로 발화 속도를 낮춰 명료도를 높인다.
audio_config=None으로 스피커 재생 없이 result.audio_data(bytes)만 받는다(헤드리스 서버).
"""
from xml.sax.saxutils import escape

import azure.cognitiveservices.speech as speechsdk

from interfaces.tts_engine import ITtsEngine

DEFAULT_VOICE = "ko-KR-SunHiNeural"
# 어르신·실어증 명료도를 위해 표준보다 느리게(WebSpeech 폴백의 rate 0.85와 유사).
SPEECH_RATE = "-10%"

# 허용 음성 화이트리스트. voice는 요청 파라미터라 그대로 SSML에 넣으면 인젝션/SSRF
# (Azure SSML은 <audio src>를 지원) 위험이 있어, 경계에서 화이트리스트로 제한한다.
ALLOWED_VOICES = frozenset(
    {
        "ko-KR-SunHiNeural",
        "ko-KR-InJoonNeural",
        "ko-KR-JiMinNeural",
        "ko-KR-SeoHyeonNeural",
        "ko-KR-BongJinNeural",
        "ko-KR-GookMinNeural",
        "ko-KR-YuJinNeural",
        "ko-KR-HyunsuMultilingualNeural",
    }
)


class AzureTtsEngine(ITtsEngine):
    """Azure Cognitive Services Speech 기반 TTS 엔진."""

    def __init__(self, speech_key: str, speech_region: str) -> None:
        if not speech_key or not speech_region:
            raise ValueError("AZURE_SPEECH_KEY/AZURE_SPEECH_REGION이 설정되지 않았습니다.")
        self._key = speech_key
        self._region = speech_region

    @property
    def name(self) -> str:
        return "azure"

    def synthesize(self, text: str, voice: str) -> bytes:
        speech_config = speechsdk.SpeechConfig(
            subscription=self._key, region=self._region
        )
        # speech 용도 최적(사전생성 스크립트와 동일 포맷).
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
        )
        # audio_config=None → 스피커로 내보내지 않고 메모리 바이트로 받는다.
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config, audio_config=None
        )

        ssml = self._build_ssml(text, voice or DEFAULT_VOICE)
        result = synthesizer.speak_ssml_async(ssml).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data)
        if result.reason == speechsdk.ResultReason.Canceled:
            cd = result.cancellation_details
            raise RuntimeError(
                f"Azure TTS 취소: reason={cd.reason} detail={cd.error_details}"
            )
        raise RuntimeError(f"Azure TTS 합성 실패: reason={result.reason}")

    @staticmethod
    def _build_ssml(text: str, voice: str) -> str:
        """XML-escape한 텍스트/음성을 느린 prosody SSML로 감싼다.

        voice는 라우터에서 화이트리스트 검증하지만, 심층 방어로 속성 이스케이프도 한다.
        """
        safe_text = escape(text)
        safe_voice = escape(voice, {'"': "&quot;"})
        return (
            '<speak version="1.0" '
            'xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">'
            f'<voice name="{safe_voice}">'
            f'<prosody rate="{SPEECH_RATE}">{safe_text}</prosody>'
            "</voice></speak>"
        )
