"""현행 채점기(Azure 발음 평가)의 근접 단어 오통과를 잰다.

**질문.** 앱은 목표 단어 B를 참조 텍스트로 Azure에 보내고 `accuracy ≥ 60`이면
정답 처리한다(`pronunciationScore.ts`의 `evaluateFromAzure`). 환자가 B 대신 **가까운
다른 단어** A를 말하면(사탕 문항에 "사자") 몇 번이나 정답 처리되는가.

음향 채점기 계획 0단계 측정 B(`acoustic-scorer-plan.md` 4-2절)는 **음절 수만 맞춘
무작위** 오답 참조로 단어 6.2%를 냈다. 무작위는 쉬운 시험이다. 여기서는
`build_target_foils.py`의 근접 foil을 참조로 준다.

이건 흉내가 아니라 실제 상황 그대로다 — "A를 말한 오디오 + 참조 B"가 곧 "목표 B에
환자가 A를 말함"이다. 다만 A는 608 화자가 **맞게 읽으려 한** 단어라, 실어증 환자의
착어 발화와 음향적으로 같다는 보장은 없다.

정답 참조 점수는 `azure_eval.py --mode pa`가 남긴 캐시(`_azure_pa_cache.jsonl`)를
재사용한다 — 새로 호출하는 건 foil 참조뿐이다.

돈이 나가는 스크립트다. `azure_eval.py`와 같은 안전장치를 쓴다: 과금을 먼저 찍고
`--yes` 없이는 호출하지 않으며, (오디오, 참조) 단위로 캐시해 다시 돌려도 두 번 내지 않는다.

사용
----
    P=ai-service/venv/Scripts/python.exe
    S=C:/Users/wsji9/Downloads/608-audio-work/colab_trainset_big6/test.jsonl
    $P scripts/asr_eval/azure_foil_eval.py --split "$S" --estimate-only
    $P scripts/asr_eval/azure_foil_eval.py --split "$S" --limit 5 --yes     # 스모크
    $P scripts/asr_eval/azure_foil_eval.py --split "$S" --yes
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import azure_eval as AE  # noqa: E402
import build_target_foils as F  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

APP_PASS_ACCURACY = 60   # pronunciationScore.ts AZURE_GRADE_THRESHOLDS.good (단어 = accuracy 그대로)
DEFAULT_KINDS = ("phon", "sem", "para")   # rand는 0단계 측정 B의 캐시가 이미 있다

# 사전 등록(acoustic-scorer-plan.md 4-3절, 결과 보기 전에 적었다) — 근접 foil(phon+sem) 오통과율
LEAK_OK, LEAK_BAD = 0.05, 0.10


def app_outcome(res: dict | None) -> str:
    """앱이 이 Azure 결과로 내릴 판정: 'pass' | 'fail' | 'unscored'.

    `evaluateFromAzure`와 같다 — 점수가 없거나 인식 텍스트가 비면 채점하지 않는다.
    """
    if not res or not res.get("pa"):
        return "unscored"
    if not (res.get("text") or "").strip():
        return "unscored"
    return "pass" if res["pa"]["accuracy"] >= APP_PASS_ACCURACY else "fail"


def cache_key(audio: str, ref: str) -> str:
    return f"{audio}\t{ref}"


def load_pair_cache(p: Path) -> dict[str, dict]:
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            d = json.loads(line)
            out[cache_key(d["audio"], d["ref"])] = d
    return out


def build_pairs(rows: list[dict], foils: dict[str, dict], kinds: tuple[str, ...]) -> list[dict]:
    """단어 행 × 그 단어의 foil — (오디오, 참조) 호출 목록."""
    pairs = []
    for r in rows:
        w = r["text"].strip()
        for f in foils.get(w, {}).get("foils", []):
            if f["kind"] in kinds:
                pairs.append({"audio": r["audio"], "_wav": r["_wav"], "word": w, "ref": f["foil"],
                              "kind": f["kind"], "counts_for_fa": f["counts_for_fa"],
                              "string_scorer_wrong": f["string_scorer_wrong"]})
    return pairs


def summarize(pairs: list[dict], pair_cache: dict[str, dict], pos_cache: dict[str, dict]) -> dict:
    """종류별 오통과율, 정답 참조 대비 AUC, 문자열 채점기와의 대조."""
    out: dict = {}
    groups = {k: [p for p in pairs if p["kind"] == k] for k in sorted({p["kind"] for p in pairs})}
    groups["근접(phon+sem)"] = [p for p in pairs if p["counts_for_fa"]]
    for name, ps in groups.items():
        done = [p for p in ps if cache_key(p["audio"], p["ref"]) in pair_cache]
        if not done:
            continue
        oc = [app_outcome(pair_cache[cache_key(p["audio"], p["ref"])]) for p in done]
        scored = [o for o in oc if o != "unscored"]
        neg = [pair_cache[cache_key(p["audio"], p["ref"])]["pa"]["accuracy"]
               for p in done if pair_cache[cache_key(p["audio"], p["ref"])].get("pa")]
        pos = [pos_cache[a]["pa"]["accuracy"] for a in {p["audio"] for p in done}
               if pos_cache.get(a, {}).get("pa")]
        out[name] = {
            "n": len(done),
            "pass": oc.count("pass"), "unscored": oc.count("unscored"),
            # 분모 = 앱이 실제로 판정을 내린 것. 채점 불가는 통과도 탈락도 아니다
            "fa_rate": (oc.count("pass") / len(scored)) if scored else float("nan"),
            "mean_acc_foil": sum(neg) / len(neg) if neg else float("nan"),
            "mean_acc_true": sum(pos) / len(pos) if pos else float("nan"),
            "auc": AE.auc(pos, neg) if pos and neg else float("nan"),
            "string_scorer_pass": sum(not p["string_scorer_wrong"] for p in done) / len(done),
        }
    return out


def verdict(rate: float) -> str:
    if rate != rate:
        return "판정 불가(n=0)"
    if rate <= LEAK_OK:
        return f"문제없음 (근접 오통과 {rate:.1%} <= {LEAK_OK:.0%})"
    if rate <= LEAK_BAD:
        return f"주의 (근접 오통과 {rate:.1%}, {LEAK_OK:.0%}~{LEAK_BAD:.0%}) — 비대칭 오류 정책(TODOS 2)으로 다룬다"
    return f"결함 (근접 오통과 {rate:.1%} > {LEAK_BAD:.0%}) — 이름대기가 근접 단어 대치를 못 잡는다"


def worst_words(pairs: list[dict], pair_cache: dict[str, dict], k: int = 10) -> list[tuple]:
    """근접 foil에서 통과가 난 (목표, 실제로 말한 단어, accuracy) — 사례 보기용."""
    hits = []
    for p in pairs:
        res = pair_cache.get(cache_key(p["audio"], p["ref"]))
        if p["counts_for_fa"] and app_outcome(res) == "pass":
            hits.append((p["ref"], p["word"], res["pa"]["accuracy"]))
    return sorted(hits, key=lambda x: -x[2])[:k]


def main() -> int:
    ap = argparse.ArgumentParser(description="Azure 발음 평가의 근접 단어 오통과를 잰다")
    ap.add_argument("--split", required=True, type=Path, help="test.jsonl (big6)")
    ap.add_argument("--kinds", default=",".join(DEFAULT_KINDS))
    ap.add_argument("--limit", type=int, default=0, help="단어 행 N개만(스모크)")
    ap.add_argument("--cache", type=Path, default=None, help="기본: <split 폴더>/_azure_pa_foil_cache.jsonl")
    ap.add_argument("--pos-cache", type=Path, default=None, help="기본: <split 폴더>/_azure_pa_cache.jsonl")
    ap.add_argument("--lang", default="ko-KR")
    ap.add_argument("--estimate-only", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--price-per-hour", type=float, default=1.0)
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--out", type=Path, default=None, help="요약 JSON(리포 밖 권장)")
    args = ap.parse_args()

    kinds = tuple(k.strip() for k in args.kinds.split(",") if k.strip())
    bad = [k for k in kinds if k not in F.KINDS]
    if bad:
        print(f"모르는 종류: {bad}", file=sys.stderr)
        return 2

    rows = [r for r in AE.load_split(args.split) if r.get("task_type") == "wordlist"]
    if args.limit:
        rows = rows[: args.limit]
    pool = F.load_pool(F.DEFAULT_POOL)
    foils = F.build_foils([r["text"].strip() for r in rows], pool, F.load_categories(F.DEFAULT_BANK))
    pairs = build_pairs(rows, foils, kinds)

    cache_path = args.cache or args.split.parent / "_azure_pa_foil_cache.jsonl"
    pos_path = args.pos_cache or args.split.parent / "_azure_pa_cache.jsonl"
    pair_cache = load_pair_cache(cache_path)
    pos_cache = AE.load_cache(pos_path)
    if not pos_cache:
        print(f"정답 참조 캐시가 없다: {pos_path} — azure_eval.py --mode pa 를 먼저 돌려라", file=sys.stderr)
        return 2

    todo = [p for p in pairs if cache_key(p["audio"], p["ref"]) not in pair_cache]
    secs = {}
    for p in todo:
        if p["audio"] not in secs:
            secs[p["audio"]] = AE.wav_seconds(p["_wav"]) or 0.0
    todo_secs = sum(secs[p["audio"]] for p in todo)
    print(f"단어 행      : {len(rows)} · foil 종류 {kinds}")
    print(f"호출 쌍      : {len(pairs)} (이미 있음 {len(pairs) - len(todo)})")
    print(f"호출할 것    : {len(todo)}건 · {todo_secs / 60:.1f}분 → 약 ${todo_secs / 3600 * args.price_per_hour:.2f}")
    print(f"캐시         : {cache_path}")

    if args.estimate_only:
        print("\n--estimate-only 이므로 호출하지 않았다.")
        return 0

    if todo and not args.report_only:
        if not args.yes:
            print("\n실제 호출은 --yes 를 붙여야 한다.")
            return 1
        probs = AE.wav_format_problems(rows)
        if probs:
            print("WAV 형식 문제:", probs[:3], file=sys.stderr)
            return 2
        try:
            from dotenv import load_dotenv
            for env in ([args.env_file] if args.env_file else [AE.REPO / "ai-service" / ".env", AE.REPO / ".env"]):
                if env and env.exists():
                    load_dotenv(env, override=False)
        except ImportError:
            pass
        key, region = os.getenv("AZURE_SPEECH_KEY", ""), os.getenv("AZURE_SPEECH_REGION", "")
        if not key or not region:
            print("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION 이 없다 (--env-file 확인)", file=sys.stderr)
            return 2
        print(f"자격증명     : region={region} · key 길이 {len(key)}자")
        import azure.cognitiveservices.speech as speechsdk

        t0, consec = time.time(), 0
        for i, p in enumerate(todo, 1):
            res = None
            for attempt in range(args.retries + 1):
                try:
                    rec = AE.make_recognizer(speechsdk, key, region, p["_wav"], args.lang, p["ref"])
                    res = AE.recognize(speechsdk, rec, want_pa=True)
                    break
                except Exception as e:
                    if attempt == args.retries:
                        res = {"reason": "Exception", "text": "", "cancel_detail": f"{type(e).__name__}: {e}"[:200]}
                    else:
                        time.sleep(1.0 + attempt)
            res.update({"audio": p["audio"], "ref": p["ref"], "word": p["word"], "kind": p["kind"]})
            AE.append_cache(cache_path, res)
            pair_cache[cache_key(p["audio"], p["ref"])] = res
            consec = consec + 1 if res["reason"] in ("Canceled", "Exception") else 0
            if consec >= 5:
                print(f"연속 {consec}건 실패 — 멈춘다: {res.get('cancel_detail', '')}", file=sys.stderr)
                break
            if i % 50 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  {i}/{len(todo)} ({el:.0f}s, 남은 예상 {el / i * (len(todo) - i):.0f}s)", flush=True)

    s = summarize(pairs, pair_cache, pos_cache)
    pos_oc = [app_outcome(pos_cache.get(r["audio"])) for r in rows]
    pos_scored = [o for o in pos_oc if o != "unscored"]
    print("\n── 정답 참조(기준선) ──")
    print(f"  단어 {len(rows)}행 · 정답 처리 {pos_oc.count('pass')} · 채점 불가 {pos_oc.count('unscored')}"
          f" · 오판정률 {1 - pos_oc.count('pass') / len(pos_scored):.1%}" if pos_scored else "  (없음)")
    print("\n── foil 참조 — 앱 판정(accuracy >= 60) ──")
    print(f"  {'종류':14}{'n':>6}{'오통과':>9}{'채점불가':>9}{'acc 정답':>10}{'acc foil':>10}{'AUC':>7}{'문자열채점기 통과':>18}")
    for name, g in s.items():
        print(f"  {name:14}{g['n']:6d}{g['fa_rate']:9.1%}{g['unscored']:9d}{g['mean_acc_true']:10.1f}"
              f"{g['mean_acc_foil']:10.1f}{g['auc']:7.3f}{g['string_scorer_pass']:18.1%}")
    near = s.get("근접(phon+sem)")
    if near:
        print(f"\n[판정 — 사전 등록] {verdict(near['fa_rate'])}")
        hits = worst_words(pairs, pair_cache)
        if hits:
            print("  통과가 난 사례(목표 ← 실제로 말한 단어, accuracy):")
            for ref, said, acc in hits:
                print(f"    {ref} ← {said}  {acc:.0f}")
    if args.out:
        args.out.write_text(json.dumps({"summary": s, "verdict": verdict(near["fa_rate"]) if near else None},
                                       ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
