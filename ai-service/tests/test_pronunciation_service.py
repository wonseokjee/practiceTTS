"""PronunciationService 위임 테스트 (엔진 무관 경계 검증)."""
from models.pronunciation import PhonemeScore, PronunciationResult, WordScore
from services.pronunciation_service import PronunciationService


class _FakeAssessor:
    """호출 인자를 기록하고 고정 결과를 돌려주는 가짜 엔진."""

    def __init__(self):
        self.calls = []

    @property
    def name(self):
        return "fake"

    def assess(self, wav_bytes, reference_text, lang):
        self.calls.append((wav_bytes, reference_text, lang))
        return PronunciationResult(
            recognized_text="바다",
            accuracy_score=91.0,
            fluency_score=88.0,
            completeness_score=100.0,
            pronunciation_score=90.0,
            prosody_score=None,
            words=[
                WordScore(
                    word="바다",
                    accuracy=91.0,
                    error_type="None",
                    phonemes=[PhonemeScore(phoneme="b", accuracy=92.0)],
                )
            ],
        )


def test_service_delegates_to_assessor():
    assessor = _FakeAssessor()
    service = PronunciationService(assessor=assessor)

    result = service.assess(b"wav", "바다", "ko-KR")

    assert assessor.calls == [(b"wav", "바다", "ko-KR")]
    assert result.pronunciation_score == 90.0
    assert result.words[0].word == "바다"
    assert service.engine_name == "fake"
