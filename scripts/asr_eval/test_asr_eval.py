"""asr_eval 하네스 테스트 — 오디오 없이 지표·스플릿 불변식을 고정한다.

실행: python -m pytest scripts/asr_eval/test_asr_eval.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import metrics as M
import split_speakers as S
import personalization_curve as P
import adapters as A


# ─── metrics ─────────────────────────────────────────────────────


def test_cer_perfect_is_zero():
    assert M.cer_stat("바다에 갔다", "바다에 갔다").rate == 0.0


def test_cer_counts_char_edits():
    # 정답 "바다"(2글자), 가설 "바나" → 1치환 → CER 0.5
    st = M.cer_stat("바나", "바다")
    assert st.length == 2 and st.edits == 1
    assert st.rate == 0.5


def test_cer_ignores_spacing_and_punct():
    # 공백/구두점 차이만 있으면 CER 0 (글자 기준 + 부호 제거)
    assert M.cer_stat("바다에, 갔다!", "바다에갔다").rate == 0.0


def test_wer_word_level():
    # 3단어 중 1단어 오인식 → WER 1/3
    st = M.wer_stat("나는 밥을 먹다", "나는 밥을 먹었다")
    assert st.length == 3 and st.edits == 1


def test_corpus_cer_microaverage():
    # 마이크로평균: 긴 정답의 오류가 더 크게 반영된다
    pairs = [("바다", "바다"), ("사가", "사과")]  # 0/2, 1/2
    assert M.corpus_cer(pairs) == 0.25  # (0+1)/(2+2)


def test_error_stat_adds():
    total = M.ErrorStat(1, 4) + M.ErrorStat(2, 6)
    assert total.edits == 3 and total.length == 10 and total.rate == 0.3


# ─── speaker parsing / split ─────────────────────────────────────


def test_speaker_of_uses_token_after_N():
    assert S.speaker_of("ID-01-15-N-KSW-04-M-53-JL.wav") == "KSW"
    assert S.speaker_of("ID-02-25-N-KSM-02-01-M-45-JL.wav") == "KSM"
    assert S.speaker_of("ID-01-15-N-PYG-01-02-M-47-SU1.wav") == "PYG"


def test_speaker_of_falls_back_to_index4():
    # 'N' 마커가 없는 예외 포맷도 결정적으로 처리
    assert S.speaker_of("ID-01-15-X-ZZZ-04.wav") == "ZZZ"


def _rows():
    # 화자 3명(A: 2발화, B: 1, C: 1), 두 질환
    return [
        {"file_id": "ID-01-11-N-AAA-01-M-50-SU.wav", "category_code": "11", "play_time_sec": 60, "transcript_len": 10, "split": "train"},
        {"file_id": "ID-01-11-N-AAA-02-M-50-SU.wav", "category_code": "11", "play_time_sec": 60, "transcript_len": 10, "split": "val"},
        {"file_id": "ID-01-12-N-BBB-01-F-40-JL.wav", "category_code": "12", "play_time_sec": 30, "transcript_len": 5, "split": "train"},
        {"file_id": "ID-01-12-N-CCC-01-F-40-JL.wav", "category_code": "12", "play_time_sec": 30, "transcript_len": 5, "split": "val"},
    ]


def test_split_is_speaker_disjoint():
    # 어떤 시드로도 한 화자가 두 split에 동시에 들어가면 안 된다
    for seed in range(20):
        sp = S.build_speaker_split(
            _rows(), test_speaker_frac=0.34, dev_speaker_frac=0.0, seed=seed
        )
        S.assert_disjoint(sp)  # 위반 시 AssertionError


def test_split_keeps_all_utterances_of_a_speaker_together():
    # 화자 AAA는 발화 2개(train/val 섞여 있어도) 반드시 같은 split으로
    sp = S.build_speaker_split(
        _rows(), test_speaker_frac=0.0, dev_speaker_frac=0.0, seed=1
    )
    # 전부 train(테스트 비율 0) → train rows에 AAA 발화 2개 모두 포함
    train_rows = S.rows_for(_rows(), set(sp.train))
    aaa = [r for r in train_rows if S.speaker_of(r["file_id"]) == "AAA"]
    assert len(aaa) == 2


def test_audit_detects_aihub_leakage():
    # AAA가 train과 val 양쪽에 있음 → 누수 1명 탐지
    audit = S.audit_aihub_leakage(_rows())
    assert audit["leaked_count"] == 1
    assert "AAA" in audit["leaked_speakers"]


def test_budgets_aggregate_per_speaker():
    buds = S.budgets(_rows())
    assert buds["AAA"].utterances == 2
    assert buds["AAA"].seconds == 120
    assert buds["BBB"].utterances == 1


# ─── personalization curve ───────────────────────────────────────


def _utts(n: int, sec: float = 60.0):
    return [
        {"file_id": f"ID-01-11-N-AAA-{i:02d}-M-50-SU.wav", "play_time_sec": sec, "transcript": "가"}
        for i in range(n)
    ]


def test_adapt_holdout_never_overlap():
    # 적응에 쓴 발화가 홀드아웃에 절대 섞이면 안 된다(누수 방지 불변식)
    utts = _utts(6, sec=60.0)
    for minutes in (0, 1, 3, 6, 100):
        adapt, holdout = P.split_adapt_holdout(utts, minutes)
        a_ids = {r["file_id"] for r in adapt}
        h_ids = {r["file_id"] for r in holdout}
        assert not (a_ids & h_ids)
        assert len(a_ids) + len(h_ids) == 6  # 손실 없이 전부 분배


def test_adapt_budget_respected():
    # 60초짜리 6발화, 3분(180초) 적응 → 앞 3발화만 적응
    adapt, holdout = P.split_adapt_holdout(_utts(6, 60.0), 3.0)
    assert len(adapt) == 3 and len(holdout) == 3


def test_zero_minutes_is_all_holdout():
    adapt, holdout = P.split_adapt_holdout(_utts(4), 0.0)
    assert adapt == [] and len(holdout) == 4


def test_curve_is_monotone_decreasing_with_sim_adapter():
    # 가상 적응기에서 적응 분량이 늘수록 평균 CER은 단조 감소해야 한다
    rows = _utts(20, sec=30.0)  # 화자 1명, 홀드아웃 충분
    res = P.curve(rows, [0, 1, 3, 5], P.simulated_adapter())
    vals = [res["mean_cer"][m] for m in [0, 1, 3, 5]]
    assert all(a >= b for a, b in zip(vals, vals[1:]))


# ─── adapters (오디오 없이 검증 가능한 부분) ──────────────────────


def test_build_bias_prompt_prefers_latest_within_budget():
    # 예산을 넘으면 오래된(앞) 전사를 버리고 최신(뒤)을 남긴다
    adapt = [
        {"transcript": "가" * 300},
        {"transcript": "나" * 300},
    ]
    prompt = A.build_bias_prompt(adapt, char_budget=350)
    assert "나" in prompt and "가" not in prompt  # 최신만 살아남음


def test_build_bias_prompt_joins_when_fits():
    adapt = [{"transcript": "바다"}, {"transcript": "하늘"}]
    prompt = A.build_bias_prompt(adapt, char_budget=100)
    assert "바다" in prompt and "하늘" in prompt


def test_prompt_adapter_no_prompt_at_zero_minutes():
    # 0분(적응 없음)에서는 initial_prompt를 비운 채 인식해야 한다(베이스라인 지점)
    seen = {}

    def fake_recognize(path, initial_prompt):
        seen["prompt"] = initial_prompt
        return "바다"  # 정답과 동일 → CER 0

    ad = A.PromptBiasingAdapter(
        recognize=fake_recognize, resolve_audio=lambda r: Path("x.wav")
    )
    holdout = [{"transcript": "바다", "file_id": "ID-01-11-N-AAA-01-M-50-SU.wav"}]
    cer = ad.adapt_and_eval([{"transcript": "무시"}], holdout, minutes=0)
    assert cer == 0.0
    assert seen["prompt"] == ""  # 0분에서는 프롬프트 비움


def test_prompt_adapter_biases_with_adapt_text_when_minutes_positive():
    seen = {}

    def fake_recognize(path, initial_prompt):
        seen["prompt"] = initial_prompt
        return "바다"

    ad = A.PromptBiasingAdapter(
        recognize=fake_recognize, resolve_audio=lambda r: Path("x.wav")
    )
    holdout = [{"transcript": "바다", "file_id": "ID-01-11-N-AAA-02-M-50-SU.wav"}]
    ad.adapt_and_eval([{"transcript": "하늘"}], holdout, minutes=3)
    assert "하늘" in seen["prompt"]  # 적응 전사가 프롬프트로 편향


def test_prompt_adapter_skips_missing_audio():
    # 오디오를 못 찾으면 그 발화는 채점에서 빠지고, 전부 없으면 None
    ad = A.PromptBiasingAdapter(
        recognize=lambda p, ip: "x", resolve_audio=lambda r: None
    )
    holdout = [{"transcript": "바다", "file_id": "ID-01-11-N-AAA-03-M-50-SU.wav"}]
    assert ad.adapt_and_eval([], holdout, minutes=0) is None


def test_curve_accepts_adapter_object():
    # curve는 Adapter 객체(.adapt_and_eval)도 콜러블처럼 받는다
    ad = A.PromptBiasingAdapter(
        recognize=lambda p, ip: "가", resolve_audio=lambda r: Path("x.wav")
    )
    rows = _utts(4, sec=30.0)  # transcript "가"
    res = P.curve(rows, [0], ad)
    assert res["mean_cer"][0] == 0.0  # 인식="가"=정답 → CER 0


def test_finetune_adapter_is_explicit_not_silent():
    with __import__("pytest").raises(NotImplementedError):
        A.FinetuneAdapter().adapt_and_eval([], [{"transcript": "x"}], 1)
