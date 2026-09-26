"""이웃 비교 채점의 이웃 목록 — 목표 단어마다 소리가 가까운 다른 단어 k개.

설계: `docs/history/20260926_NeighborScoring_design.md` 3-2절.

- 후보: 앱이 가진 한국어 단어 전체 — 낱말 풀(`qabWordPool.json`), 이름대기 전용
  (`namingOnlyWords.json`), 따라말하기 낱말(`qabSpeechStimuli.json`의 repeatWords).
- 선정: 음소 유사 거리(`phonetic_edit_distance`)를 목표 음절 수로 나눈 값이 작은 순.
  같은 거리 안에서는 단어별 시드로 섞는다(가나다순 편향 방지).
- 제외: 목표 자신, 한쪽이 다른 쪽을 품는 쌍(전화↔전화기 — 줄여 부른 말일 수 있다).

0단계 팔 B용으로, 목표 첫 음절의 초성을 **다른 조음 그룹** 자음으로 바꾼 비단어도
만든다(`onset_pseudowords`). 이웃 목록 밖의 단어를 말한 경우를 흉내 낸다.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from app_scorer import CHO, CONSONANT_GROUPS, decompose_hangul, phonetic_edit_distance

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "frontend/src/assets/data"


def load_app_vocab(data_dir: Path = DATA) -> list[str]:
    """앱이 발화 과제에 쓰는 한국어 단어 전체(중복 제거, 정렬)."""
    words: set[str] = set()
    pool = json.loads((data_dir / "qabWordPool.json").read_text(encoding="utf-8"))
    words |= {it["targetWord"].strip() for it in pool["items"]}
    only = json.loads((data_dir / "namingOnlyWords.json").read_text(encoding="utf-8"))
    words |= {it["label"].strip() for it in only["items"]}
    stim = json.loads((data_dir / "qabSpeechStimuli.json").read_text(encoding="utf-8"))
    words |= {w.strip() for w in stim["repeatWords"]}
    return sorted(w for w in words if w)


def _dist(target: str, cand: str) -> float:
    return phonetic_edit_distance(list(cand), list(target)) / max(1, len(target))


def is_containment(a: str, b: str) -> bool:
    return a in b or b in a


def neighbors(target: str, vocab: list[str], k: int = 3, seed: int = 42) -> list[str]:
    """목표와 소리가 가장 가까운 앱 단어 k개. 목표가 앱 어휘 밖이어도 동작한다."""
    rng = random.Random(f"{seed}:{target}")
    tiers: dict[float, list[str]] = {}
    for c in vocab:
        if c == target or is_containment(c, target):
            continue
        tiers.setdefault(round(_dist(target, c), 6), []).append(c)
    out: list[str] = []
    for d in sorted(tiers):
        group = sorted(tiers[d])
        rng.shuffle(group)
        out += group[: k - len(out)]
        if len(out) >= k:
            break
    return out


def onset_pseudowords(target: str, vocab: list[str], n: int = 2, seed: int = 42) -> list[str]:
    """첫 음절 초성을 다른 조음 그룹 자음으로 바꾼 말 n개(앱 어휘에 없는 것만)."""
    d = decompose_hangul(target[:1]) if target else None
    if d is None:
        return []
    cho, jung, jong = d
    from app_scorer import JONG, JUNG  # 조합용

    def compose(c: str) -> str:
        return chr(0xAC00 + CHO.index(c) * 588 + JUNG.index(jung) * 28 + JONG.index(jong))

    other = [c for c in CHO if c != cho and not any(cho in g and c in g for g in CONSONANT_GROUPS)]
    vs = set(vocab)
    cands = sorted({compose(c) + target[1:] for c in other} - vs - {target})
    rng = random.Random(f"{seed}:pseudo:{target}")
    rng.shuffle(cands)
    return cands[:n]


def build_manifest(targets: list[str], vocab: list[str], k: int = 3, seed: int = 42) -> dict:
    return {
        "version": 1, "locale": "ko-KR", "k": k, "seed": seed,
        "distance": "phonetic_edit_distance / 목표 음절 수",
        "neighbors": {t: neighbors(t, vocab, k, seed) for t in sorted(set(targets))},
    }
