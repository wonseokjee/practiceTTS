"""목표 단어 검증의 오통과 시험용 바꿔치기 목표(foil)를 만든다.

배경: 대장 `608-finetune-log.md` 「목표 단어 검증 — 설계」. 608에는 실제 착어가
없어서(대본을 맞게 읽으려 한 녹음), 단어 A를 말한 오디오를 **다른 목표 B**로
채점해 오통과를 흉내 낸다. 무작위 B는 너무 쉬운 시험이라 **가까운 B**를 만든다.

| kind | 만드는 법 | 흉내 내는 오류 |
|------|-----------|----------------|
| phon | 앱 표적 단어 중 앱 채점기 오류율이 가장 낮은 단어 | 음운적으로 비슷한 단어로 대치 |
| para | 음절 하나에서 자모 하나를 **다른 조음 그룹**으로 바꾼 말(앱 어휘 밖) | 음소 착어 |
| sem  | 앱 `WORD_CATEGORY`에서 같은 범주의 다른 단어 | 의미 착어 |
| rand | 앱 표적 단어 중 무작위 | 하한선(판정에 안 씀) |

각 foil에 `app_wrong`("A라고 말했는데 목표가 B"를 앱 채점기가 오답으로 치는가)과
`counts_for_fa`(오통과율 분모에 드는가)를 붙인다. 규칙은 `counts_for_fa()` 참고.

⚠️ 앱 채점기는 2음절 이상 단어에서 자모 하나짜리 치환을 **절대 오답으로 치지
않는다**(한 자모의 최대 비용 0.4 ÷ 2음절 = 0.2 ≤ 0.34). 음절 하나의 초성과 종성이
같이 바뀐 **다른 실제 단어**(사탕↔사자)도 정답으로 친다. 대장 「채점기 발견」.

사용:
    python build_target_foils.py --words-from colab_trainset_big7_vochold/holdout_eval.jsonl \\
        --out target_foils.json
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

from app_scorer import (
    CHO,
    CONSONANT_GROUPS,
    JONG,
    JUNG,
    VOWEL_GROUPS,
    decompose_hangul,
    is_speech_correct,
    speech_error_rate,
)

for _s in (sys.stdout, sys.stderr):   # 윈도우 cp949 콘솔 대비
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = Path(__file__).resolve().parents[2]
DEFAULT_POOL = REPO / "frontend/src/assets/data/qabWordPool.json"
DEFAULT_BANK = REPO / "frontend/src/memory-link/patient/quiz/infrastructure/QabItemBank.ts"

KINDS = ("phon", "para", "sem", "rand")


# ─── 앱 어휘 읽기 ────────────────────────────────────────────────

def load_pool(path: Path) -> dict[str, str]:
    """qabWordPool.json → {한국어 표적 단어: slug}. slug는 정답 그림 파일 이름이다."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for item in data["items"]:
        correct = [c for c in item["choices"] if c["isCorrect"]]
        if len(correct) != 1:
            raise SystemExit(f"{item['itemId']}: 정답 선택지가 {len(correct)}개다")
        slug = Path(correct[0]["imageUrl"]).stem
        out[item["targetWord"].strip()] = slug
    return out


_CAT_BLOCK = re.compile(r"export const WORD_CATEGORY[^=]*=\s*\{(.*?)\n\};", re.S)
_CAT_PAIR = re.compile(r"\b([a-z_]+)\s*:\s*(null|'([a-z_]+)')")


