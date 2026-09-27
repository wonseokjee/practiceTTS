"""문장 클립에서 앱 단어 구간을 잘라 단독 단어 클립을 만든다 (TODOS 자체 ASR 2번 파일럿).

12차는 사탕·풍선을 train 문장에서 30번·25번 봤는데도 단독 단어로는 못 알아들었다(대장 A-2).
문장 속 단어를 잘라 "단어 하나짜리" 학습 예시로 바꾸면 그 간극이 줄어드는지 보려는 재료다.

**정렬.** 한국어 음절 단위 CTC 모델(kresnik/wav2vec2-large-xlsr-korean, 어휘 1205 음절)로
문장 전체를 강제 정렬(Viterbi)하고, 목표 단어의 음절 구간만 잘라낸다. 조사("사탕과"의 "과")는
음절 경계에서 떼어낸다. 앞뒤 여유는 이웃 음절 쪽으로 넘어가지 않게 제한한다.

**품질 표시.** 잘린 구간의 음절별 평균 사후확률(`conf`)과, 잘린 클립만 다시 넣었을 때 CTC가
그 단어를 읽어 내는지(`reread`)를 같이 적는다 — 둘 다 선별 기준이 아니라 사람 검수용이다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PART = ("을", "를", "이", "가", "은", "는", "과", "와", "도", "에", "에서", "의", "로", "으로",
        "만", "하고", "이랑", "랑", "처럼")
SR = 16000


def find_targets(text: str, words: list[str]) -> list[tuple[str, int, int]]:
    """문장에서 (단어, 시작 음절, 끝 음절) — 공백 뺀 음절 위치. 어절 = 단어 또는 단어+조사."""
    out, pos = [], 0
    for tok in re.sub(r"[^\w\s]", " ", text).split():
        for w in sorted(words, key=len, reverse=True):
            if tok == w or (tok.startswith(w) and tok[len(w):] in PART):
                out.append((w, pos, pos + len(w)))
                break
        pos += len(tok)
    return out


def ctc_align(logp: np.ndarray, tokens: list[int], blank: int) -> list[tuple[int, int]]:
    """CTC 강제 정렬(Viterbi). 각 토큰이 차지한 프레임 [시작, 끝) 목록."""
    T, S = logp.shape[0], 2 * len(tokens) + 1
    ext = [blank if s % 2 == 0 else tokens[s // 2] for s in range(S)]
    NEG = -1e30
    dp = np.full((T, S), NEG)
    bp = np.zeros((T, S), dtype=np.int8)
    dp[0, 0] = logp[0, blank]
    if S > 1:
        dp[0, 1] = logp[0, ext[1]]
    for t in range(1, T):
        prev = dp[t - 1]
        stay = prev
        step = np.concatenate([[NEG], prev[:-1]])
        skip = np.concatenate([[NEG, NEG], prev[:-2]])
        can_skip = np.array([s % 2 == 1 and s >= 2 and ext[s] != ext[s - 2] for s in range(S)])
        skip = np.where(can_skip, skip, NEG)
        cand = np.stack([stay, step, skip])
        bp[t] = cand.argmax(0)
        dp[t] = cand.max(0) + logp[t, ext]
    s = S - 1 if S == 1 or dp[-1, S - 1] >= dp[-1, S - 2] else S - 2
    path = [0] * T
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(bp[t, s])
    spans = [[None, None] for _ in tokens]
    for t, s in enumerate(path):
        if s % 2 == 1:
            k = s // 2
            if spans[k][0] is None:
                spans[k][0] = t
            spans[k][1] = t + 1
    return [tuple(x) for x in spans]


def edit(a: str, b: str) -> int:
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


class Aligner:
    def __init__(self, model_dir: str):
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        self.torch = torch
        self.proc = Wav2Vec2Processor.from_pretrained(model_dir)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_dir).eval()
        self.vocab = self.proc.tokenizer.get_vocab()
        self.blank = self.proc.tokenizer.pad_token_id
        self.inv = {i: t for t, i in self.vocab.items()}

    def logp(self, audio: np.ndarray) -> tuple[np.ndarray, float]:
        x = self.proc(audio, sampling_rate=SR, return_tensors="pt").input_values
        with self.torch.no_grad():
            lg = self.model(x).logits[0]
        lp = self.torch.log_softmax(lg.float(), -1).numpy()
        return lp, len(audio) / SR / lp.shape[0]   # 프레임당 초

    def greedy(self, lp: np.ndarray) -> str:
        ids = lp.argmax(-1)
        out, prev = [], None
        for i in ids:
            if i != prev and i != self.blank:
                out.append(self.inv[int(i)])
            prev = i
        return "".join(out).replace("|", " ").strip()


def cut(al: Aligner, audio: np.ndarray, text: str, words: list[str],
        pad_pre: float = 0.12, pad_post: float = 0.18) -> list[dict]:
    targets = find_targets(text, words)
    if not targets:
        return []
    sylls = [c for c in re.sub(r"[^\w]", "", text)]
    unk = [c for c in sylls if c not in al.vocab]
    lp, fs = al.logp(audio)
    toks = [al.vocab.get(c, al.vocab["[UNK]"]) for c in sylls]
    if len(toks) > lp.shape[0]:
        return [{"skip": "프레임보다 음절이 많다"}]
    spans = ctc_align(lp, toks, al.blank)
    hyp = al.greedy(lp).replace(" ", "")
    ref = "".join(sylls)
    sent_cer = edit(hyp, ref) / max(len(ref), 1)
    out = []
    for w, a, b in targets:
        s0, s1 = spans[a][0], spans[b - 1][1]
        # 여유: 이웃 음절의 경계를 넘지 않게
        lo = spans[a - 1][1] if a > 0 else 0
        hi = spans[b][0] if b < len(spans) else lp.shape[0]
        t0 = max(lo * fs, s0 * fs - pad_pre, 0.0)
        t1 = min(hi * fs, s1 * fs + pad_post, len(audio) / SR)
        conf = float(np.mean([np.exp(lp[spans[k][0]:spans[k][1], toks[k]]).max() for k in range(a, b)]))
        clip = audio[int(t0 * SR): int(t1 * SR)]
        re_lp, _ = al.logp(clip) if len(clip) > SR // 10 else (None, None)
        reread = al.greedy(re_lp) if re_lp is not None else ""
        out.append({"word": w, "t0": round(t0, 3), "t1": round(t1, 3), "conf": round(conf, 3),
                    "reread": reread, "sent_cer": round(sent_cer, 3), "unk_in_sentence": len(unk), "clip": clip})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", required=True, type=Path, help="train.jsonl (문장 행을 쓴다)")
    ap.add_argument("--words", required=True, type=Path, help="단어 목록 JSON 배열")
    ap.add_argument("--model", default="C:/AI/_work/w2v-ko")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    words = json.load(open(args.words, encoding="utf-8"))
    rows = [json.loads(l) for l in args.split.open(encoding="utf-8") if l.strip()]
    rows = [r for r in rows if r.get("task_type") == "narrative" and find_targets(r["text"], words)]
    if args.limit:
        rows = rows[: args.limit]
    print(f"대상 문장 {len(rows)}개")
    al = Aligner(args.model)
    (args.out_dir / "wav").mkdir(parents=True, exist_ok=True)
    meta = []
    for i, r in enumerate(rows):
        audio, sr = sf.read(args.split.parent / r["audio"], dtype="float32")
        assert sr == SR, sr
        if audio.ndim > 1:
            audio = audio.mean(1)
        for j, c in enumerate(cut(al, audio, r["text"], words)):
            if "skip" in c:
                print("건너뜀:", r["audio"], c["skip"])
                continue
            name = f"{Path(r['audio']).stem}_w{j}.wav"
            spk = r["audio"].split("/")[1]
            rel = f"wav/{spk}/{name}"
            (args.out_dir / "wav" / spk).mkdir(parents=True, exist_ok=True)
            sf.write(args.out_dir / rel, c.pop("clip"), SR)
            meta.append({"audio": rel, "text": c["word"], "task_type": "wordlist", "source": "cut",
                         "parent": r["audio"], "sentence": r["text"], **c})
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(rows)}", flush=True)
    with open(args.out_dir / "cut_segments.jsonl", "w", encoding="utf-8", newline="\n") as f:
        for m in meta:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
    ok = sum(m["reread"].replace(" ", "").startswith(m["text"]) or m["text"] in m["reread"] for m in meta)
    print(f"잘라낸 단어 {len(meta)}개 · 다시 읽혀 단어가 나온 것 {ok}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
