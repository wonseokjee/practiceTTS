"""asr_eval 하네스 테스트 — 오디오 없이 지표·스플릿 불변식을 고정한다.

실행: python -m pytest scripts/asr_eval/test_asr_eval.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import metrics as M
import split_speakers as S
import personalization_curve as P
import adapters as A
import build_training_set as B
import prepare_colab_trainset as PC


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


# ─── training-set builder (라벨 품질 필터) ────────────────────────


def _clf(row):
    return B.classify_label(row, min_score=70, max_label_cer=0.2)


def test_pronunciation_clean_when_score_high():
    assert _clf({"task": "pronunciation", "target_text": "사과", "score": 85}) == "clean"


def test_pronunciation_weak_when_score_low_or_missing():
    # 점수가 낮으면(목표에서 멂) 오염 가능 → weak
    assert _clf({"task": "pronunciation", "target_text": "사과", "score": 40}) == "weak"
    # 점수 자체가 없으면 판단 불가 → weak
    assert _clf({"task": "pronunciation", "target_text": "사과"}) == "weak"


def test_stt_clean_when_hypothesis_matches_target():
    # 가설이 목표와 일치 → 라벨 신뢰
    assert _clf({"task": "stt", "target_text": "바다", "recognized_text": "바다"}) == "clean"


def test_stt_weak_when_hypothesis_far_from_target():
    # 목표 "사과"인데 "바나나"로 인식 → 오염 라벨 → weak
    assert (
        _clf({"task": "stt", "target_text": "사과", "recognized_text": "바나나"}) == "weak"
    )


def test_weak_when_no_hypothesis_or_no_target():
    assert _clf({"task": "naming", "target_text": "사과", "recognized_text": ""}) == "weak"
    assert _clf({"task": "stt", "target_text": "", "recognized_text": "사과"}) == "weak"


def test_get_supports_snake_and_camel():
    # DB export(snake) / TypeORM(camel) 어느 쪽 키든 읽는다
    assert B._get({"target_text": "가"}, "target_text", "targetText") == "가"
    assert B._get({"targetText": "나"}, "target_text", "targetText") == "나"


def test_build_split_is_speaker_disjoint():
    speakers = [f"p{i}" for i in range(20)]
    for seed in range(10):
        sp = B.build_split(speakers, test_frac=0.2, dev_frac=0.1, seed=seed)
        assert not (sp["train"] & sp["dev"])
        assert not (sp["train"] & sp["test"])
        assert not (sp["dev"] & sp["test"])
        # 모든 화자가 정확히 한 split에
        assert len(sp["train"]) + len(sp["dev"]) + len(sp["test"]) == 20


# ─── Colab 학습셋 준비 ────────────────────────────────────────────


def test_keep_filters_empty_and_out_of_range():
    ok = {"reference_text": "가", "segment_wav_relpath": "a.wav", "start": 0, "end": 5}
    assert PC.keep(ok, min_sec=1, max_sec=30)
    # 전사 없음
    assert not PC.keep({**ok, "reference_text": " "}, min_sec=1, max_sec=30)
    # wav 없음
    assert not PC.keep({**ok, "segment_wav_relpath": ""}, min_sec=1, max_sec=30)
    # 너무 짧음 / 너무 김(whisper 30초 초과)
    assert not PC.keep({**ok, "end": 0.5}, min_sec=1, max_sec=30)
    assert not PC.keep({**ok, "end": 40}, min_sec=1, max_sec=30)


def test_colab_split_disjoint_and_deterministic():
    speakers = [f"s{i}" for i in range(10)]
    a1 = PC.split_speakers(speakers, test_frac=0.2, dev_frac=0.0, seed=7)
    a2 = PC.split_speakers(speakers, test_frac=0.2, dev_frac=0.0, seed=7)
    assert a1 == a2  # 결정적
    tests = {s for s, v in a1.items() if v == "test"}
    trains = {s for s, v in a1.items() if v == "train"}
    assert not (tests & trains)  # 한 화자는 한 split만
    assert len(tests) == 2  # round(10*0.2)


def test_colab_split_persisted_survives_batch_growth(tmp_path):
    """회귀 방지: split_speakers()는 화자 수가 바뀌면 같은 seed라도 재셔플되어
    기존 화자의 train/test가 뒤바뀐다(배치 병합마다 재현성이 깨지는 실측 버그).
    split_speakers_persisted()는 split_file에 봉인해 기존 배정을 절대 바꾸지
    않아야 한다 — 이게 이 함수의 존재 이유다."""
    split_file = tmp_path / "speaker_split.json"

    batch1 = [f"s{i}" for i in range(20)]
    a1 = PC.split_speakers_persisted(
        batch1, test_frac=0.2, dev_frac=0.0, seed=42, split_file=split_file
    )

    # 화자 15명이 추가된 2차 배치(화자 집합 크기가 바뀐다).
    batch2 = batch1 + [f"s{i}" for i in range(20, 35)]
    a2 = PC.split_speakers_persisted(
        batch2, test_frac=0.2, dev_frac=0.0, seed=42, split_file=split_file
    )

    # 기존 화자의 배정은 1차와 완전히 동일해야 한다.
    assert all(a1[s] == a2[s] for s in batch1)
    # split_file에 병합된 전체 배정이 영속화돼 있어야 한다.
    saved = json.loads(split_file.read_text(encoding="utf-8"))
    assert saved == a2
    # 신규 화자도 결국 배정되고, 한 화자는 한 split만 갖는다(누수 없음).
    assert set(a2) == set(batch2)


def test_colab_split_persisted_dev를_train에서만_승격한다(tmp_path):
    """dev_frac 0으로 봉인된 split을 이어 쓰며 dev를 만들 때, dev는 train에서만
    나와야 한다. test 화자가 바뀌면 이전 배치와 가로 비교가 불가능해지고, 예전
    train 화자가 test로 가면 누수다. 1~6차가 dev 없이 돌아간 실측 버그의 회귀."""
    split_file = tmp_path / "speaker_split.json"

    speakers = [f"s{i}" for i in range(20)]
    a1 = PC.split_speakers_persisted(
        speakers, test_frac=0.2, dev_frac=0.0, seed=42, split_file=split_file
    )
    assert sum(1 for v in a1.values() if v == "dev") == 0  # 전제: dev 없음

    # 화자 추가 없이 dev_frac만 올려 재패키징한다(7차 재패키징과 같은 상황).
    a2 = PC.split_speakers_persisted(
        speakers, test_frac=0.2, dev_frac=0.1, seed=42, split_file=split_file
    )

    assert sum(1 for v in a2.values() if v == "dev") == 2  # round(20 * 0.1)
    # test는 한 명도 바뀌지 않는다.
    assert {s for s, v in a1.items() if v == "test"} == {
        s for s, v in a2.items() if v == "test"
    }
    # 승격된 화자는 전부 이전에 train이던 화자다.
    assert all(a1[s] == "train" for s, v in a2.items() if v == "dev")


def test_colab_split_persisted_승격은_결정적이다(tmp_path):
    """같은 입력이면 같은 화자가 dev로 간다. 재패키징마다 dev가 바뀌면
    체크포인트 선택 기준이 흔들려 회차 간 비교가 또 깨진다."""
    speakers = [f"s{i}" for i in range(20)]

    def run(path):
        f = tmp_path / path
        PC.split_speakers_persisted(
            speakers, test_frac=0.2, dev_frac=0.0, seed=42, split_file=f
        )
        return PC.split_speakers_persisted(
            speakers, test_frac=0.2, dev_frac=0.1, seed=42, split_file=f
        )

    assert run("a.json") == run("b.json")


def test_colab_split_persisted_dev가_충분하면_건드리지_않는다(tmp_path):
    """이미 목표치를 채운 dev를 재패키징이 다시 흔들면 안 된다."""
    split_file = tmp_path / "speaker_split.json"
    speakers = [f"s{i}" for i in range(20)]

    a1 = PC.split_speakers_persisted(
        speakers, test_frac=0.2, dev_frac=0.1, seed=42, split_file=split_file
    )
    a2 = PC.split_speakers_persisted(
        speakers, test_frac=0.2, dev_frac=0.1, seed=42, split_file=split_file
    )

    assert a1 == a2


# ─── refine_segments ────────────────────────────────────────

def _profile(values):
    import numpy as np
    return np.asarray(values, dtype=np.float32)


def test_refine_bounds_피크_주변만_잘라낸다():
    """침묵 한가운데 단어 하나 — 발화 구간만 남아야 한다."""
    from refine_segments import refine_bounds

    prof = _profile([1, 1, 1, 1, 40, 100, 40, 1, 1, 1])
    got = refine_bounds(prof, 0, 10, floor=1.0)

    assert got == (4, 7)


def test_refine_bounds_발화가_없으면_버린다():
    """바닥소음뿐인 창은 None. 라벨만 있고 소리는 없는 클립을 막는다."""
    from refine_segments import refine_bounds

    prof = _profile([1, 1, 2, 1, 1, 2, 1])

    assert refine_bounds(prof, 0, 7, floor=1.0) is None


def test_refine_bounds_조용한_화자를_지우지_않는다():
    """바닥 대비 상대 판정이라 절대 크기가 작아도 살아남는다.

    실측에서 75·76세 여성 화자는 파일 전체 중앙 RMS가 50~62였다. 절대
    임계값을 쓰면 구음장애 인식에 가장 필요한 집단이 통째로 사라진다.
    """
    from refine_segments import refine_bounds

    조용한_화자 = _profile([2, 2, 2, 8, 20, 8, 2, 2])
    큰_화자 = _profile([50, 50, 50, 200, 500, 200, 50, 50])

    assert refine_bounds(조용한_화자, 0, 8, floor=2.0) is not None
    assert refine_bounds(큰_화자, 0, 8, floor=50.0) is not None


def test_refine_bounds_탐색창_밖은_보지_않는다():
    """창을 이웃 세그먼트 중점으로 클램프해 옆 단어를 훔치는 걸 막는다."""
    from refine_segments import refine_bounds

    # 인덱스 8에 더 큰 피크가 있지만 창은 [0,5)까지만이다.
    prof = _profile([1, 1, 30, 90, 30, 1, 1, 1, 900, 1])
    got = refine_bounds(prof, 0, 5, floor=1.0)

    assert got == (2, 5)


def test_문장_경계는_창_안_발화_전체를_잡는다():
    """중간 쉼에서 토막나면 안 된다 — 문장은 내부 침묵이 정상이다."""
    from refine_segments import refine_narrative_bounds

    # 발화 - 쉼 - 발화. 단어 규칙이면 앞 덩어리만 잡지만 문장은 전체를 잡아야 한다.
    prof = _profile([1, 1, 50, 60, 1, 1, 1, 40, 55, 1, 1])
    got = refine_narrative_bounds(prof, 0, 11, floor=1.0)

    assert got == (2, 9)


def test_문장_경계는_잘린_끝을_늘린다():
    """실측 30%가 끝 경계 직후에 말소리가 이어졌다 — 창이 허용하면 늘려 잡는다."""
    from refine_segments import refine_narrative_bounds

    # 원래 경계가 인덱스 5에서 끊겼다고 보고, 창을 8까지 열어 준 상황.
    prof = _profile([1, 40, 50, 60, 55, 50, 45, 1, 1])
    got = refine_narrative_bounds(prof, 0, 9, floor=1.0)

    assert got == (1, 7)


def test_문장_창에_발화가_없으면_버린다():
    from refine_segments import refine_narrative_bounds

    assert refine_narrative_bounds(_profile([1, 1, 2, 1, 2]), 0, 5, floor=1.0) is None


# ─── refine_segments: 통과 세그먼트 wav 동반 (회귀) ──────────────
#
# 실제 사고: `copy_through`가 없던 판에서 매니페스트에는 줄이 있는데 wav가 없었고,
# 패키징이 그 세그먼트를 **조용히** 건너뛰었다. 문장 1723개 중 16개만 살아남았다.
# 예외도 로그도 없어서 패키지를 열어보기 전까지 몰랐다.
#
# 그래서 여기서 고정하는 불변식은 함수 호출이 아니라 **결과물의 정합성**이다:
#   산출 매니페스트의 모든 줄에 대응하는 wav가 산출 폴더에 있어야 한다.
# copy_through를 지우거나, 통과 경로를 하나 빠뜨리거나, 경로 계산이 틀어지면
# 전부 이 단언에서 걸린다.


def _write_wav(
    path: Path,
    seconds: float = 10.0,
    sr: int = 16000,
    bursts: "list[float] | None" = None,
) -> None:
    """유효한 PCM16 모노 wav를 만든다.

    `bursts`에 준 시각마다 짧고 큰 소리를 넣는다. 바닥소음만 있는 wav를 주면
    refine_bounds가 `peak < floor * rel_gate`로 전부 버려서, 재정렬 경로를
    타는 테스트가 "버려짐"만 확인하게 된다 — 실제 발화처럼 피크가 있어야
    재정렬이 성공하는 경로를 검증할 수 있다.
    """
    import wave

    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(sr * seconds)
    # 바닥소음: 0이 아니어야 percentile(10)이 0으로 죽지 않는다.
    a = np.full(n, 50, dtype=np.int16)
    for t in bursts or []:
        s = max(0, int((t - 0.12) * sr))
        e = min(n, int((t + 0.12) * sr))
        if e > s:
            a[s:e] = 12000
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(a.tobytes())


def _seg(fid: str, idx: int, text: str, start: float) -> dict:
    return {
        "parent_file_id": fid,
        "segment_wav_relpath": f"{fid}_seg{idx}.wav",
        "start": start,
        "end": start + 0.5,
        "reference_text": text,
    }


def _run_refine(tmp_path: Path, rows: list[dict], extra_argv: list[str], monkeypatch):
    """세그먼트 폴더·부모 오디오를 만들고 refine_segments.main()을 돌린다.

    반환: (산출 매니페스트 줄들, 산출 폴더 경로)
    """
    import refine_segments as RS

    seg_dir = tmp_path / "segs"
    audio_root = tmp_path / "audio"
    out_dir = tmp_path / "out"
    seg_dir.mkdir(parents=True, exist_ok=True)

    for fid in {r["parent_file_id"] for r in rows}:
        centers = [(r["start"] + r["end"]) / 2 for r in rows if r["parent_file_id"] == fid]
        _write_wav(audio_root / fid, bursts=centers)
    for r in rows:
        _write_wav(seg_dir / r["segment_wav_relpath"], seconds=0.5)

    (seg_dir / "segments.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
        encoding="utf-8",
    )

    # ffmpeg에 의존하지 않는다 — 여기서 보는 건 자르기가 아니라 wav 동반이다.
    def fake_cut(src, start, end, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"cut")
        return True

    monkeypatch.setattr(RS, "cut_wav", fake_cut)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "refine_segments.py",
            "--segments", str(seg_dir / "segments.jsonl"),
            "--audio-root", str(audio_root),
            "--out-dir", str(out_dir),
        ] + extra_argv,
    )
    assert RS.main() == 0

    out_rows = [
        json.loads(l)
        for l in (out_dir / "segments.jsonl").read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]
    return out_rows, out_dir


def test_대상없는_파일도_wav가_따라간다(tmp_path, monkeypatch):
    # 통과 경로 ①: 파일 전체가 재정렬 대상이 아닐 때(문장만 있는 파일).
    rows = [
        _seg("p1.wav", 0, "바다에 갔다", 1.0),
        _seg("p1.wav", 1, "밥을 먹었다", 3.0),
    ]
    out_rows, out_dir = _run_refine(
        tmp_path, rows, ["--words-max", "1", "--narrative", "skip"], monkeypatch
    )

    assert len(out_rows) == 2, "통과 세그먼트가 매니페스트에서 사라지면 안 된다"
    for r in out_rows:
        assert (out_dir / r["segment_wav_relpath"]).exists(), (
            f"{r['segment_wav_relpath']}: 매니페스트에 줄은 있는데 wav가 없다 — "
            "패키징이 이 세그먼트를 조용히 건너뛴다"
        )


def test_파일_안의_문장_세그먼트도_wav가_따라간다(tmp_path, monkeypatch):
    # 통과 경로 ②: 단어와 문장이 섞인 파일에서 문장만 통과할 때.
    # 단어가 있어야 targets가 비지 않아 경로 ①이 아닌 루프 안으로 들어간다.
    rows = [
        _seg("p2.wav", 0, "사과", 1.0),
        _seg("p2.wav", 1, "바다에 갔다", 3.0),
        _seg("p2.wav", 2, "포도", 5.0),
    ]
    out_rows, out_dir = _run_refine(
        tmp_path, rows, ["--words-max", "1", "--narrative", "skip"], monkeypatch
    )

    passed = [r for r in out_rows if not r.get("refined")]
    assert passed, "문장 세그먼트가 통과 경로를 타야 이 테스트가 의미가 있다"
    for r in out_rows:
        assert (out_dir / r["segment_wav_relpath"]).exists(), (
            f"{r['segment_wav_relpath']}: 매니페스트에 줄은 있는데 wav가 없다"
        )


def test_산출_매니페스트_줄수와_wav_수가_같다(tmp_path, monkeypatch):
    # 사고의 형태 그대로: 줄은 많은데 wav가 적었다. 두 수를 직접 비교한다.
    rows = [_seg("p3.wav", 0, "사과", 1.0)] + [
        _seg("p3.wav", i, f"문장 {i} 입니다", 2.0 + i) for i in range(1, 6)
    ]
    out_rows, out_dir = _run_refine(
        tmp_path, rows, ["--words-max", "1", "--narrative", "skip"], monkeypatch
    )

    wavs = {p.name for p in out_dir.rglob("*.wav")}
    assert len(wavs) == len(out_rows), (
        f"매니페스트 {len(out_rows)}줄 vs wav {len(wavs)}개 — "
        "이 격차가 문장 1723→16 사고의 형태다"
    )


# ─── refine_segments: 배치 내구성 (실패 격리 + 이어하기) ─────────
#
# 수백 파일을 몇 시간 돌리는 배치다. 예외 처리가 없으면 깨진 wav 하나가 나머지를
# 통째로 날리고, 매니페스트가 open("w")라 재실행이 처음부터다. 5차 배치가 19개 중
# 17개에서 멈춘 적이 있고 Colab 할당량 때문에 재실행 비용이 실제로 비쌌다.


def _run_refine_raw(tmp_path: Path, rows: list[dict], extra_argv: list[str], monkeypatch,
                    *, fresh: bool = True):
    """_run_refine과 같지만 main()의 반환값(exit code)을 그대로 준다."""
    import refine_segments as RS

    seg_dir = tmp_path / "segs"
    audio_root = tmp_path / "audio"
    out_dir = tmp_path / "out"
    if fresh:
        seg_dir.mkdir(parents=True, exist_ok=True)
        for fid in {r["parent_file_id"] for r in rows}:
            centers = [(r["start"] + r["end"]) / 2 for r in rows if r["parent_file_id"] == fid]
            _write_wav(audio_root / fid, bursts=centers)
        for r in rows:
            _write_wav(seg_dir / r["segment_wav_relpath"], seconds=0.5)
        (seg_dir / "segments.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
            encoding="utf-8",
        )

    def fake_cut(src, start, end, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"cut")
        return True

    monkeypatch.setattr(RS, "cut_wav", fake_cut)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "refine_segments.py",
            "--segments", str(seg_dir / "segments.jsonl"),
            "--audio-root", str(audio_root),
            "--out-dir", str(out_dir),
        ] + extra_argv,
    )
    return RS.main(), out_dir


def _manifest(out_dir: Path) -> list[dict]:
    p = out_dir / "segments.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def test_한_파일이_깨져도_나머지는_처리된다(tmp_path, monkeypatch):
    import refine_segments as RS

    rows = [
        _seg("bad.wav", 0, "바다에 갔다", 1.0),
        _seg("good.wav", 0, "밥을 먹었다", 1.0),
    ]
    # bad.wav만 읽다가 터지게 한다(깨진 wav가 하는 짓 그대로).
    real_profile = RS.rms_profile

    def flaky(path, *a, **kw):
        if "bad" in str(path):
            raise RuntimeError("깨진 헤더")
        return real_profile(path, *a, **kw)

    monkeypatch.setattr(RS, "rms_profile", flaky)
    code, out_dir = _run_refine_raw(
        tmp_path, rows, ["--words-max", "0"], monkeypatch
    )

    fids = {r["parent_file_id"] for r in _manifest(out_dir)}
    assert "good.wav" in fids, "성한 파일은 계속 처리돼야 한다"
    assert "bad.wav" not in fids, "실패한 파일의 줄은 산출에 남으면 안 된다"
    assert code == 1, "실패가 있으면 exit code로 구분돼야 한다"


def test_실패한_파일은_완료로_기록되지_않는다(tmp_path, monkeypatch):
    import refine_segments as RS

    rows = [_seg("bad.wav", 0, "바다에 갔다", 1.0), _seg("good.wav", 0, "밥 먹었다", 1.0)]
    real_profile = RS.rms_profile
    monkeypatch.setattr(
        RS, "rms_profile",
        lambda p, *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
        if "bad" in str(p) else real_profile(p, *a, **k),
    )
    _, out_dir = _run_refine_raw(tmp_path, rows, ["--words-max", "0"], monkeypatch)

    done = (out_dir / ".done_parents.txt").read_text(encoding="utf-8").split()
    assert "good.wav" in done
    assert "bad.wav" not in done, (
        "실패한 파일이 완료로 기록되면 --resume이 영영 건너뛴다"
    )


def test_resume은_끝난_파일을_다시_처리하지_않는다(tmp_path, monkeypatch):
    import refine_segments as RS

    rows = [_seg("p.wav", i, "바다에 갔다", 1.0 + i * 2) for i in range(3)]
    _run_refine_raw(tmp_path, rows, ["--words-max", "1", "--narrative", "skip"], monkeypatch)
    first = _manifest(tmp_path / "out")

    # 2회차는 rms_profile을 못 쓰게 해도 통과해야 한다 — 건드리지 않는다는 뜻.
    monkeypatch.setattr(
        RS, "rms_profile",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("완료 파일을 다시 읽었다")),
    )
    code, out_dir = _run_refine_raw(
        tmp_path, rows, ["--words-max", "1", "--narrative", "skip", "--resume"],
        monkeypatch, fresh=False,
    )

    assert code == 0
    assert _manifest(out_dir) == first, "이어하기가 줄을 늘리거나 줄이면 안 된다"


def test_resume은_중단된_파일의_반쪽_줄을_걷어낸다(tmp_path, monkeypatch):
    # 중간에 죽으면 완료 목록엔 없는데 매니페스트엔 줄이 남을 수 있다.
    # 그대로 이어쓰면 같은 세그먼트가 두 번 들어간다.
    rows = [_seg("p.wav", i, "바다에 갔다", 1.0 + i * 2) for i in range(2)]
    _run_refine_raw(tmp_path, rows, ["--words-max", "1", "--narrative", "skip"], monkeypatch)
    out_dir = tmp_path / "out"

    # 완료 기록만 지워 "중단된 것처럼" 만든다(줄은 남아 있다).
    (out_dir / ".done_parents.txt").write_text("", encoding="utf-8")

    _run_refine_raw(
        tmp_path, rows, ["--words-max", "1", "--narrative", "skip", "--resume"],
        monkeypatch, fresh=False,
    )

    paths = [r["segment_wav_relpath"] for r in _manifest(out_dir)]
    assert len(paths) == len(set(paths)), f"중복 줄이 생겼다: {paths}"
    assert len(paths) == 2


# ─── dev 스플릿 (test 누수 차단) ─────────────────────────────────
#
# dev가 없으면 노트북이 test를 에포크 평가·체크포인트 선택·최종 보고에 모두 쓴다.
# 그러면 보고 CER이 홀드아웃 성능이 아니라 "시험지를 보며 고른 점수"가 된다.
# 1~6차 배치가 그 상태였다.


def test_dev_비율_기본값이_0이_아니다():
    # 이 기본값이 0으로 돌아가면 test 누수가 조용히 부활한다.
    assert PC.DEFAULT_DEV_SPEAKER_FRAC > 0


def test_dev를_주면_세_갈래가_모두_생긴다():
    speakers = [f"S{i:02d}" for i in range(20)]
    assign = PC.split_speakers(
        speakers, test_frac=0.2, dev_frac=PC.DEFAULT_DEV_SPEAKER_FRAC, seed=42
    )
    kinds = set(assign.values())
    assert kinds == {"train", "dev", "test"}, f"세 갈래가 다 나와야 한다: {kinds}"
    assert sum(v == "dev" for v in assign.values()) >= 2, (
        "dev가 1명이면 그 화자 특성이 체크포인트 선택을 좌우한다"
    )


def test_dev도_화자_단위로_분리된다():
    # 한 화자가 두 split에 걸치면 dev/test가 train을 엿보게 된다.
    speakers = [f"S{i:02d}" for i in range(20)]
    for seed in range(10):
        assign = PC.split_speakers(
            speakers, test_frac=0.2, dev_frac=PC.DEFAULT_DEV_SPEAKER_FRAC, seed=seed
        )
        # 화자→split이 단일 매핑이므로 한 화자는 정의상 한 split만 갖는다.
        assert len(assign) == len(set(speakers))
        by_split: dict[str, set[str]] = {}
        for spk, sp in assign.items():
            by_split.setdefault(sp, set()).add(spk)
        pools = list(by_split.values())
        for i in range(len(pools)):
            for j in range(i + 1, len(pools)):
                assert not (pools[i] & pools[j]), "split 간 화자가 겹친다"


# ─── refine_segments: 부모 오디오가 중첩 폴더에 있어도 찾는다 (회귀) ─────────
#
# 실제 사고(2026-09-01, VS01): align_608은 audio_root / expected_audio_relpath로
# 오디오를 찾는데 refine_segments는 audio_root / fid(파일명만)로 찾았다. TS01은
# 평평한 wav/ 폴더라 우연히 맞았고, VS01(카테고리 하위 폴더)에서는 부모 253개가
# 전부 "원본 없음 — 건너뜀"으로 넘어가 산출 0개로 **조용히** 끝났다.
# 위 _run_refine은 오디오를 audio_root 바로 아래에만 둬서 이 사고를 못 잡는다.


def _run_refine_layout(tmp_path: Path, rows: list[dict], audio_relpaths: list[str], monkeypatch):
    """부모 오디오를 audio_root 아래 임의의 상대경로들에 두고 refine을 돌린다.

    같은 파일명을 여러 상대경로에 둘 수도 있다(중복 검사용). 반환: (exit code, 산출 폴더).
    """
    import refine_segments as RS

    seg_dir = tmp_path / "segs"
    audio_root = tmp_path / "audio"
    out_dir = tmp_path / "out"
    seg_dir.mkdir(parents=True, exist_ok=True)
    for rel in audio_relpaths:
        fid = Path(rel).name
        centers = [(r["start"] + r["end"]) / 2 for r in rows if r["parent_file_id"] == fid]
        _write_wav(audio_root / rel, bursts=centers)
    for r in rows:
        _write_wav(seg_dir / r["segment_wav_relpath"], seconds=0.5)
    (seg_dir / "segments.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )

    def fake_cut(src, start, end, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"cut")
        return True

    monkeypatch.setattr(RS, "cut_wav", fake_cut)
    monkeypatch.setattr(
        sys, "argv",
        ["refine_segments.py", "--segments", str(seg_dir / "segments.jsonl"),
         "--audio-root", str(audio_root), "--out-dir", str(out_dir)],
    )
    return RS.main(), out_dir


def test_중첩_audio_root에서도_부모를_찾는다(tmp_path, monkeypatch):
    rows = [_seg("p1.wav", 0, "사과", 1.0)]
    code, out_dir = _run_refine_layout(
        tmp_path, rows, ["013.데이터/VS01/11.중풍/p1.wav"], monkeypatch
    )
    assert code == 0
    assert len(_manifest(out_dir)) == 1, (
        "부모 오디오가 하위 폴더에 있는데 '원본 없음'으로 건너뛰었다 — 산출 0개로 조용히 끝난다"
    )


def test_평평한_폴더와_중첩_폴더가_섞여도_둘_다_찾는다(tmp_path, monkeypatch):
    rows = [_seg("flat.wav", 0, "사과", 1.0), _seg("deep.wav", 0, "바다", 1.0)]
    code, out_dir = _run_refine_layout(
        tmp_path, rows, ["flat.wav", "a/b/deep.wav"], monkeypatch
    )
    assert code == 0
    assert {r["parent_file_id"] for r in _manifest(out_dir)} == {"flat.wav", "deep.wav"}


def test_같은_파일명이_두_폴더에_있으면_멈춘다(tmp_path, monkeypatch):
    # 조용히 하나를 고르면 엉뚱한 오디오로 재정렬한다 — 그게 더 나쁘다.
    import pytest

    rows = [_seg("dup.wav", 0, "사과", 1.0)]
    with pytest.raises(SystemExit) as e:
        _run_refine_layout(tmp_path, rows, ["cat1/dup.wav", "cat2/dup.wav"], monkeypatch)
    assert "중복" in str(e.value)


# ─── merge_segments: 배치를 병합 매니페스트에 합친다 ─────────────────────────
#
# 실측 검증(2026-09-01): 1~5차 배치를 이 스크립트로 순서대로 병합해
# _segs_merged_all6.jsonl(3124줄)을 바이트 단위로 재현했다. 여기서는 그 규칙과
# 안전장치를 고정한다.


def _make_batch(seg_root: Path, batch: str, fids: list[str], with_wav: bool = True) -> None:
    rows = [_seg(fid, 0, "사과", 1.0) for fid in fids]
    for r in rows:
        r["segment_wav_relpath"] = f"{Path(r['parent_file_id']).stem}/{Path(r['parent_file_id']).stem}_000.wav"
        if with_wav:
            _write_wav(seg_root / batch / r["segment_wav_relpath"], seconds=0.5)
    (seg_root / batch).mkdir(parents=True, exist_ok=True)
    (seg_root / batch / "segments.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )


def _run_merge(monkeypatch, seg_root: Path, batch: str, out: Path, merged_in: Path | None = None):
    import merge_segments as MS

    argv = ["merge_segments.py", "--seg-root", str(seg_root), "--batch", batch,
            "--merged-out", str(out)]
    if merged_in:
        argv += ["--merged-in", str(merged_in)]
    monkeypatch.setattr(sys, "argv", argv)
    MS.main()


def test_병합은_배치_폴더명을_relpath_앞에_붙인다(tmp_path, monkeypatch):
    _make_batch(tmp_path, "_segs_a_refined", ["p1.wav"])
    _make_batch(tmp_path, "_segs_b_refined", ["p2.wav", "p3.wav"])
    m1, m2 = tmp_path / "m1.jsonl", tmp_path / "m2.jsonl"
    _run_merge(monkeypatch, tmp_path, "_segs_a_refined", m1)
    _run_merge(monkeypatch, tmp_path, "_segs_b_refined", m2, merged_in=m1)

    rows = [json.loads(l) for l in m2.read_text(encoding="utf-8").splitlines()]
    assert [r["parent_file_id"] for r in rows] == ["p1.wav", "p2.wav", "p3.wav"], "순서·개수가 이어져야 한다"
    assert rows[0]["segment_wav_relpath"] == "_segs_a_refined/p1/p1_000.wav"
    assert rows[2]["segment_wav_relpath"] == "_segs_b_refined/p3/p3_000.wav"
    for r in rows:  # 붙인 경로가 seg-root 기준으로 실재해야 prepare가 wav를 찾는다
        assert (tmp_path / r["segment_wav_relpath"]).exists()


def test_같은_배치를_두_번_합치면_멈추고_파일을_안_쓴다(tmp_path, monkeypatch):
    import pytest

    _make_batch(tmp_path, "_segs_a_refined", ["p1.wav"])
    m1, m2 = tmp_path / "m1.jsonl", tmp_path / "m2.jsonl"
    _run_merge(monkeypatch, tmp_path, "_segs_a_refined", m1)
    with pytest.raises(SystemExit):
        _run_merge(monkeypatch, tmp_path, "_segs_a_refined", m2, merged_in=m1)
    assert not m2.exists()


def test_wav가_없는_줄이_있으면_저장하지_않고_멈춘다(tmp_path, monkeypatch):
    # 패키징이 이런 세그먼트를 조용히 건너뛰어 문장 1723개 중 16개만 남은 적이 있다.
    import pytest

    _make_batch(tmp_path, "_segs_a_refined", ["p1.wav"], with_wav=False)
    out = tmp_path / "m.jsonl"
    with pytest.raises(SystemExit):
        _run_merge(monkeypatch, tmp_path, "_segs_a_refined", out)
    assert not out.exists()


# ─── extract_vs01_words: tar 안에 조각난 zip을 읽는다 ───────────────────────
#
# AI Hub 다운로드는 zip이 아니라 tar다. zip을 1 GiB씩 잘라 `...zip.part<오프셋>`
# 멤버로 담는다. zipfile로 그냥 열면 끝의 EOCD가 우연히 찾아져 목록은 멀쩡한데
# 파일을 꺼내는 순간 "Bad magic number"로 죽는다(조각 사이의 tar 헤더 때문에
# 로컬 헤더 위치가 어긋난다). 74.8GB를 디스크에 다시 쓰지 않고 조각을 이어 붙인
# 가상 파일로 읽는다 — 그 이어 붙이기가 맞는지를 고정한다.


def _make_tar_of_zip_parts(tmp_path: Path, payload: dict[str, bytes], n_parts: int = 3,
                           reverse: bool = False) -> Path:
    import io
    import tarfile
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in payload.items():
            z.writestr(name, data)
    blob = buf.getvalue()
    cuts = [len(blob) * k // n_parts for k in range(n_parts + 1)]
    tar_path = tmp_path / "vs01.tar"
    with tarfile.open(tar_path, "w") as tf:
        spans = list(zip(cuts, cuts[1:]))
        for s, e in (spans[::-1] if reverse else spans):
            ti = tarfile.TarInfo(f"013.데이터/VS01_뇌신경장애.zip.part{s}")   # 이름이 곧 논리 오프셋
            ti.size = e - s
            tf.addfile(ti, io.BytesIO(blob[s:e]))
    return tar_path


def test_tar_안_zip_조각을_이어_붙여_읽는다(tmp_path):
    import os

    import extract_vs01_words as EV

    payload = {"11.중풍/a.wav": os.urandom(4000), "11.중풍/b.wav": b"B" * 6000, "12.뇌부상/c.wav": os.urandom(2500)}
    tar_path = _make_tar_of_zip_parts(tmp_path, payload)
    zf = EV.open_zip(tar_path)
    assert sorted(zf.namelist()) == sorted(payload)
    for name, data in payload.items():
        assert zf.read(name) == data, f"{name}: 조각을 이어 붙인 결과가 원본과 다르다"


def test_tar_안_조각_순서가_뒤섞여도_이름의_오프셋으로_읽는다(tmp_path):
    # 조각 이름이 곧 논리 오프셋이다. tar 안의 물리적 순서에 기대면 순서가 어긋난 tar에서
    # 조각이 엉뚱한 자리에 붙어 조용히 깨진 zip이 된다.
    import os

    import extract_vs01_words as EV

    payload = {"a.wav": os.urandom(4000), "b.wav": b"B" * 6000}
    zf = EV.open_zip(_make_tar_of_zip_parts(tmp_path, payload, reverse=True))
    for name, data in payload.items():
        assert zf.read(name) == data


def test_평범한_zip은_그대로_연다(tmp_path):
    import zipfile

    import extract_vs01_words as EV

    p = tmp_path / "plain.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("a.wav", b"x" * 100)
    assert EV.open_zip(p).read("a.wav") == b"x" * 100


def test_조각이_연속이_아니면_멈춘다(tmp_path):
    # 조각 하나가 빠진 채로 읽으면 조용히 깨진 zip을 읽게 된다.
    import io
    import tarfile

    import pytest

    import extract_vs01_words as EV

    tar_path = tmp_path / "gap.tar"
    with tarfile.open(tar_path, "w") as tf:
        for s, size in ((0, 100), (5000, 100)):     # 100..5000 구간이 없다
            ti = tarfile.TarInfo(f"x.zip.part{s}")
            ti.size = size
            tf.addfile(ti, io.BytesIO(b"z" * size))
    with pytest.raises(SystemExit) as e:
        EV.open_zip(tar_path)
    assert "연속" in str(e.value)


# ─── prune_vs01: 68GB를 지우는 도구 — 기본은 아무것도 안 지운다 ────────────


def _prune_fixture(tmp_path: Path):
    manifest = tmp_path / "manifest.jsonl"
    rows = [
        {"file_id": "w1.wav", "split": "val", "transcript": "사과 바나나 포도"},          # 단어
        {"file_id": "w2.wav", "split": "val", "transcript": "거울 안경"},                  # 단어
        {"file_id": "n1.wav", "split": "val", "transcript": "가다. 오다. 먹다. 자다."},    # 문장(문장부호 3개+)
    ]
    manifest.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    root = tmp_path / "vs01"
    for name in ("w1.wav", "w2.wav", "n1.wav", "mystery.wav"):     # mystery는 매니페스트에 없다
        p = root / "cat" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * 10)
    return manifest, root


def _run_prune(monkeypatch, manifest: Path, root: Path, *extra: str):
    import prune_vs01 as PV

    monkeypatch.setattr(sys, "argv", ["prune_vs01.py", "--root", str(root), "--manifest", str(manifest), *extra])
    PV.main()


def test_prune은_기본이_모의_실행이다(tmp_path, monkeypatch):
    manifest, root = _prune_fixture(tmp_path)
    _run_prune(monkeypatch, manifest, root)
    assert sorted(p.name for p in root.rglob("*.wav")) == ["mystery.wav", "n1.wav", "w1.wav", "w2.wav"]


def test_prune은_문장만_옮기고_단어와_낯선_파일은_남긴다(tmp_path, monkeypatch):
    manifest, root = _prune_fixture(tmp_path)
    moved = tmp_path / "dropped"
    _run_prune(monkeypatch, manifest, root, "--apply", "--move-to", str(moved))
    assert sorted(p.name for p in root.rglob("*.wav")) == ["mystery.wav", "w1.wav", "w2.wav"]
    assert [p.name for p in moved.rglob("*.wav")] == ["n1.wav"], "문장은 지우지 않고 옮겨야 한다(되돌릴 수 있게)"
