"""AzurePronunciationAssessor 파싱·정리 테스트 (Azure 실호출 없이 speechsdk mock).

검증:
(1) RecognizedSpeech: 점수/단어/음소/운율이 PronunciationResult로 파싱된다.
(2) NoMatch: 0점 결과를 반환하고 예외를 던지지 않는다.
(3) Canceled: RuntimeError.
(4) 정상/NoMatch 모두에서 임시 WAV 파일이 삭제된다(Windows 핸들 회귀 방지).
(5) reference_text가 PronunciationAssessmentConfig에 전달된다.
"""
import os
from types import SimpleNamespace
from unittest import mock

import pytest

import infra.azure_pronunciation as azure_pa


class _FakeResultReason:
    RecognizedSpeech = "recognized"
    NoMatch = "nomatch"
    Canceled = "canceled"


def _make_fake_speechsdk(reason, captured):
    """assess()가 사용하는 speechsdk API 표면만 흉내내는 가짜 모듈."""

    # 인식 결과에 실릴 발음 채점 페이로드(단어 2개, 음소 포함).
    pa_payload = SimpleNamespace(
        accuracy_score=88.0,
        fluency_score=90.0,
        completeness_score=100.0,
        pronunciation_score=87.5,
        prosody_score=82.0,
        words=[
            SimpleNamespace(
                word="바다",
                accuracy_score=95.0,
                error_type="None",
                phonemes=[
                    SimpleNamespace(phoneme="b", accuracy_score=96.0),
                    SimpleNamespace(phoneme="a", accuracy_score=94.0),
                ],
            ),
            SimpleNamespace(
                word="가방",
                accuracy_score=60.0,
                error_type="Mispronunciation",
                phonemes=[SimpleNamespace(phoneme="g", accuracy_score=60.0)],
            ),
        ],
    )

    class FakeAudioConfig:
        def __init__(self, filename):
            captured["path"] = filename
            captured["existed_during"] = os.path.exists(filename)

    class FakeRecognizer:
        def __init__(self, speech_config, audio_config):
            pass

        def recognize_once(self):
            text = "바다 가방" if reason == _FakeResultReason.RecognizedSpeech else ""
            return SimpleNamespace(reason=reason, text=text, _pa=pa_payload)

    class FakePAConfig:
        def __init__(self, reference_text, grading_system, granularity, enable_miscue):
            captured["reference_text"] = reference_text
            captured["enable_miscue"] = enable_miscue
            captured["prosody_enabled"] = False

        def apply_to(self, recognizer):
            captured["applied"] = True

        def enable_prosody_assessment(self):
            captured["prosody_enabled"] = True

    class FakeSpeechConfig:
        def __init__(self, subscription, region):
            self.speech_recognition_language = None

    def fake_pa_result(result):
        return result._pa

    return SimpleNamespace(
        SpeechConfig=FakeSpeechConfig,
        PronunciationAssessmentConfig=FakePAConfig,
        PronunciationAssessmentGradingSystem=SimpleNamespace(HundredMark="hundred"),
        PronunciationAssessmentGranularity=SimpleNamespace(Phoneme="phoneme"),
        PronunciationAssessmentResult=fake_pa_result,
        audio=SimpleNamespace(AudioConfig=FakeAudioConfig),
        SpeechRecognizer=FakeRecognizer,
        ResultReason=_FakeResultReason,
    )


def test_parses_scores_words_and_phonemes():
    captured = {}
    fake = _make_fake_speechsdk(_FakeResultReason.RecognizedSpeech, captured)
    with mock.patch.object(azure_pa, "speechsdk", fake):
        engine = azure_pa.AzurePronunciationAssessor("key", "koreacentral")
        result = engine.assess(b"RIFFfakewav", "바다 가방", "ko-KR")

    assert result.recognized_text == "바다 가방"
    assert result.accuracy_score == 88.0
    assert result.completeness_score == 100.0
    assert result.prosody_score == 82.0
    assert [w.word for w in result.words] == ["바다", "가방"]
    assert result.words[1].error_type == "Mispronunciation"
    assert result.words[0].phonemes[0].phoneme == "b"
    # reference_text·miscue·prosody가 설정됐는지
    assert captured["reference_text"] == "바다 가방"
    assert captured["enable_miscue"] is True
    assert captured["prosody_enabled"] is True
    assert captured["applied"] is True
    # 임시 파일은 인식 중 존재했고, 이후 삭제됨
    assert captured["existed_during"] is True
    assert not os.path.exists(captured["path"])


def test_nomatch_returns_zero_scores_without_raising():
    captured = {}
    fake = _make_fake_speechsdk(_FakeResultReason.NoMatch, captured)
    with mock.patch.object(azure_pa, "speechsdk", fake):
        engine = azure_pa.AzurePronunciationAssessor("key", "koreacentral")
        result = engine.assess(b"RIFFfakewav", "바다", "ko-KR")

    assert result.recognized_text == ""
    assert result.pronunciation_score == 0.0
    assert result.words == []
    assert not os.path.exists(captured["path"])


def test_canceled_raises_runtime_error():
    captured = {}
    fake = _make_fake_speechsdk(_FakeResultReason.Canceled, captured)
    with mock.patch.object(azure_pa, "speechsdk", fake):
        engine = azure_pa.AzurePronunciationAssessor("key", "koreacentral")
        with pytest.raises(RuntimeError):
            engine.assess(b"RIFFfakewav", "바다", "ko-KR")
    assert not os.path.exists(captured["path"])


def test_missing_credentials_raises_value_error():
    with pytest.raises(ValueError):
        azure_pa.AzurePronunciationAssessor("", "koreacentral")
