"""Azure 대조 측정 — 608 test 스플릿을 Azure로 돌려 자체 ASR과 같은 잣대로 잰다.

**왜 필요한가.** 지금까지 파인튜닝 성과는 전부 *범용 whisper zero-shot* 대비로
인용됐다(test 단어 정확 일치율 51.4% → 81.5%). 그런데 제품이 실제로 쓰는 것은
zero-shot whisper가 아니라 **Azure STT**다. 그 수치가 대장 어디에도 없다.

이 측정 하나가 다음 결정을 가른다:

| Azure 단어 정확 일치율 | 뜻 | 다음 |
|---|---|---|
| 50%대 | 자체 ASR이 압도한다 | 서빙 경로(병합·양자화·엔드포인트)를 만든다 |
| 80% 안팎 | 자체 ASR로 얻는 게 없다 | 서빙을 접고 음향 채점기로 간다 |

809M 모델 서빙은 큰 공사다. **근거 없이 시작하는 것이 제일 비싼 실수다.**

두 모드
-------
`--mode stt` (기본) — 순수 인식. **ASR 비교는 반드시 이쪽이다.**
`--mode pa`         — 발음 평가(PronunciationAssessment). 음향 채점기 계획의
                      0단계 실측 A를 겸한다. 여기서 나온 전사는 참조 텍스트를
                      알려주고 받은 것이라 **ASR 비교에 쓰면 안 된다** — 시험지를
                      보여주고 받아쓰게 한 셈이다.

잣대 동일성
-----------
노트북(`finetune_whisper_608_colab.ipynb`)의 `report_test`와 **같은 잣대**여야
비교가 성립한다. 그래서 이 파일은:

- 단어 정확 일치율: 노트북의 `norm()`을 그대로 옮겼다(NFC → 문장부호를 공백으로
  → 공백 정규화 → strip).
- CER: 노트북은 `evaluate.load("cer")`를 쓴다. 그것은 내부에서 jiwer에
  `RemoveMultipleSpaces → Strip → ReduceToListOfListOfChars` 변환을 걸고
  (오류 수 합) / (오류 수 + 정답 수 합)을 낸다. 여기서는 그 조합을 명시적으로
  재현하고, `evaluate`가 설치돼 있으면 **두 값을 대조해 어긋나면 멈춘다**.
  `scripts/asr_eval/metrics.py`의 `corpus_cer`은 자체 정규화를 하므로 쓰지 않는다.
- 앱 잣대: `scripts/asr_eval/app_scorer.py` — 노트북이 쓰는 바로 그 파일.

**남은 차이 하나(알고 있는 것).** 노트북의 참조 텍스트는 토크나이저를 왕복한
결과이고(`tokenizer(text).input_ids` → `batch_decode`), 여기서는 `test.jsonl`의
원문이다. whisper의 byte-level BPE는 왕복이 무손실이라 실질 차이는 없을 것으로
보지만, 검증된 것은 아니다. 수치를 인용할 때 이 단서를 같이 적어라.

돈이 나가는 스크립트다
----------------------
- 호출 전에 **항상** 오디오 총 길이와 예상 과금을 먼저 찍고, `--yes` 없이는
  실제 호출을 하지 않는다.
- 결과는 한 건씩 캐시에 적재된다. 중간에 죽어도 다시 돌리면 **캐시된 것은
  건너뛴다** — 같은 오디오에 두 번 돈을 쓰지 않는다.
- 처음 몇 건이 연속 취소(인증/네트워크 오류)되면 즉시 멈춘다.

사용
----
    P=ai-service/venv/Scripts/python.exe
    S=C:/Users/wsji9/Downloads/608-audio-work/colab_trainset_big6/test.jsonl

    # 1) 돈 안 씀 — 길이·과금 추정만
    $P scripts/asr_eval/azure_eval.py --split "$S" --estimate-only

    # 2) 10건 스모크
    $P scripts/asr_eval/azure_eval.py --split "$S" --limit 10 --yes

    # 3) 전체 417건 (ASR 비교)
    $P scripts/asr_eval/azure_eval.py --split "$S" --yes

    # 4) 발음 평가 (음향 채점기 0단계)
    $P scripts/asr_eval/azure_eval.py --split "$S" --mode pa --yes

선행: `pip install evaluate jiwer` (venv에 없다). CER 잣대를 노트북과 대조하는 데
쓴다 — 없으면 멈춘다(--allow-unverified-cer로 넘길 수는 있다). 자격증명은 `ai-service/.env`의
`AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`을 읽는다 — **값은 출력하지 않는다.**
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import app_scorer  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[2]


# ── 잣대: 노트북 report_test와 동일해야 한다 ──────────────────────────

def norm(t: str) -> str:
    """노트북 report_test의 norm()을 그대로 옮긴 것. 단어 정확 일치 판정용."""
    t = unicodedata.normalize("NFC", t or "")
    t = re.sub(r"[^\w가-힣\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _cer_pair(ref: str, hyp: str) -> tuple[int, int]:
    """(오류 수, 오류+정답 수). evaluate의 CER 집계 방식과 같은 단위."""
    # evaluate/jiwer의 cer_transform: RemoveMultipleSpaces → Strip → 문자 리스트
    r = list(re.sub(r"\s+", " ", ref or "").strip())
    h = list(re.sub(r"\s+", " ", hyp or "").strip())
    # 레벤슈타인 DP. 되돌아보며 S/D/I를 세는 대신, hits = len(r) - (S + D)를 쓴다.
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i]
        for j, hc in enumerate(h, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc)))
        prev = cur
    dist = prev[-1]
    # S+D+I = dist. hits + S + D = len(r) → hits + S + D + I = len(r) + I.
    # evaluate의 분모는 S + D + hits = len(r)다(삽입은 분모에 안 들어간다).
    return dist, len(r)


def corpus_cer(refs: list[str], hyps: list[str]) -> float:
    """evaluate.load('cer')와 같은 집계: 오류 합 / 참조 문자 합."""
    num = den = 0
    for r, h in zip(refs, hyps):
        d, n = _cer_pair(r, h)
        num += d
        den += n
    return num / den if den else 0.0


def _cross_check(refs: list[str], hyps: list[str], mine: float, allow_unverified: bool) -> None:
    """노트북이 쓰는 evaluate와 대조한다.

    이 측정 하나가 "서빙을 만들 것인가"를 가른다. 잣대가 검증되지 않은 채로
    숫자를 내면 그 결정의 근거가 없는 것과 같다. 그래서 기본은 **검증 실패 시
    멈춤**이고, 넘어가려면 --allow-unverified-cer를 명시해야 한다.
    """
    why = None
    try:
        import evaluate  # type: ignore
        theirs = evaluate.load("cer").compute(predictions=hyps, references=refs)
    except ImportError:
        why = "evaluate 미설치"
    except Exception as e:  # 허브 접근 실패(오프라인) 등
        why = f"evaluate 로드 실패({type(e).__name__})"

    if why is None:
        if abs(theirs - mine) > 1e-9:
            raise SystemExit(
                f"CER 구현이 노트북과 어긋난다: 이 파일 {mine!r} vs evaluate {theirs!r}\n"
                "이대로면 노트북 수치(7차재현 0.329/0.132)와 비교할 수 없다. 멈춘다."
            )
        print(f"  CER 잣대 검증 통과 — evaluate와 일치 ({theirs:.6f})")
        return

    if not allow_unverified:
        raise SystemExit(
            f"CER 잣대를 검증할 수 없다({why}).\n"
            "  해결: ai-service/venv 의 python으로 `pip install evaluate jiwer`\n"
            "        (evaluate.load는 최초 1회 네트워크가 필요하다)\n"
            "  검증 없이 진행하려면: --allow-unverified-cer\n"
            "  ※ 캐시는 이미 저장됐다. 다시 돌려도 Azure 재호출은 없다."
        )
    print(f"  ⚠ CER 잣대 미검증({why}) — 노트북과 어긋날 수 있다. 인용 시 이 단서를 적어라.")


# ── 데이터 ────────────────────────────────────────────────────────────

def load_split(path: Path) -> list[dict]:
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    for r in rows:
        r["_wav"] = (path.parent / r["audio"]).resolve()
    return rows


def stratified_head(rows: list[dict], n: int) -> list[dict]:
    """task_type 비율을 유지해 n건을 고른다.

    test.jsonl은 문장이 앞에 몰려 있어서 그냥 앞에서 자르면 스모크가 **단어를
    한 건도 안 건드린다.** 단어가 검사 모드의 1급 지표인데 그러면 스모크의
    의미가 없다.
    """
    by: dict[str | None, list[int]] = {}
    for i, r in enumerate(rows):
        by.setdefault(r.get("task_type"), []).append(i)
    picked: list[int] = []
    for idxs in by.values():
        take = min(len(idxs), max(1, round(n * len(idxs) / len(rows))))
        picked.extend(idxs[:take])
    return [rows[i] for i in sorted(picked)]


def wav_seconds(p: Path) -> float | None:
    try:
        with wave.open(str(p), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return None


def wav_format_problems(rows: list[dict], sample: int = 20) -> list[str]:
    """Azure는 16kHz·16bit·모노 PCM WAV를 기대한다. 어긋나면 조용히 실패한다."""
    bad = []
    for r in rows[:sample]:
        try:
            with wave.open(str(r["_wav"]), "rb") as w:
                if (w.getframerate(), w.getsampwidth(), w.getnchannels()) != (16000, 2, 1):
                    bad.append(
                        f"{r['audio']}: {w.getframerate()}Hz "
                        f"{w.getsampwidth()*8}bit {w.getnchannels()}ch"
                    )
        except Exception as e:
            bad.append(f"{r['audio']}: 열 수 없다 ({type(e).__name__})")
    return bad


# ── 캐시 (재실행 시 돈을 두 번 쓰지 않기 위한 것) ─────────────────────

def load_cache(p: Path) -> dict[str, dict]:
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            d = json.loads(line)
            out[d["audio"]] = d
    return out


def append_cache(p: Path, rec: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ── Azure ─────────────────────────────────────────────────────────────

def make_recognizer(speechsdk, key: str, region: str, wav: Path, lang: str,
                    reference_text: str | None):
    cfg = speechsdk.SpeechConfig(subscription=key, region=region)
    cfg.speech_recognition_language = lang
    audio = speechsdk.audio.AudioConfig(filename=str(wav))
    rec = speechsdk.SpeechRecognizer(speech_config=cfg, audio_config=audio)
    if reference_text is not None:
        pa = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text,
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=True,
        )
        try:
            pa.enable_prosody_assessment()
        except Exception:
            pass  # 지역/버전에 따라 없다 — 없으면 없는 대로 간다
        pa.apply_to(rec)
    return rec


def recognize(speechsdk, rec, want_pa: bool) -> dict:
    r = rec.recognize_once()
    reason = str(r.reason).rsplit(".", 1)[-1]
    out = {"reason": reason, "text": r.text or ""}
    if reason == "Canceled":
        d = speechsdk.CancellationDetails.from_result(r)
        out["cancel_reason"] = str(d.reason).rsplit(".", 1)[-1]
        # 오류 상세에 키가 실릴 여지는 없지만, 혹시 모르니 앞부분만 남긴다
        out["cancel_detail"] = (d.error_details or "")[:200]
    if want_pa and reason == "RecognizedSpeech":
        try:
            pr = speechsdk.PronunciationAssessmentResult(r)
            out["pa"] = {
                "accuracy": pr.accuracy_score,
                "fluency": pr.fluency_score,
                "completeness": pr.completeness_score,
                "pron": pr.pronunciation_score,
            }
        except Exception as e:
            out["pa_error"] = type(e).__name__
    return out


# ── 보고 ──────────────────────────────────────────────────────────────

def report(rows: list[dict], results: dict[str, dict], mode: str,
           allow_unverified: bool = False) -> None:
    hyps, refs, tts = [], [], []
    reasons: dict[str, int] = {}
    for r in rows:
        res = results.get(r["audio"])
        if res is None:
            continue
        reasons[res["reason"]] = reasons.get(res["reason"], 0) + 1
        hyps.append(res["text"])
        refs.append(r["text"])
        tts.append(r.get("task_type"))

    n = len(hyps)
    if not n:
        print("측정된 것이 없다.")
        return

    print()
    print(f"── Azure [{mode}] · n={n} " + "─" * 30)
    print("  인식 결과 분포:", ", ".join(f"{k} {v}({v/n:.1%})" for k, v in sorted(reasons.items())))
    nomatch = sum(v for k, v in reasons.items() if k != "RecognizedSpeech")
    print(f"  **전사 실패율 {nomatch/n:.1%}** — 앱은 이걸 전 점수 0.0으로 기록한다"
          if nomatch else "  전사 실패 0건")

    overall = corpus_cer(refs, hyps)
    print(f"\n  전체 CER {overall:.3f}  (참고용 — 판단은 아래 두 지표로)")
    _cross_check(refs, hyps, overall, allow_unverified)

    idx_w = [i for i, t in enumerate(tts) if t == "wordlist"]
    idx_s = [i for i, t in enumerate(tts) if t == "narrative"]

    if idx_w:
        acc = sum(norm(hyps[i]) == norm(refs[i]) for i in idx_w) / len(idx_w)
        wc = corpus_cer([refs[i] for i in idx_w], [hyps[i] for i in idx_w])
        print(f"  [검사]   단어 정확도 {acc:.1%} · CER {wc:.3f}  (n={len(idx_w)})")
    if idx_s:
        sc = corpus_cer([refs[i] for i in idx_s], [hyps[i] for i in idx_s])
        print(f"  [대화]   문장 CER {sc:.3f}  (n={len(idx_s)})")

    print()
    print(f"  ── 앱 잣대(phoneticEditDistance, 정답 경계 {app_scorer.SPEECH_PASS_THRESHOLD}) ──")
    for label, idx, m in (("검사", idx_w, "word"), ("대화", idx_s, "sentence")):
        if not idx:
            continue
        b = app_scorer.score_batch([hyps[i] for i in idx], [refs[i] for i in idx], m)
        print(f"  [{label}]   통과율 {b['pass_rate']:.1%} · 평균 오류율 {b['error_rate']:.3f}  (n={b['n']})")

    if mode == "pa":
        pas = [results[r["audio"]].get("pa") for r in rows if results.get(r["audio"])]
        pas = [p for p in pas if p]
        if pas:
            print(f"\n  ── 발음 평가 점수 분포 (n={len(pas)}) ──")
            for k in ("accuracy", "fluency", "completeness", "pron"):
                v = sorted(x[k] for x in pas if x.get(k) is not None)
                if v:
                    q = lambda f: v[min(len(v) - 1, int(len(v) * f))]  # noqa: E731
                    print(f"  {k:>13}: 최소 {v[0]:.0f} · 25% {q(.25):.0f} · 중앙 {q(.5):.0f}"
                          f" · 75% {q(.75):.0f} · 최대 {v[-1]:.0f}")

    print()
    print("  비교 대상 — 같은 시험지의 자체 ASR(7차재현) / 범용 whisper zero-shot:")
    print("    단어 정확도  81.5% / 51.4%")
    print("    단어 CER     0.329 / 0.895")
    print("    문장 CER     0.132 / 0.191")
    print("    앱 검사 통과율 87.0% / 59.6%")


# ── 메인 ──────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="608 test를 Azure로 돌려 자체 ASR과 대조한다.")
    ap.add_argument("--split", required=True, type=Path, help="test.jsonl 경로")
    ap.add_argument("--mode", choices=["stt", "pa"], default="stt",
                    help="stt=순수 인식(ASR 비교용) · pa=발음 평가(채점기 0단계용)")
    ap.add_argument("--lang", default="ko-KR")
    ap.add_argument("--limit", type=int, default=0, help="N건만 (스모크용 — task_type 비율을 유지해 뽑는다)")
    ap.add_argument("--cache", type=Path, default=None,
                    help="기본: <split과 같은 폴더>/_azure_<mode>_cache.jsonl (리포 밖)")
    ap.add_argument("--estimate-only", action="store_true", help="호출하지 않고 과금만 추정")
    ap.add_argument("--report-only", action="store_true", help="호출하지 않고 캐시로 보고만")
    ap.add_argument("--yes", action="store_true", help="추정치를 확인했고 호출을 진행한다")
    ap.add_argument("--price-per-hour", type=float, default=1.0,
                    help="오디오 시간당 단가(USD). 기본 1.0은 S0 표준 가정이다 — 직접 확인하라")
    ap.add_argument("--env-file", type=Path, default=None,
                    help="자격증명 .env 경로. 기본은 <리포>/ai-service/.env 와 <리포>/.env — "
                         "git worktree에서 돌리면 .env가 없으므로 여기서 지정한다")
    ap.add_argument("--allow-unverified-cer", action="store_true",
                    help="evaluate 없이도 진행한다(잣대 미검증 — 권장하지 않음)")
    ap.add_argument("--sleep", type=float, default=0.0, help="호출 사이 대기(초)")
    ap.add_argument("--retries", type=int, default=2)
    args = ap.parse_args()

    if not args.split.exists():
        print(f"스플릿이 없다: {args.split}", file=sys.stderr)
        return 2

    rows = load_split(args.split)
    if args.limit:
        rows = stratified_head(rows, args.limit)
    cache_path = args.cache or (args.split.parent / f"_azure_{args.mode}_cache.jsonl")
    cache = load_cache(cache_path)

    missing = [r for r in rows if not r["_wav"].exists()]
    if missing:
        print(f"오디오가 없다 ({len(missing)}건). 첫 3건: "
              + ", ".join(r["audio"] for r in missing[:3]), file=sys.stderr)
        return 2

    # ── 과금 추정 (항상 먼저) ──
    secs = [wav_seconds(r["_wav"]) or 0.0 for r in rows]
    todo = [r for r in rows if r["audio"] not in cache]
    todo_secs = sum(wav_seconds(r["_wav"]) or 0.0 for r in todo)
    print(f"스플릿      : {args.split}")
    print(f"모드        : {args.mode}  ({'순수 인식' if args.mode=='stt' else '발음 평가'})")
    print(f"대상        : {len(rows)}건 · 총 {sum(secs)/60:.1f}분")
    print(f"캐시        : {cache_path}")
    print(f"  이미 있음 : {len(rows)-len(todo)}건 (건너뛴다)")
    print(f"  호출할 것 : {len(todo)}건 · {todo_secs/60:.1f}분"
          f" → 약 ${todo_secs/3600*args.price_per_hour:.2f}"
          f" (시간당 ${args.price_per_hour:.2f} 가정)")

    if args.estimate_only:
        print("\n--estimate-only 이므로 호출하지 않았다.")
        return 0

    if not args.report_only and todo:
        bad = wav_format_problems(rows)
        if bad:
            print("\nWAV 형식이 Azure 기대(16kHz·16bit·모노)와 다르다:", file=sys.stderr)
            for b in bad[:5]:
                print("  " + b, file=sys.stderr)
            return 2
        if not args.yes:
            print("\n실제 호출은 --yes 를 붙여야 한다. 위 추정치를 먼저 확인하라.")
            return 1

        try:
            from dotenv import load_dotenv
            cands = [args.env_file] if args.env_file else [
                REPO / "ai-service" / ".env", REPO / ".env"]
            for env in cands:
                if env and env.exists():
                    load_dotenv(env, override=False)
        except ImportError:
            pass
        key = os.getenv("AZURE_SPEECH_KEY", "")
        region = os.getenv("AZURE_SPEECH_REGION", "")
        if not key or not region:
            print("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION 이 없다 "
                  "(ai-service/.env 확인).", file=sys.stderr)
            return 2
        print(f"자격증명    : region={region} · key 길이 {len(key)}자")  # 값은 찍지 않는다

        try:
            import azure.cognitiveservices.speech as speechsdk
        except ImportError:
            print("azure-cognitiveservices-speech 가 없다. "
                  "ai-service/venv 의 python으로 실행하라.", file=sys.stderr)
            return 2

        t0 = time.time()
        consec_cancel = 0
        for i, r in enumerate(todo, 1):
            ref = r["text"] if args.mode == "pa" else None
            res = None
            for attempt in range(args.retries + 1):
                try:
                    rec = make_recognizer(speechsdk, key, region, r["_wav"], args.lang, ref)
                    res = recognize(speechsdk, rec, want_pa=(args.mode == "pa"))
                    break
                except Exception as e:
                    if attempt == args.retries:
                        res = {"reason": "Exception", "text": "",
                               "cancel_detail": f"{type(e).__name__}: {e}"[:200]}
                    else:
                        time.sleep(1.0 + attempt)
            assert res is not None
            res["audio"] = r["audio"]
            res["task_type"] = r.get("task_type")
            append_cache(cache_path, res)
            cache[r["audio"]] = res

            if res["reason"] in ("Canceled", "Exception"):
                consec_cancel += 1
                if consec_cancel >= 5:
                    print(f"\n연속 {consec_cancel}건 실패 — 멈춘다. "
                          f"마지막: {res.get('cancel_detail','')}", file=sys.stderr)
                    break
            else:
                consec_cancel = 0

            if i % 20 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  {i}/{len(todo)}  ({el:.0f}s, 남은 예상 {el/i*(len(todo)-i):.0f}s)")
            if args.sleep:
                time.sleep(args.sleep)

    report(rows, cache, args.mode, args.allow_unverified_cer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
