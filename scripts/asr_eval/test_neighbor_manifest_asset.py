"""이름대기 이웃 목록 자산(`neighborManifest.ko-KR.json`) 검증.

- 파일이 현재 데이터로 다시 만든 것과 같은가(낡지 않았는가)
- 이웃의 성질: 개수·자신 제외·포함관계 제외·앱 어휘 안
- 낱말 풀이 바뀌었는데 목록을 안 만든 사고를 pytest가 잡는다. 프론트가 실제로 내는
  이름대기 낱말과의 일치는 `neighborManifest.test.ts`(Vitest)가 고정한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "scripts" / "asr_eval"))

import build_neighbor_manifest as B  # noqa: E402
import neighbor_manifest as N  # noqa: E402

MANIFEST = json.loads(B.OUT.read_text(encoding="utf-8"))


def test_committed_manifest_is_current():
    assert B.OUT.read_text(encoding="utf-8") == B.render(B.build()), \
        "목록이 낡았다 — python scripts/build_neighbor_manifest.py 로 다시 만들어라"


def test_header_fields():
    assert MANIFEST["version"] == 1 and MANIFEST["locale"] == "ko-KR"
    assert MANIFEST["k"] == 3 and MANIFEST["scope"] == "naming"


def test_every_naming_word_has_exactly_k_distinct_neighbors():
    nb = MANIFEST["neighbors"]
    assert set(nb) == set(B.naming_targets())
    for w, ns in nb.items():
        assert len(ns) == MANIFEST["k"] == len(set(ns)), (w, ns)


def test_neighbors_exclude_self_and_containment_and_stay_in_app_vocab():
    vocab = set(N.load_app_vocab())
    for w, ns in MANIFEST["neighbors"].items():
        for n in ns:
            assert n != w and not N.is_containment(n, w), (w, n)
            assert n in vocab, (w, n)


def test_manifest_uses_the_same_function_as_stage0_measurement():
    """0단계 실측(azure_neighbor_eval)이 쓴 neighbors()와 결과가 같다."""
    vocab = N.load_app_vocab()
    for w in ("고래", "사탕", "가위", "나무"):
        assert MANIFEST["neighbors"][w] == N.neighbors(w, vocab, k=3, seed=42)


def test_naming_targets_selection_rule(tmp_path):
    """사진 없는 낱말은 빠지고, 이름대기 전용 낱말은 들어온다(toNamingItem과 같은 규칙)."""
    d = tmp_path
    def item(i, word, slug):
        return {"itemId": i, "targetWord": word, "choices": [
            {"label": word, "imageUrl": f"/a/{slug}.svg", "isCorrect": True},
            {"label": "x", "imageUrl": "/a/x.svg", "isCorrect": False}]}
    (d / "qabWordPool.json").write_text(json.dumps(
        {"items": [item("1", "사과", "apple"), item("2", "고래", "whale")]}), encoding="utf-8")
    (d / "namingPhotos.json").write_text(json.dumps({"slugs": ["apple"]}), encoding="utf-8")
    (d / "namingOnlyWords.json").write_text(json.dumps(
        {"items": [{"slug": "comb", "label": "빗", "category": "bathroom"}]}), encoding="utf-8")
    assert B.naming_targets(d) == sorted(["빗", "사과"])   # 고래는 사진이 없어 빠진다
