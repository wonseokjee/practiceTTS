"""azure_eval의 잣대를 고정한다.

이 파일이 지키는 것은 하나다: **Azure 수치를 노트북 수치와 같은 자로 재는가.**
`azure_eval.corpus_cer`이 `evaluate.load("cer")`와 어긋나면 "Azure 81% vs 우리
81.5%" 같은 비교가 통째로 무의미해진다. 런타임에도 `_cross_check`가 대조하지만
그건 evaluate가 설치돼 있을 때뿐이라, 여기서는 evaluate 없이도 성립하는
손계산 값으로 못을 박는다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import azure_eval as A  # noqa: E402


# ── CER: 오류 합 / 참조 문자 합 ────────────────────────────────────────

def test_identical_is_zero():
    assert A.corpus_cer(["가나다"], ["가나다"]) == 0.0


def test_deletion():
    # '나'가 빠졌다 → 편집거리 1, 참조 3자
    assert A.corpus_cer(["가나다"], ["가다"]) == 1 / 3


def test_substitution():
    assert A.corpus_cer(["가나다"], ["가라다"]) == 1 / 3


def test_insertion_counts_in_numerator_only():
    """삽입은 분자에 들어가고 분모(참조 길이)는 그대로다 — CER이 1을 넘을 수 있다."""
    assert A.corpus_cer(["가"], ["가나다라"]) == 3 / 1


def test_empty_hypothesis():
    assert A.corpus_cer(["가나다"], [""]) == 1.0


def test_aggregate_is_not_mean_of_ratios():
    """짧은 발화의 큰 오류율이 전체를 지배하지 않는다.

    긴 문장(10자, 오류 1)과 짧은 단어(1자, 오류 1)를 섞으면
    비율 평균은 (0.1 + 1.0)/2 = 0.55지만, 올바른 집계는 2/11이다.
    노트북의 evaluate도 후자를 쓴다.
    """
    refs = ["가나다라마바사아자차", "물"]
    hyps = ["가나다라마바사아자초", ""]
    assert A.corpus_cer(refs, hyps) == 2 / 11


def test_whitespace_is_normalized_like_evaluate():
    """evaluate의 cer_transform은 RemoveMultipleSpaces → Strip을 건다.

    whisper 출력은 앞에 공백이 붙는 일이 잦아서 이게 실제로 문제가 된다.
    """
    assert A.corpus_cer(["물 주세요"], ["  물   주세요  "]) == 0.0


def test_internal_space_still_counts():
    """공백 '정규화'가 공백 '제거'는 아니다 — 어절 경계가 틀리면 오류다."""
    assert A.corpus_cer(["물 주세요"], ["물주세요"]) > 0.0


# ── norm(): 단어 정확 일치 판정 ────────────────────────────────────────

def test_norm_drops_punctuation():
    assert A.norm("물, 주세요!") == "물 주세요"


def test_norm_collapses_space():
    assert A.norm("  물   주세요  ") == "물 주세요"


def test_norm_handles_none_and_empty():
    assert A.norm("") == ""
    assert A.norm(None) == ""


def test_norm_nfc():
    """자모 분리 입력(NFD)과 완성형(NFC)이 같게 취급돼야 한다."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", "물")
    assert nfd != "물"          # 전제 확인
    assert A.norm(nfd) == "물"


def test_word_exact_match_uses_norm():
    """문장부호만 다른 것은 '정확 일치'로 센다 — 노트북 report_test와 같다."""
    assert A.norm("사과.") == A.norm("사과")


# ── 잣대 동일성의 마지막 방어선 ────────────────────────────────────────

def test_cross_check_matches_evaluate_when_available():
    """evaluate가 설치돼 있으면 실제로 대조한다. 없으면 건너뛴다."""
    try:
        import evaluate
        cer = evaluate.load("cer")
    except Exception:
        import pytest
        pytest.skip("evaluate 미설치/로드 불가 — 런타임 _cross_check가 담당한다")
    refs = ["물 주세요", "가나다라마", "사과", ""]
    hyps = [" 물주세요", "가나다라마", "", "무엇"]
    refs, hyps = refs[:3], hyps[:3]          # 빈 참조는 evaluate가 거부한다
    assert abs(cer.compute(predictions=hyps, references=refs)
               - A.corpus_cer(refs, hyps)) < 1e-9


# ── 스모크 표본이 단어를 건너뛰지 않는가 ──────────────────────────────

def _rows(n_narr: int, n_word: int) -> list[dict]:
    return ([{"task_type": "narrative"}] * n_narr) + ([{"task_type": "wordlist"}] * n_word)


def test_stratified_head_keeps_both_types():
    """실제 test.jsonl은 문장 271 + 단어 146이고 문장이 앞에 몰려 있다.

    앞에서 그냥 자르면 단어가 0건이 되어 스모크가 검사 모드를 검증하지 못한다.
    """
    picked = A.stratified_head(_rows(271, 146), 10)
    kinds = {r["task_type"] for r in picked}
    assert kinds == {"narrative", "wordlist"}


def test_stratified_head_respects_ratio():
    picked = A.stratified_head(_rows(271, 146), 10)
    n_word = sum(r["task_type"] == "wordlist" for r in picked)
    assert len(picked) == 10
    assert n_word == round(10 * 146 / 417)


def test_stratified_head_never_exceeds_available():
    picked = A.stratified_head(_rows(3, 1), 100)
    assert len(picked) == 4


def test_stratified_head_preserves_order():
    rows = _rows(271, 146)
    for i, r in enumerate(rows):
        r["i"] = i
    picked = A.stratified_head(rows, 20)
    assert [r["i"] for r in picked] == sorted(r["i"] for r in picked)
