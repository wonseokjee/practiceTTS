"""영어 로컬 PII 감지 — 코퍼스(튜닝용)와 홀드아웃(튜닝 금지)을 CI로 고정한다.

한국어와 같은 이유로 미탐·과탐을 함께 잰다. 이 테스트가 실패하면 감지기를 바꾸기 전에
코퍼스가 무엇을 요구하는지부터 본다. 홀드아웃 실패를 고치려고 감지기를 손보면 홀드아웃도
튜닝 세트가 되므로, 그때는 새 홀드아웃 문장을 써야 한다.
"""
import pytest

from constants.english_pii import detect_english_pii
from tests.masking_corpus_en import MUST_MASK, MUST_NOT_MASK
from tests import masking_holdout_en as holdout


def _masked(text: str) -> str:
    out = text
    for value, kind in detect_english_pii(text):
        out = out.replace(value, f"[{kind.upper()}]")
    return out


@pytest.mark.parametrize("sentence,secret", MUST_MASK + holdout.MUST_MASK)
def test_pii_is_masked(sentence: str, secret: str) -> None:
    # 이메일은 서비스의 공용 정규식이 맡는다 — 영어 감지기 밖이다
    if "@" in secret:
        pytest.skip("이메일은 공용 정규식(_PATTERNS)이 처리")
    assert secret not in _masked(sentence)


@pytest.mark.parametrize("sentence", MUST_NOT_MASK + holdout.MUST_NOT_MASK)
def test_ordinary_text_untouched(sentence: str) -> None:
    assert _masked(sentence) == sentence
