"""build_target_foils 검증 — 오통과 시험의 foil이 설계대로 만들어지는지 고정한다.

설계: 대장 `608-finetune-log.md` 「목표 단어 검증 — 설계」.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build_target_foils as F  # noqa: E402
from app_scorer import decompose_hangul, is_speech_correct  # noqa: E402

POOL = {"사과": "apple", "사자": "lion", "배": "pear", "수박": "watermelon",
        "학교": "school", "은행": "bank", "사다리": "ladder", "연": "kite"}
CATS = {"apple": "food", "lion": "animal", "pear": "food", "watermelon": "food",
        "school": "place", "bank": "place", "ladder": "object", "kite": None}


def _by_kind(info, kind):
    return [f["foil"] for f in info["foils"] if f["kind"] == kind]


def test_paraphasia_changes_exactly_one_jamo_across_groups():
    for cand in F.paraphasia_candidates("사과"):
        diffs = []
        for a, b in zip("사과", cand):
            if a != b:
                diffs += [(x, y) for x, y in zip(decompose_hangul(a), decompose_hangul(b)) if x != y]
        assert len(diffs) == 1, (cand, diffs)
        x, y = diffs[0]
        groups = F.CONSONANT_GROUPS + F.VOWEL_GROUPS
        assert not any(x in g and y in g for g in groups), f"같은 그룹 치환이 섞였다: {cand}"


def test_paraphasia_never_adds_or_drops_final_consonant():
    # 종성 탈락·첨가는 앱이 감면하는 변형이라 착어로 세면 안 된다
    for cand in F.paraphasia_candidates("사과"):
        assert all(decompose_hangul(c)[2] == "" for c in cand), cand


def test_foils_exclude_target_and_para_excludes_app_words():
    out = F.build_foils(["사과"], POOL, CATS)
    info = out["사과"]
    assert all(f["foil"] != "사과" for f in info["foils"])
    assert not set(_by_kind(info, "para")) & set(POOL)


def test_semantic_foils_share_category_and_skip_phon_duplicates():
    info = F.build_foils(["사과"], POOL, CATS)["사과"]
    sem = _by_kind(info, "sem")
    assert sem and all(CATS[POOL[s]] == "food" for s in sem)
    assert not set(sem) & set(_by_kind(info, "phon"))


def test_semantic_candidate_that_is_also_phon_is_dropped():
    # 같은 범주 단어가 최근접 단어뿐이면 sem은 비어야 한다(두 번 세지 않는다)
    pool = {"사과": "a", "사고": "b", "학교": "c"}
    cats = {"a": "food", "b": "food", "c": "place"}
    info = F.build_foils(["사과"], pool, cats, k=1)["사과"]
    assert _by_kind(info, "phon") == ["사고"]
    assert _by_kind(info, "sem") == []


def test_uncategorized_word_has_no_semantic_foils():
    info = F.build_foils(["연"], POOL, CATS)["연"]
    assert info["category"] is None and _by_kind(info, "sem") == []


def test_phon_foils_are_nearest_by_app_scorer():
    info = F.build_foils(["사과"], POOL, CATS, k=1)["사과"]
    best = min((a for a in POOL if a != "사과"),
               key=lambda a: F.speech_error_rate("사과", a, "word"))
    got = _by_kind(info, "phon")[0]
    assert F.speech_error_rate("사과", got, "word") == F.speech_error_rate("사과", best, "word")


def test_counts_for_fa_rule():
    # 다른 실제 단어만 센다 — 착어·무작위는 따로 보고
    assert F.counts_for_fa("phon") is True
    assert F.counts_for_fa("sem") is True
    assert F.counts_for_fa("para") is False
    assert F.counts_for_fa("rand") is False
    info = F.build_foils(["사과"], POOL, CATS)["사과"]
    assert all(f["counts_for_fa"] == (f["kind"] in ("phon", "sem")) for f in info["foils"])


def test_string_scorer_direction_is_said_word_vs_foil_target():
    info = F.build_foils(["사과"], POOL, CATS)["사과"]
    for f in info["foils"]:
        assert f["string_scorer_wrong"] == (not is_speech_correct("사과", f["foil"], "word"))


def test_string_scorer_accepts_different_real_word_saja_for_satang():
    # 대장 「foil 실측과 문자열 채점기의 성질」의 근거 사례(퇴역한 채점기의 성질이다)
    assert is_speech_correct("사자", "사탕", "word") is True


def test_deterministic_and_order_independent():
    a = F.build_foils(["사과", "학교"], POOL, CATS, seed=42)
    b = F.build_foils(["학교", "사과", "사과"], POOL, CATS, seed=42)
    assert a == b
    c = F.build_foils(["사과", "학교"], POOL, CATS, seed=7)
    assert a != c
    # 다른 단어를 평가셋에 더해도 기존 단어의 foil은 안 바뀐다(단어별 시드)
    assert F.build_foils(["사과"], POOL, CATS) == {"사과": F.build_foils(["배", "사과"], POOL, CATS)["사과"]}


def test_load_categories_parses_real_item_bank():
    cats = F.load_categories(F.DEFAULT_BANK)
    assert cats["apple"] == "food" and cats["bear"] == "animal"
    assert all(v is None or v.isidentifier() for v in cats.values())


def test_load_categories_ignores_comments(tmp_path):
    ts = tmp_path / "bank.ts"
    ts.write_text(
        "export const WORD_CATEGORY: Record<string, string | null> = {\n"
        "  apple: 'food', kite: null,\n"
        "  // removed: pear: 'food'\n"
        "};\n", encoding="utf-8")
    assert F.load_categories(ts) == {"apple": "food", "kite": None}


def test_real_pool_every_slug_has_category_entry():
    pool = F.load_pool(F.DEFAULT_POOL)
    cats = F.load_categories(F.DEFAULT_BANK)
    assert len(pool) == json.loads(F.DEFAULT_POOL.read_text(encoding="utf-8"))["totalItems"]
    assert not [s for s in pool.values() if s not in cats]
