"""목표 단어 검증 모듈 검증.

- 판정 로직(τ 고르기·오판정/오통과·판정 띠·사례 구성): 모델 없이
- 채점(`sequence_logprobs`): 작은 whisper(tiny)로 로컬 CPU에서 실제 홀드아웃 클립을 채점한다.
  Colab은 large-v3-turbo지만 코드 경로는 같다. 모델·데이터가 없으면 건너뛴다.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import target_verification as T  # noqa: E402


# ─── τ 고르기 · 비율 ─────────────────────────────────────────────


def test_choose_tau_allows_exactly_floor_fa_of_negatives():
    neg = [float(i) for i in range(40)]          # 0..39, N=40 → 허용 ⌊0.05·40⌋ = 2개
    tau = T.choose_tau(neg, 0.05)
    _, fa = T.rates([], neg, tau)
    assert sum(s >= tau for s in neg) == 2       # 39, 38만 통과
    assert fa == 0.05
    assert 37.0 < tau <= 38.0                    # 37은 막힌다 — 가장 너그러운 경계


def test_choose_tau_ties_at_the_boundary_are_blocked_together():
    # 경계 점수가 여럿 동점이면 함께 막는다(하나만 통과시키는 τ는 없다)
    neg = [5.0, 5.0, 5.0, 1.0] + [0.0] * 36      # N=40, 허용 2 — 동점 셋이라 셋 다 막아야 한다
    tau = T.choose_tau(neg, 0.05)
    assert sum(s >= tau for s in neg) == 0
    assert tau > 5.0


def test_choose_tau_edge_cases():
    assert T.choose_tau([], 0.05) == float("-inf")
    assert T.choose_tau([1.0], 1.0) == float("-inf")   # 전부 허용
    t = T.choose_tau([0.0] * 10, 0.05)                 # 허용 0개
    assert t > 0.0


def test_rates_definition():
    pos, neg = [0.0, -1.0, -3.0, 1.0], [-5.0, -0.5, 0.2]
    fr, fa = T.rates(pos, neg, -0.5)
    assert fr == 2 / 4                                 # -1.0·-3.0이 떨어진다
    assert fa == 2 / 3                                 # -0.5(동점 통과)·0.2
    assert math.isnan(T.rates([], [], 0)[0])


def test_margin_is_target_minus_hyp():
    assert T.margin(-1.0, -3.0) == 2.0 and T.margin(-2.0, -2.0) == 0.0


# ─── 판정 띠 ────────────────────────────────────────────────────


def test_verdict_bands():
    assert T.verdict(0.05, 0.10, 0.20).startswith("채택")
    assert T.verdict(0.0501, 0.10, 0.20).startswith("보류")
    assert T.verdict(0.10, 0.10, 0.20).startswith("보류")
    assert T.verdict(0.1001, 0.10, 0.20).startswith("기각")
    # 오판정이 현행보다 낮지 않으면 오통과와 무관하게 기각
    assert T.verdict(0.01, 0.20, 0.20).startswith("기각")
    assert T.verdict(0.01, 0.25, 0.20).startswith("기각")
    # 현행 오판정률이 아직 없으면 그 부분은 대기로 적는다
    assert "대기" in T.verdict(0.01, 0.10, None) and T.verdict(0.01, 0.10, None).startswith("채택")


# ─── 사례 구성 ──────────────────────────────────────────────────


def _accepted(said, target):
    return said == target or said in target and len(said) >= 0.6 * len(target)


def test_build_cases_uses_fair_rows_and_counted_foils_and_drops_accepted_variants():
    rows = [
        {"text": "나무", "orig_split": "train", "audio": "a.wav"},       # 공정 아님
        {"text": "나무", "orig_split": "test", "audio": "b.wav"},
        {"text": "사탕 ", "orig_split": "dev", "audio": "c.wav"},
    ]
    foils = {
        "나무": {"foils": [
            {"foil": "마루", "kind": "phon", "counts_for_fa": True},
            {"foil": "통나무", "kind": "phon", "counts_for_fa": True},   # 나무 ⊂ 통나무 — 정답 변형
            {"foil": "나뮤", "kind": "para", "counts_for_fa": False},
            {"foil": "새싹", "kind": "sem", "counts_for_fa": True},
        ]},
        "사탕": {"foils": [{"foil": "사자", "kind": "phon", "counts_for_fa": True}]},
    }
    cases = T.build_cases(rows, foils, _accepted)
    assert [c["row"] for c in cases] == [1, 2]
    assert [(x["text"], x["kind"], x["counts"]) for x in cases[0]["candidates"]] == [
        ("나무", "target", False), ("마루", "phon", True), ("나뮤", "para", False), ("새싹", "sem", True)]
    assert cases[1]["word"] == "사탕" and cases[1]["candidates"][0]["text"] == "사탕"


def test_split_scored_and_word_bootstrap():
    rows = [
        {"word": "a", "orig_split": "test", "candidates": [
            {"kind": "target", "counts": False, "s": 0.0}, {"kind": "phon", "counts": True, "s": -2.0},
            {"kind": "para", "counts": False, "s": -0.3}]},
        {"word": "b", "orig_split": "test", "candidates": [
            {"kind": "target", "counts": False, "s": -1.0}, {"kind": "sem", "counts": True, "s": -0.1}]},
    ]
    pos, neg, ref = T.split_scored(rows)
    assert [p["s"] for p in pos] == [0.0, -1.0] and [n["kind"] for n in neg] == ["phon", "sem"]
    assert [x["kind"] for x in ref] == ["para"]
    lo, hi = T.word_bootstrap(pos, lambda xs: sum(x["s"] for x in xs) / len(xs), b=200)
    assert lo <= -0.5 <= hi
    assert T.word_bootstrap(pos, lambda xs: 0.0, b=10) == (0.0, 0.0)
    # 결정적이다
    assert T.word_bootstrap(pos, lambda xs: xs[0]["s"], b=50) == T.word_bootstrap(pos, lambda xs: xs[0]["s"], b=50)


# ─── 실제 사례 파일 ─────────────────────────────────────────────

CASES = Path(__file__).parent / "golden" / "target_verification_cases.json"


def test_committed_cases_file_matches_rebuild():
    """커밋된 사례 파일이 지금 코드·데이터로 다시 만든 것과 같다(홀드아웃 패키지가 있을 때만)."""
    import build_verification_cases as B
    if not B.HOLDOUT.exists():
        pytest.skip("로컬에 홀드아웃 패키지가 없다")
    assert json.loads(CASES.read_text(encoding="utf-8")) == B.build()


def test_cases_file_shape():
    data = json.loads(CASES.read_text(encoding="utf-8"))
    cases = data["cases"]
    assert len(cases) == 457                                   # 공정 행 수(12차 평가와 같다)
    assert {c["orig_split"] for c in cases} == {"dev", "test"}
    assert sum(c["orig_split"] == "dev" for c in cases) == 176
    for c in cases:
        kinds = [x["kind"] for x in c["candidates"]]
        assert kinds[0] == "target" and c["candidates"][0]["text"] == c["word"]
        assert set(kinds[1:]) <= {"phon", "sem", "para", "rand"}
        assert all(x["counts"] == (x["kind"] in ("phon", "sem")) for x in c["candidates"])
        texts = [x["text"] for x in c["candidates"]]
        assert len(texts) == len(set(texts))


# ─── 실제 채점 (작은 whisper) ───────────────────────────────────

HOLDOUT = Path(os.path.expanduser("~/Downloads/608-audio-work/colab_trainset_big7_vochold"))


@pytest.fixture(scope="module")
def tiny():
    pytest.importorskip("transformers")
    pytest.importorskip("soundfile")
    if not HOLDOUT.exists():
        pytest.skip("로컬에 홀드아웃 패키지가 없다")
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    try:
        proc = WhisperProcessor.from_pretrained("openai/whisper-tiny", language="ko", task="transcribe")
        model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-tiny").eval()
    except Exception as e:  # 오프라인 등
        pytest.skip(f"whisper-tiny를 못 불렀다: {e}")
    return proc, model


def _clip(proc, word="사과"):
    import soundfile as sf
    rows = [json.loads(l) for l in (HOLDOUT / "holdout_eval.jsonl").open(encoding="utf-8")]
    r = next(x for x in rows if x["text"].strip() == word and x["orig_split"] == "test")
    a, sr = sf.read(HOLDOUT / r["audio"])
    assert sr == 16000
    return proc.feature_extractor(a, sampling_rate=16000).input_features[0]


def test_prefix_is_everything_before_text_in_the_training_label(tiny):
    proc, _ = tiny
    ids = T.label_ids(proc, "사과")
    body = proc.tokenizer("사과", add_special_tokens=False).input_ids
    assert ids[T.prefix_len(proc):] == body + [proc.tokenizer.eos_token_id]


def test_batched_scores_equal_scoring_each_alone(tiny):
    """후보를 한 배치로 채점해도(패딩이 섞여도) 하나씩 채점한 것과 같다."""
    proc, model = tiny
    feats = _clip(proc)
    texts = ["사과", "사과요 사과요", "사", "학교"]
    batched = T.sequence_logprobs(model, proc, feats, texts)
    alone = [T.sequence_logprobs(model, proc, feats, [t])[0] for t in texts]
    for b, a in zip(batched, alone):
        assert abs(b - a) < 1e-4
    # 순서를 바꿔도 같다
    rev = T.sequence_logprobs(model, proc, feats, list(reversed(texts)))
    assert all(abs(x - y) < 1e-4 for x, y in zip(batched, reversed(rev)))


def test_score_matches_the_model_loss(tiny):
    """평균 log p가 모델 자체의 손실(labels를 준 forward)과 같은 값이다 — 접두를 뺀 부분까지 포함해 검증."""
    import torch
    proc, model = tiny
    feats = _clip(proc)
    ids = T.label_ids(proc, "사과")
    with torch.no_grad():
        out = model(input_features=torch.as_tensor(feats).unsqueeze(0), labels=torch.tensor([ids]))
    # 모델 손실은 접두 포함 전체 평균 — 접두 포함으로 다시 계산해 대조한다
    import target_verification as TV
    skip = TV.prefix_len
    TV.prefix_len = lambda p: 0
    try:
        full = T.sequence_logprobs(model, proc, feats, ["사과"])[0]
    finally:
        TV.prefix_len = skip
    assert abs(full - (-float(out.loss))) < 1e-4


def test_empty_candidate_is_scored_not_crashed(tiny):
    proc, model = tiny
    s = T.sequence_logprobs(model, proc, _clip(proc), ["", "사과"])
    assert all(math.isfinite(x) for x in s)
