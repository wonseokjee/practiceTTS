"""이웃 비교 채점 0단계 — 608 test 단어로 두 팔(A·B)을 오프라인 실측한다.

설계와 판정 규칙: `docs/history/20260926_NeighborScoring_design.md` 4절(결과 전에 적음).

- 양성(맞게 말함): 단어 A 오디오 · 목표 A · 이웃 = neighbors(A)
- 음성(가까운 다른 단어를 말함): 단어 A 오디오 · 목표 B(측정 B′의 음운·의미 근접 foil)
  · 이웃 = neighbors(B). **A가 neighbors(B)에 있는지는 가정하지 않는다.**

점수는 (오디오, 참조) 단위 캐시를 쓴다. 측정 B·B′가 남긴 캐시를 그대로 읽으므로
이미 채점한 쌍은 다시 부르지 않는다. 목표가 60 미만이면 이웃을 부르지 않는다(어차피 오답).

판정(3-1절, m=0이 주 판정):
    목표 채점 불가            → unscored
    목표 < 60                 → fail
    이웃 호출 실패(취소·예외)  → unscored   (목표 점수만으로 채점하지 않는다)
    목표 >= 최고 이웃 + m      → pass
    그 밖                      → ambiguous
이웃 쪽 NoMatch(인식 텍스트 없음)는 실패가 아니라 "그 참조로는 안 들렸다"이므로 0점으로 본다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import azure_eval as AE  # noqa: E402
import azure_foil_eval as FE  # noqa: E402
import build_target_foils as F  # noqa: E402
import neighbor_manifest as N  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PASS = FE.APP_PASS_ACCURACY
# 사전 등록(설계 문서 4절)
FA_MAX, AMB_MAX = 0.05, 0.15


def comp_score(res: dict | None) -> float | None:
    """이웃 참조 점수. None = 호출 실패(판정 불가). NoMatch는 0점."""
    if res is None or res.get("reason") in ("Canceled", "Exception"):
        return None
    if res.get("pa") and (res.get("text") or "").strip():
        return res["pa"]["accuracy"]
    return 0.0


def decide(target_res: dict | None, comp_res: list[dict | None], m: float = 0.0) -> str:
    oc = FE.app_outcome(target_res)
    if oc == "unscored":
        return "unscored"
    if oc == "fail":
        return "fail"
    t = target_res["pa"]["accuracy"]
    scores = [comp_score(r) for r in comp_res]
    if any(s is None for s in scores):
        return "unscored"
    return "pass" if all(t >= s + m for s in scores) else "ambiguous"


def norm_transcript(t: str | None) -> str:
    """STT 전사 정규화 — NFC, 문장부호 제거, 공백 정리."""
    t = unicodedata.normalize("NFC", t or "")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def stt_competitor(transcript: str | None, target: str) -> str | None:
    """설계 8절 — 비었거나, 목표와 같거나, 포함관계면 경쟁자로 안 쓴다."""
    t = norm_transcript(transcript)
    if not t:
        return None
    a, b = t.replace(" ", ""), target.replace(" ", "")
    if a == b or N.is_containment(a, b):
        return None
    return t


def plan(rows: list[dict], foils: dict, vocab: list[str], arm: str,
         stt: dict[str, str] | None = None) -> tuple[list[dict], list[dict]]:
    """양성·음성 사례 목록. 각 사례 = {audio, _wav, said, target, comps}.

    arm: A=앱 어휘 이웃 3 · B=A+초성 비단어 2 · C=A+STT 전사 · S=STT 전사만
    """
    if arm in ("C", "S") and stt is None:
        raise ValueError("팔 C·S에는 STT 전사가 필요하다")

    def comps(t: str, audio: str) -> list[str]:
        c = [] if arm == "S" else N.neighbors(t, vocab)
        if arm == "B":
            c = c + N.onset_pseudowords(t, vocab)
        if arm in ("C", "S"):
            x = stt_competitor(stt.get(audio), t)
            if x is not None and x not in c:
                c = c + [x]
        return c

    pos, neg = [], []
    for r in rows:
        a = r["text"].strip()
        pos.append({"audio": r["audio"], "_wav": r["_wav"], "said": a, "target": a,
                    "comps": comps(a, r["audio"])})
        for f in foils[a]["foils"]:
            if f["counts_for_fa"]:
                neg.append({"audio": r["audio"], "_wav": r["_wav"], "said": a, "target": f["foil"],
                            "comps": comps(f["foil"], r["audio"])})
    return pos, neg


class Scores:
    """(오디오, 참조) → Azure 결과. 정답 참조 캐시와 쌍 캐시를 함께 본다."""

    def __init__(self, pos_cache: dict, pair_cache: dict, text_of: dict[str, str]):
        self.pos, self.pair, self.text_of = pos_cache, pair_cache, text_of

    def get(self, audio: str, ref: str) -> dict | None:
        if self.text_of.get(audio) == ref and audio in self.pos:
            return self.pos[audio]
        return self.pair.get(FE.cache_key(audio, ref))


def needed_calls(cases: list[dict], sc: Scores) -> list[tuple[str, Path, str]]:
    """아직 없는 (오디오, 참조) 호출. 목표가 60 미만이면 이웃은 안 부른다."""
    out, seen = [], set()
    for c in cases:
        refs = [c["target"]]
        tr = sc.get(c["audio"], c["target"])
        if tr is not None and FE.app_outcome(tr) != "pass":
            refs = []   # 목표가 이미 정해졌다(오답·채점 불가) — 이웃 불필요
        elif tr is not None:
            refs = c["comps"]
        else:
            refs = [c["target"]]   # 목표부터(음성의 목표는 B′ 캐시에 거의 다 있다)
        for ref in refs:
            k = (c["audio"], ref)
            if k not in seen and sc.get(*k) is None:
                seen.add(k)
                out.append((c["audio"], c["_wav"], ref))
    return out


def summarize(pos: list[dict], neg: list[dict], sc: Scores, m: float) -> dict:
    def outcomes(cases):
        return [decide(sc.get(c["audio"], c["target"]), [sc.get(c["audio"], x) for x in c["comps"]], m)
                for c in cases]
    po, no = outcomes(pos), outcomes(neg)

    def rate(xs, k):
        return xs.count(k) / len(xs) if xs else float("nan")
    return {
        "m": m,
        "pos": {k: po.count(k) for k in ("pass", "ambiguous", "fail", "unscored")},
        "neg": {k: no.count(k) for k in ("pass", "ambiguous", "fail", "unscored")},
        "fa": rate(no, "pass"), "fa_ci95": FE.wilson(no.count("pass"), len(no)),
        "amb": rate(po, "ambiguous"), "fr": rate(po, "fail"),
        "neg_said_in_comps": sum(c["said"] in c["comps"] for c in neg) / len(neg) if neg else float("nan"),
    }


def verdict(s: dict) -> str:
    ok = s["fa"] <= FA_MAX and s["amb"] <= AMB_MAX
    return (("통과" if ok else "실패")
            + f" (오통과 {s['fa']:.1%} {'<=' if s['fa'] <= FA_MAX else '>'} {FA_MAX:.0%},"
              f" 모호율 {s['amb']:.1%} {'<=' if s['amb'] <= AMB_MAX else '>'} {AMB_MAX:.0%})")


def main() -> int:
    ap = argparse.ArgumentParser(description="이웃 비교 채점 0단계 실측")
    ap.add_argument("--split", required=True, type=Path)
    ap.add_argument("--cache", type=Path, default=None, help="기본: <split 폴더>/_azure_pa_foil_cache.jsonl(쌍 캐시 공유)")
    ap.add_argument("--pos-cache", type=Path, default=None)
    ap.add_argument("--arms", default="A,B")
    ap.add_argument("--stt-cache", type=Path, default=None,
                    help="팔 C·S용 후보 목록 없는 STT 전사. 기본: <split 폴더>/_azure_stt_cache.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--estimate-only", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--price-per-hour", type=float, default=1.0)
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--lang", default="ko-KR")
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    rows = [r for r in AE.load_split(args.split) if r.get("task_type") == "wordlist"]
    if args.limit:
        rows = rows[: args.limit]
    vocab = N.load_app_vocab()
    foils = F.build_foils([r["text"].strip() for r in rows], F.load_pool(F.DEFAULT_POOL),
                          F.load_categories(F.DEFAULT_BANK))
    cache_path = args.cache or args.split.parent / "_azure_pa_foil_cache.jsonl"
    pos_path = args.pos_cache or args.split.parent / "_azure_pa_cache.jsonl"
    sc = Scores(AE.load_cache(pos_path), FE.load_pair_cache(cache_path),
                {r["audio"]: r["text"].strip() for r in rows})
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    stt = None
    if any(a in ("C", "S") for a in arms):
        stt_path = args.stt_cache or args.split.parent / "_azure_stt_cache.jsonl"
        stt = {a: d.get("text", "") for a, d in AE.load_cache(stt_path).items()}
        missing = [r["audio"] for r in rows if r["audio"] not in stt]
        if missing:
            print(f"STT 전사가 없는 행 {len(missing)}개 — azure_eval.py --mode stt 를 먼저", file=sys.stderr)
            return 2
    plans = {a: plan(rows, foils, vocab, a, stt) for a in arms}

    def todo_all():
        out, seen = [], set()
        for pos, neg in plans.values():
            for t in needed_calls(pos + neg, sc):
                if (t[0], t[2]) not in seen:
                    seen.add((t[0], t[2]))
                    out.append(t)
        return out

    # 두 번 돈다 — 1차에 목표 점수가 없던 사례는 목표를 채운 뒤에야 이웃이 필요한지 안다
    for rnd in (1, 2):
        todo = todo_all()
        secs: dict[str, float] = {}
        for a, w, _ in todo:
            secs.setdefault(a, AE.wav_seconds(w) or 0.0)
        cost = sum(secs[a] for a, _, _ in todo) / 3600 * args.price_per_hour
        print(f"[{rnd}차] 호출할 것 {len(todo)}건 · {sum(secs[a] for a, _, _ in todo) / 60:.1f}분 → 약 ${cost:.2f}")
        if not todo or args.estimate_only:
            break
        if not args.yes:
            print("실제 호출은 --yes 를 붙여야 한다.")
            return 1
        try:
            from dotenv import load_dotenv
            for env in ([args.env_file] if args.env_file else [AE.REPO / "ai-service" / ".env"]):
                if env and env.exists():
                    load_dotenv(env, override=False)
        except ImportError:
            pass
        key, region = os.getenv("AZURE_SPEECH_KEY", ""), os.getenv("AZURE_SPEECH_REGION", "")
        if not key or not region:
            print("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION 이 없다", file=sys.stderr)
            return 2
        import azure.cognitiveservices.speech as speechsdk
        t0, consec = time.time(), 0
        for i, (audio, wav, ref) in enumerate(todo, 1):
            res = None
            for attempt in range(args.retries + 1):
                try:
                    res = AE.recognize(speechsdk, AE.make_recognizer(speechsdk, key, region, wav, args.lang, ref), True)
                    break
                except Exception as e:
                    if attempt == args.retries:
                        res = {"reason": "Exception", "text": "", "cancel_detail": f"{type(e).__name__}: {e}"[:200]}
                    else:
                        time.sleep(1.0 + attempt)
            res.update({"audio": audio, "ref": ref, "kind": "neighbor"})
            AE.append_cache(cache_path, res)
            sc.pair[FE.cache_key(audio, ref)] = res
            consec = consec + 1 if res["reason"] in ("Canceled", "Exception") else 0
            if consec >= 5:
                print(f"연속 {consec}건 실패 — 멈춘다: {res.get('cancel_detail', '')}", file=sys.stderr)
                return 3
            if i % 100 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  {i}/{len(todo)} ({el:.0f}s, 남은 예상 {el / i * (len(todo) - i):.0f}s)", flush=True)

    if args.estimate_only:
        print("--estimate-only 이므로 호출하지 않았다.")
        return 0

    report = {}
    for a, (pos, neg) in plans.items():
        desc = {"A": "앱 어휘 3", "B": "앱 어휘 3 + 초성 비단어 2", "C": "앱 어휘 3 + STT 전사", "S": "STT 전사만"}[a]
        print(f"\n══ 팔 {a} — 이웃 {desc} ══")
        print(f"  양성 {len(pos)} · 음성 {len(neg)} · 음성 중 '말한 단어가 이웃 목록에 있음' "
              f"{sum(c['said'] in c['comps'] for c in neg) / max(1, len(neg)):.1%}")
        for m in (0.0, 5.0):
            s = summarize(pos, neg, sc, m)
            lo, hi = s["fa_ci95"]
            tag = "주 판정" if m == 0 else "참고"
            print(f"  m={m:.0f} ({tag}) 양성 {s['pos']} · 음성 {s['neg']}")
            print(f"        오통과 {s['fa']:.1%} [{lo:.1%}, {hi:.1%}] · 모호율 {s['amb']:.1%} · 오판정 {s['fr']:.1%}"
                  + (f"  → {verdict(s)}" if m == 0 else ""))
            report[f"{a}_m{m:.0f}"] = s
    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
