"""Azure Speech TTS 엔진 구현.

텍스트를 Azure 뉴럴 음성(기본 ko-KR-SunHiNeural)으로 합성해 MP3 바이트로 반환한다.
어르신·실어증 대상이라 SSML prosody로 발화 속도를 낮춰 명료도를 높인다.
audio_config=None으로 스피커 재생 없이 result.audio_data(bytes)만 받는다(헤드리스 서버).
"""
from xml.sax.saxutils import escape

import azure.cognitiveservices.speech as speechsdk

from interfaces.tts_engine import ITtsEngine

DEFAULT_VOICE = "ko-KR-SunHiNeural"

# 허용 음성 화이트리스트 — **로케일별로 나눠 담는다.**
#
# voice는 요청 파라미터라 그대로 SSML에 넣으면 인젝션/SSRF(Azure SSML은
# <audio src>를 지원) 위험이 있어 경계에서 화이트리스트로 제한한다. 그 목적은
# 그대로 두고, 언어를 늘릴 때 어디에 넣어야 하는지가 보이도록 갈라 담았다.
#
# **en-US는 아직 비어 있다.** 음성을 넣으려면 말속도부터 정해야 한다(아래
# SPEECH_RATE_BY_LOCALE 주석 참고) — 목록만 늘리면 한국어용으로 맞춘 속도가
# 영어에 그대로 적용된다.
VOICES_BY_LOCALE: dict[str, frozenset[str]] = {
    "ko-KR": frozenset(
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
    ),
}

# 라우터가 쓰는 평평한 집합(기존 이름 유지 — 검증 지점은 그대로다).
ALLOWED_VOICES = frozenset(
    voice for voices in VOICES_BY_LOCALE.values() for voice in voices
)

# 로케일별 말속도.
#
# `-10%`는 **`ko-KR-SunHiNeural`의 기준 속도에 대한** -10%다. 뉴럴 음성은 언어마다
# 기준 속도가 달라 **같은 -10%가 같은 체감이 아니다.** 그래서 이 값을 다른 언어로
# 복사하면 안 된다 — 영어는 분당 130~140단어를 목표로 음성별 실측해서 역산해야
# 한다(계획 §7-2).
#
# 없는 로케일은 조용히 폴백하지 않고 **터뜨린다.** 화이트리스트에 음성을 넣으면서
# 속도를 안 정하는 실수가 곧바로 드러나야 하기 때문이다.
SPEECH_RATE_BY_LOCALE: dict[str, str] = {
    # 어르신·실어증 명료도를 위해 표준보다 느리게(WebSpeech 폴백의 rate 0.85와 유사).
    "ko-KR": "-10%",
}


def locale_of_voice(voice: str) -> str:
    """음성 이름에서 로케일을 뽑는다 — `ko-KR-SunHiNeural` → `ko-KR`.

    Azure 뉴럴 음성 이름은 `<lang>-<REGION>-<Name>Neural` 꼴이라 앞 두 조각이
    곧 로케일이다. SSML의 `xml:lang`을 여기서 파생시키지 않고 박아 두면, 영어
    음성을 넣어도 **엔진이 한국어로 읽으려 해 발음이 깨진다.**
    """
    parts = voice.split("-")
    if len(parts) < 3:
        raise ValueError(f"음성 이름에서 로케일을 뽑을 수 없습니다: {voice!r}")
    return f"{parts[0]}-{parts[1]}"


def speech_rate_for(voice: str) -> str:
    """그 음성의 로케일에 정해 둔 말속도. 없으면 터뜨린다(위 주석 참고)."""
    locale = locale_of_voice(voice)
    try:
        return SPEECH_RATE_BY_LOCALE[locale]
    except KeyError as exc:
        raise ValueError(
            f"{locale} 말속도가 정해지지 않았습니다. "
            f"음성을 추가하려면 SPEECH_RATE_BY_LOCALE에 실측값을 먼저 넣으세요."
        ) from exc


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
        # xml:lang·rate를 **음성에서 파생**시킨다. 예전에는 둘 다 ko-KR로 박혀
        # 있어, 영어 음성을 화이트리스트에 넣어도 엔진이 한국어로 읽었다.
        locale = locale_of_voice(voice)
        rate = speech_rate_for(voice)
        safe_locale = escape(locale, {'"': "&quot;"})
        return (
            '<speak version="1.0" '
            f'xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{safe_locale}">'
            f'<voice name="{safe_voice}">'
            f'<prosody rate="{rate}">{safe_text}</prosody>'
            "</voice></speak>"
        )
