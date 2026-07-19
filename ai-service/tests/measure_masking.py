"""마스킹 정확도 측정 (Gemini 호출 없이 정규식 + 사전 계층만).

실행:  cd ai-service && python tests/measure_masking.py

3계층(Gemini)은 네트워크·비용이 들고 비결정적이라 제외한다. 여기서 재는
것은 **로컬에서 확실히 막을 수 있는 범위**다. 이 값이 낮을수록 Gemini에
의존하게 되고, Gemini가 실패하면 그대로 유출된다.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from constants.korean_pii import detect_korean_pii  # noqa: E402
from services.masking_service import _PATTERNS  # noqa: E402
import os  # noqa: E402

if os.environ.get("HOLDOUT"):
    from tests.masking_holdout import MUST_MASK, MUST_NOT_MASK  # noqa: E402
else:
    from tests.masking_corpus import MUST_MASK, MUST_NOT_MASK  # noqa: E402


def locally_masked(text: str) -> str:
    """정규식 + 한국어 사전 계층만 적용한 결과를 흉내 낸다."""
    result = text
    for name, pattern in _PATTERNS.items():
        for match in pattern.finditer(text):
            original = match.group(1) if match.groups() else match.group()
            if original:
                result = result.replace(original, f"[{name.upper()}]")
    for value, kind in detect_korean_pii(result):
        result = result.replace(value, f"[{kind.upper()}]")
    return result


def main() -> int:
    leaks = []
    for sentence, secret in MUST_MASK:
        if secret in locally_masked(sentence):
            leaks.append((sentence, secret))

    false_positives = []
    for sentence in MUST_NOT_MASK:
        masked = locally_masked(sentence)
        if masked != sentence:
            false_positives.append((sentence, masked))

    blocked = len(MUST_MASK) - len(leaks)
    clean = len(MUST_NOT_MASK) - len(false_positives)

    print("=" * 68)
    print(f"미탐 검사: {blocked}/{len(MUST_MASK)} 차단 "
          f"({blocked / len(MUST_MASK) * 100:.0f}%)")
    for sentence, secret in leaks:
        print(f"  [유출] {sentence}   <- '{secret}' 그대로 남음")

    print(f"\n과탐 검사: {clean}/{len(MUST_NOT_MASK)} 무사 "
          f"({clean / len(MUST_NOT_MASK) * 100:.0f}%)")
    for sentence, masked in false_positives:
        print(f"  [파괴] {sentence}\n         -> {masked}")
    print("=" * 68)

    return 0 if not leaks and not false_positives else 1


if __name__ == "__main__":
    raise SystemExit(main())