def load_categories(path: Path) -> dict[str, str | None]:
    """QabItemBank.ts의 WORD_CATEGORY 리터럴 → {slug: 범주 또는 None}."""
    m = _CAT_BLOCK.search(path.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{path}에서 WORD_CATEGORY를 못 찾았다 — 선언 모양이 바뀌었나?")
    body = re.sub(r"//[^\n]*", "", m.group(1))   # 주석 속 "a: b" 오인 방지
    return {slug: (cat or None) for slug, _, cat in _CAT_PAIR.findall(body)}


# ─── foil 후보 ───────────────────────────────────────────────────

def _compose(cho: str, jung: str, jong: str) -> str:
    return chr(0xAC00 + CHO.index(cho) * 588 + JUNG.index(jung) * 28 + JONG.index(jong))


def _other_group(a: str, b: str, groups: list[list[str]]) -> bool:
    """a→b가 같은 조음 그룹 안의 치환이 아닌가(앱이 감면하지 않는 치환인가)."""
    return not any(a in g and b in g for g in groups)


def paraphasia_candidates(word: str) -> list[str]:
    """음절 하나에서 자모 하나를 다른 그룹 자모로 바꾼 모든 변형.

    같은 그룹 치환(ㅂ↔ㅍ 등)은 뺀다 — 구음장애 왜곡과 구분이 안 되는, 앱이 일부러
    봐주는 변형이라 "착어"로 세면 안 된다. 종성은 탈락·첨가도 뺀다(같은 이유로 감면).
    """
    out: set[str] = set()
    for i, ch in enumerate(word):
        d = decompose_hangul(ch)
        if d is None:
            continue
        cho, jung, jong = d
        subs = [_compose(c, jung, jong) for c in CHO if c != cho and _other_group(cho, c, CONSONANT_GROUPS)]
        subs += [_compose(cho, v, jong) for v in JUNG if v != jung and _other_group(jung, v, VOWEL_GROUPS)]
        if jong:
            subs += [_compose(cho, jung, j) for j in JONG
                     if j and j != jong and _other_group(jong, j, CONSONANT_GROUPS)]
        for s in subs:
            out.add(word[:i] + s + word[i + 1:])
    out.discard(word)
    return sorted(out)


def counts_for_fa(kind: str, app_wrong: bool) -> bool:
    """이 foil을 통과시키면 오통과로 세는가(오통과율 분모에 들어가는가).

    - phon·sem: **항상.** 다른 실제 단어를 말한 건 앱 채점기가 뭐라 하든 이름대기
      오류다. 앱 채점기는 사탕↔사자·가위↔거위를 정답으로 치는데, 그건 채점기의
      빈틈이지 정책이 아니다(대장 「채점기 발견」).
    - para: 앱 채점기가 오답으로 칠 때만. 자모 하나 바뀐 말은 구음장애 왜곡과
      구분이 안 돼서, 앱이 봐주는 변형을 통과시켰다고 벌하지 않는다.
    - rand: 안 센다. 하한선 참고용이다.
    """
    if kind in ("phon", "sem"):
        return True
    if kind == "para":
        return app_wrong
    return False


def _pick(cands: list[str], k: int, rng: random.Random) -> list[str]:
    cands = sorted(cands)
    rng.shuffle(cands)
    return cands[:k]


def _nearest(word: str, cands: list[str], k: int, rng: random.Random) -> list[str]:
    """오류율 오름차순. 같은 오류율 안에서는 시드로 섞는다(가나다순 편향 방지)."""
    tiers: dict[float, list[str]] = {}
    for c in cands:
        tiers.setdefault(round(speech_error_rate(word, c, "word"), 6), []).append(c)
    out: list[str] = []
    for err in sorted(tiers):
        out += _pick(tiers[err], k - len(out), rng)
        if len(out) >= k:
            break
    return out


def build_foils(
    words: list[str],
    pool: dict[str, str],
    categories: dict[str, str | None],
    k: int = 3,
    seed: int = 42,
) -> dict[str, dict]:
    """단어별 foil 목록. 단어 순서와 무관하게 같은 결과가 나오도록 단어마다 시드를 딴다."""
    app_words = sorted(pool)
    out: dict[str, dict] = {}
    for w in sorted(set(words)):
        rng = random.Random(f"{seed}:{w}")
        others = [a for a in app_words if a != w]
        cat = categories.get(pool[w]) if w in pool else None

        phon = _nearest(w, others, k, rng)
        chosen: dict[str, list[str]] = {
            "phon": phon,
            "para": _pick([p for p in paraphasia_candidates(w) if p not in pool], k, rng),
            # phon과 겹치면(눈↔손) 한 foil이 오통과율에 두 번 들어간다 — 뺀다
            "sem": _pick([a for a in others
                          if cat and categories.get(pool[a]) == cat and a not in phon], k, rng),
        }
        used = {f for fs in chosen.values() for f in fs}
        chosen["rand"] = _pick([a for a in others if a not in used], k, rng)

        foils = []
        for kind in KINDS:
            for f in chosen[kind]:
                # 오디오는 w를 말했고 목표는 f다 → (인식결과=w, 목표=f) 순서
                app_wrong = not is_speech_correct(w, f, "word")
                foils.append({
                    "foil": f,
                    "kind": kind,
                    "err": round(speech_error_rate(w, f, "word"), 4),
                    "app_wrong": app_wrong,
                    "counts_for_fa": counts_for_fa(kind, app_wrong),
                })
        out[w] = {"in_app_pool": w in pool, "category": cat, "foils": foils}
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="목표 단어 검증용 근접 foil을 만든다")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--words", nargs="+")
    src.add_argument("--words-from", type=Path, help="jsonl — 각 행의 text를 단어로 쓴다")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--pool", type=Path, default=DEFAULT_POOL)
    ap.add_argument("--item-bank", type=Path, default=DEFAULT_BANK)
    ap.add_argument("-k", type=int, default=3, help="종류별 foil 개수")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if args.words_from:
        words = [json.loads(l)["text"].strip() for l in args.words_from.open(encoding="utf-8") if l.strip()]
    else:
        words = args.words

    pool = load_pool(args.pool)
    categories = load_categories(args.item_bank)
    missing_slug = sorted(s for s in pool.values() if s not in categories)
    foils = build_foils(words, pool, categories, k=args.k, seed=args.seed)

    args.out.write_text(json.dumps({
        "meta": {"seed": args.seed, "k": args.k, "pool_size": len(pool), "kinds": list(KINDS)},
        "words": foils,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"단어 {len(foils)}종 · 앱 어휘 {len(pool)}종 · 범주표에 없는 앱 slug {len(missing_slug)}개")
    for w, info in foils.items():
        by = {kd: [f"{f['foil']}{'' if f['app_wrong'] else '*'}" for f in info["foils"] if f["kind"] == kd]
              for kd in KINDS}
        warn = "" if info["in_app_pool"] else "  [!] 앱 어휘에 없음"
        print(f"  {w} ({info['category']}){warn}")
        for kd in KINDS:
            print(f"    {kd:4}: {' '.join(by[kd]) or '(없음)'}")
    allf = [f for i in foils.values() for f in i["foils"]]
    print(f"\nfoil {len(allf)}개 · 오통과율 분모 {sum(f['counts_for_fa'] for f in allf)}개")
    print("* = 앱 채점기가 정답으로 친다. 종류별:")
    for kd in KINDS:
        fs = [f for f in allf if f["kind"] == kd]
        print(f"  {kd:4}: {sum(not f['app_wrong'] for f in fs)}/{len(fs)}")
    print(f"→ {args.out}")


if __name__ == "__main__":
    main()
