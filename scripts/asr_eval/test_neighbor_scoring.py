"""이웃 목록·이웃 비교 판정 검증 — API 없이."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import azure_neighbor_eval as E  # noqa: E402
import neighbor_manifest as N  # noqa: E402
from app_scorer import CONSONANT_GROUPS, decompose_hangul  # noqa: E402

VOCAB = ["고래", "노래", "구름", "가위", "거위", "바위", "전화", "전화기", "사자", "사탕", "나무", "통나무"]


def _res(acc, text="x"):
    return {"reason": "RecognizedSpeech", "text": text, "pa": {"accuracy": acc}}


def test_neighbors_exclude_self_and_containment():
    nb = N.neighbors("전화", VOCAB, k=5)
    assert "전화" not in nb and "전화기" not in nb
    assert "통나무" not in N.neighbors("나무", VOCAB, k=10)


def test_neighbors_are_nearest_first():
    assert N.neighbors("고래", VOCAB, k=1) == ["노래"]   # 초성 하나 차이가 가장 가깝다
    assert set(N.neighbors("가위", VOCAB, k=2)) == {"거위", "바위"}


def test_neighbors_deterministic_and_target_outside_vocab():
    assert N.neighbors("고래", VOCAB) == N.neighbors("고래", list(reversed(VOCAB)))
    assert N.neighbors("모래", VOCAB, k=2)   # 어휘 밖 목표도 이웃을 낸다


def test_onset_pseudowords_change_first_onset_across_groups():
    ps = N.onset_pseudowords("고래", VOCAB, n=5)
    assert len(ps) == 5 and "노래" not in ps   # 어휘에 있는 말은 비단어가 아니다
    for p in ps:
        a, b = decompose_hangul("고"), decompose_hangul(p[0])
        assert p[1:] == "래" and a[1:] == b[1:] and a[0] != b[0]
        assert not any(a[0] in g and b[0] in g for g in CONSONANT_GROUPS)


def test_real_app_vocab_loads():
    v = N.load_app_vocab()
    assert len(v) > 300 and len(v) == len(set(v)) and "사과" in v


def test_decide_three_way_and_failure_policy():
    assert E.decide(None, []) == "unscored"
    assert E.decide(_res(95, text=""), []) == "unscored"
    assert E.decide(_res(50), [_res(10)]) == "fail"
    assert E.decide(_res(80), [_res(70), _res(79)]) == "pass"
    assert E.decide(_res(80), [_res(80)]) == "pass"            # 동점은 정답(m=0)
    assert E.decide(_res(80), [_res(81)]) == "ambiguous"
    assert E.decide(_res(80), [_res(76)], m=5) == "ambiguous"
    # 이웃 호출 실패 → 목표 점수만으로 채점하지 않는다
    assert E.decide(_res(95), [_res(10), {"reason": "Canceled"}]) == "unscored"
    assert E.decide(_res(95), [_res(10), None]) == "unscored"
    # 이웃 NoMatch는 0점 — 실패가 아니다
    assert E.decide(_res(70), [{"reason": "NoMatch", "text": ""}]) == "pass"


def test_needed_calls_skip_neighbors_when_target_decided():
    rows = {"a.wav": "고래"}
    sc = E.Scores({"a.wav": _res(40)}, {}, rows)
    case = {"audio": "a.wav", "_wav": Path("a.wav"), "said": "고래", "target": "고래", "comps": ["노래"]}
    assert E.needed_calls([case], sc) == []                       # 목표 40 → 오답, 이웃 불필요
    sc = E.Scores({"a.wav": _res(90)}, {}, rows)
    assert [r for _, _, r in E.needed_calls([case], sc)] == ["노래"]
    neg = dict(case, target="노래", comps=["고래", "모래"])
    calls = [r for _, _, r in E.needed_calls([neg], sc)]
    assert calls == ["노래"]                                      # 음성은 목표부터
    # 목표 캐시가 차면 이웃 중 정답 참조(고래)는 정답 캐시에서 온다 — 모래만 부른다
    sc.pair[E.FE.cache_key("a.wav", "노래")] = _res(88)
    assert [r for _, _, r in E.needed_calls([neg], sc)] == ["모래"]


def test_summarize_rates():
    rows = {"a.wav": "고래", "b.wav": "사탕"}
    k = E.FE.cache_key
    sc = E.Scores({"a.wav": _res(90), "b.wav": _res(85)},
                  {k("a.wav", "노래"): _res(85), k("b.wav", "사자"): _res(88),
                   k("a.wav", "모래"): _res(20)}, rows)
    pos = [{"audio": "a.wav", "said": "고래", "target": "고래", "comps": ["노래"]},
           {"audio": "b.wav", "said": "사탕", "target": "사탕", "comps": ["사자"]}]
    neg = [{"audio": "a.wav", "said": "고래", "target": "노래", "comps": ["고래"]},   # 목록 안 → 모호
           {"audio": "a.wav", "said": "고래", "target": "노래", "comps": ["모래"]}]   # 목록 밖 → 통과(오통과)
    s = E.summarize(pos, neg, sc, 0)
    assert s["pos"]["ambiguous"] == 1 and s["pos"]["pass"] == 1 and s["amb"] == 0.5
    assert s["neg"]["pass"] == 1 and s["neg"]["ambiguous"] == 1 and s["fa"] == 0.5
    assert s["neg_said_in_comps"] == 0.5
    assert E.verdict(s).startswith("실패")


def test_stt_competitor_rules():
    assert E.stt_competitor("노래.", "고래") == "노래"
    assert E.stt_competitor("", "고래") is None
    assert E.stt_competitor(None, "고래") is None
    assert E.stt_competitor("고래", "고래") is None
    assert E.stt_competitor("고래요", "고래") is None       # 어미가 붙은 정답
    assert E.stt_competitor("전화", "전화기") is None       # 줄여 부른 말


def test_plan_arm_c_adds_transcript_from_audio_not_target():
    rows = [{"audio": "a.wav", "_wav": Path("a.wav"), "text": "고래"}]
    foils = {"고래": {"foils": [{"foil": "구름", "kind": "phon", "counts_for_fa": True}]}}
    stt = {"a.wav": "모래"}   # 어휘 밖 단어 — 이웃 목록에는 없다
    pos, neg = E.plan(rows, foils, VOCAB, "C", stt)
    assert pos[0]["comps"][-1] == "모래" and neg[0]["comps"][-1] == "모래"
    assert pos[0]["comps"][:-1] == N.neighbors("고래", VOCAB)
    pos_s, neg_s = E.plan(rows, foils, VOCAB, "S", stt)
    assert pos_s[0]["comps"] == ["모래"] and neg_s[0]["comps"] == ["모래"]
    # 전사가 이미 이웃 목록에 있으면 두 번 넣지 않는다
    pos_d, _ = E.plan(rows, foils, VOCAB, "C", {"a.wav": "노래"})
    assert pos_d[0]["comps"] == N.neighbors("고래", VOCAB)
    # 전사가 목표와 같으면 경쟁자가 안 붙는다(음성 목표 구름에는 붙는다)
    pos2, neg2 = E.plan(rows, foils, VOCAB, "S", {"a.wav": "고래"})
    assert pos2[0]["comps"] == [] and neg2[0]["comps"] == ["고래"]
