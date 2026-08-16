"""app_scorer 이식 검증 — 프론트 원본과 같은 답을 내는지 고정한다.

아래 사례는 대부분 `frontend/.../domain/speechScore.test.ts`와
`phoneticDistance.test.ts`를 **그대로 미러링**한 것이다. 같은 입력에 같은 답이
나오지 않으면 이식이 어긋난 것이고, ASR 평가 수치가 앱 동작과 달라진다.
원본을 고칠 때 이 파일도 같이 고쳐야 한다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app_scorer import (  # noqa: E402
    SPEECH_PASS_THRESHOLD,
    decompose_hangul,
    is_speech_correct,
    score_batch,
    speech_error_rate,
    syllable_phonetic_cost,
)


# ─── 자모 분해 ────────────────────────────────────────────────

def test_한글_분해():
    assert decompose_hangul("각") == ("ㄱ", "ㅏ", "ㄱ")
    assert decompose_hangul("가") == ("ㄱ", "ㅏ", "")


def test_한글이_아니면_None():
    assert decompose_hangul("a") is None
    assert decompose_hangul("1") is None


# ─── 음절 비용 ────────────────────────────────────────────────

def test_같은_음절은_비용_0():
    assert syllable_phonetic_cost("바", "바") == 0.0


def test_조음_위치가_같으면_부분_비용():
    # ㅂ↔ㅍ 양순 파열음: 구음장애에서 가장 흔한 혼동
    assert syllable_phonetic_cost("바", "파") == 0.3 * 0.4


def test_종성_탈락은_관대():
    # '반'→'바': 종성만 빠짐 → JONG_DROP_COST(0.4) × W_JONG(0.2)
    assert syllable_phonetic_cost("반", "바") == 0.4 * 0.2


def test_한글이_아니면_완전_불일치():
    assert syllable_phonetic_cost("a", "바") == 1.0


# ─── 오류율 (speechScore.test.ts 미러) ────────────────────────

def test_완전_일치는_오류율_0():
    assert speech_error_rate("사과", "사과", "word") == 0
    assert speech_error_rate("오늘 날씨가 좋아요", "오늘 날씨가 좋아요", "sentence") == 0


def test_단어_조음_유사_혼동은_관대():
    # "바다"→"파다"(ㅂ↔ㅍ) — 부분 오류만
    assert speech_error_rate("파다", "바다", "word") < 0.2


def test_단어_조음_위치가_다르면_큰_오류율():
    # 너무 관대하면 QAB 점수의 진단 변별력이 떨어진다
    assert speech_error_rate("하수", "바다", "word") > SPEECH_PASS_THRESHOLD


def test_문장_한_어절_차이는_어절수분의_1():
    got = speech_error_rate("오늘 날씨가 추워요", "오늘 날씨가 좋아요", "sentence")
    assert abs(got - 1 / 3) < 1e-9


def test_구두점_대소문자_공백은_무시():
    assert speech_error_rate("  오늘   날씨가 좋아요! ", "오늘 날씨가 좋아요", "sentence") == 0


def test_목표가_비면_오류율_1():
    assert speech_error_rate("사과", "", "word") == 1


# ─── 정답 판정 (speechScore.test.ts 미러) ─────────────────────

def test_완전_일치는_정답():
    assert is_speech_correct("사과", "사과", "word") is True


def test_긴_문장에서_한_어절_차이는_정답():
    # 4어절 중 1어절 차이 = 0.25 ≤ 0.34
    assert is_speech_correct(
        "가족이 함께 점심을 먹어요", "가족이 함께 저녁을 먹어요", "sentence"
    ) is True


def test_절반이_틀리면_오답():
    assert is_speech_correct("바나나", "사과", "word") is False


def test_빈_입력은_오답():
    assert is_speech_correct("", "사과", "word") is False
    assert is_speech_correct("   ", "오늘 날씨가 좋아요", "sentence") is False


# ─── 1음절 목표에서 등급 해상도가 무너지는 것 (부채 재현) ──────

def test_1음절_목표는_통과_아니면_큰_오류율():
    """분모가 1이라 중간 등급이 사실상 없다.

    docs/history/20260816_speech_grade_threshold_debt.md 참조. 조음 유사 혼동만
    경계 아래로 들어오고, 그 외에는 임계값을 훌쩍 넘는다.
    """
    assert speech_error_rate("바", "바", "word") == 0            # 일치
    assert speech_error_rate("파", "바", "word") <= SPEECH_PASS_THRESHOLD  # 유사 → 통과
    assert speech_error_rate("수", "바", "word") > 0.5           # 다르면 곧장 큰 값


# ─── 묶음 채점 ────────────────────────────────────────────────

def test_통과율은_평균_오류율과_다르다():
    """평균이 임계값 아래여도 통과율은 100%가 아니다 — 그래서 따로 낸다.

    "평균 단어 CER이 0.34 아래니까 앱에서 다 통과한다"는 추론이 틀렸음을 못박는다.
    아래는 4개 중 3개가 완전 일치인데도 통과율이 75%다.
    """
    hyps = ["사과", "사과", "사과", "바나나"]
    refs = ["사과", "사과", "사과", "사과"]

    got = score_batch(hyps, refs, "word")

    assert got["n"] == 4
    assert got["pass_rate"] == 3 / 4
    assert got["error_rate"] < SPEECH_PASS_THRESHOLD   # 평균은 경계 아래인데(0.275)


def test_빈_묶음():
    got = score_batch([], [], "word")
    assert got == {"error_rate": 0.0, "pass_rate": 0.0, "n": 0}
