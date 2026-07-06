"""AzureSttEngine 임시파일 정리 회귀 테스트 (Azure 실호출 없이 speechsdk mock).

배경: 실환경(Windows)에서 recognize_once가 WAV 파일 핸들을 쥔 채 finally에서
os.unlink를 호출해 WinError 32(다른 프로세스가 사용 중)로 502가 났다. SDK 객체를
먼저 해제하고 PermissionError를 재시도로 흡수하도록 고쳤다. 이 테스트는
(1) 정상/NoMatch 경로 모두에서 임시파일이 삭제되고,
(2) 일시적 PermissionError가 나도 재시도로 결국 삭제되는지를 검증한다.
"""
import os
from types import SimpleNamespace
from unittest import mock

import pytest

import infra.azure_stt as azure_stt


class _FakeResultReason:
    RecognizedSpeech = "recognized"
    NoMatch = "nomatch"
    Canceled = "canceled"


def _make_fake_speechsdk(reason, captured):
    """recognize()가 사용하는 speechsdk API 표면만 흉내내는 가짜 모듈."""
    recognized_json = '{"NBest":[{"Display":"바다","Confidence":0.9}]}'

    class FakeAudioConfig:
        def __init__(self, filename):
            captured["path"] = filename
            # 엔진이 tmp 파일을 실제로 썼는지(인식 중 존재) 확인.
            captured["existed_during"] = os.path.exists(filename)

    class FakeRecognizer:
        def __init__(self, speech_config, audio_config):
            pass

        def recognize_once(self):
            text = "바다" if reason == _FakeResultReason.RecognizedSpeech else ""
            return SimpleNamespace(reason=reason, text=text, json=recognized_json)

    class FakeGrammar:
        @staticmethod
        def from_recognizer(recognizer):
            return SimpleNamespace(addPhrase=lambda phrase: None)

    class FakeSpeechConfig:
        def __init__(self, subscription, region):
            self.speech_recognition_language = None
            self.output_format = None

    return SimpleNamespace(
        SpeechConfig=FakeSpeechConfig,
        OutputFormat=SimpleNamespace(Detailed="detailed"),
        audio=SimpleNamespace(AudioConfig=FakeAudioConfig),
        SpeechRecognizer=FakeRecognizer,
        PhraseListGrammar=FakeGrammar,
        ResultReason=_FakeResultReason,
    )


@pytest.mark.parametrize(
    "reason",
    [_FakeResultReason.RecognizedSpeech, _FakeResultReason.NoMatch],
)
def test_tempfile_is_cleaned_up(reason):
    captured = {}
    fake = _make_fake_speechsdk(reason, captured)
    with mock.patch.object(azure_stt, "speechsdk", fake):
        engine = azure_stt.AzureSttEngine("key", "koreacentral")
        engine.recognize(b"RIFF....WAVE", "ko-KR", ["바다"])

    assert captured["existed_during"] is True  # 인식 중에는 존재
    assert not os.path.exists(captured["path"])  # 인식 후 삭제(누수 없음)


def test_tempfile_cleanup_retries_on_transient_lock():
    """Windows 파일 잠금(PermissionError)이 잠깐 발생해도 재시도로 삭제된다."""
    captured = {}
    fake = _make_fake_speechsdk(_FakeResultReason.RecognizedSpeech, captured)
    real_unlink = os.unlink
    calls = {"n": 0}

    def flaky_unlink(path):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PermissionError(32, "used by another process")
        real_unlink(path)

    with mock.patch.object(azure_stt, "speechsdk", fake), mock.patch.object(
        azure_stt.os, "unlink", flaky_unlink
    ), mock.patch.object(azure_stt.time, "sleep", lambda _s: None):
        engine = azure_stt.AzureSttEngine("key", "koreacentral")
        engine.recognize(b"RIFF....WAVE", "ko-KR", [])

    assert calls["n"] == 3  # 2회 실패 후 3회차 성공
    assert not os.path.exists(captured["path"])
