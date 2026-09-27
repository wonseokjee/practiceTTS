"""두 번째 정렬기 — whisper에 정답 문장을 teacher forcing으로 넣고 교차 어텐션 DTW로 단어 시각을 뽑는다.

CTC 정렬(cut_word_segments.py)과 독립적인 방법이다. 두 정렬기가 같은 경계를 내면 그 클립은
믿을 만하다고 보고, 어긋나면 의심한다 — 사람 청취 없이 쓸 수 있는 품질 신호다.
(openai-whisper `timing.py`의 방식: 정렬 헤드 어텐션 → 시간축 표준화 → 중앙값 필터 → DTW)
"""
from __future__ import annotations

import json
import sys

import numpy as np
import soundfile as sf
import torch
from scipy.ndimage import median_filter
from transformers import WhisperForConditionalGeneration, WhisperProcessor

sys.stdout.reconfigure(encoding="utf-8")
SR, FRAME = 16000, 0.02     # 인코더 출력 프레임 = 20ms


def dtw(cost: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    N, M = cost.shape
    D = np.full((N + 1, M + 1), np.inf)
    D[0, 0] = 0
    tr = np.zeros((N + 1, M + 1), dtype=np.int8)
    for i in range(1, N + 1):
        for j in range(1, M + 1):
            c = (D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
            k = int(np.argmin(c))
            D[i, j] = cost[i - 1, j - 1] + c[k]
            tr[i, j] = k
    i, j, path = N, M, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        k = tr[i, j]
        if k == 0:
            i, j = i - 1, j - 1
        elif k == 1:
            i -= 1
        else:
            j -= 1
    path.reverse()
    p = np.array(path)
    return p[:, 0], p[:, 1]


class WhisperAligner:
    def __init__(self, model_dir: str):
        self.proc = WhisperProcessor.from_pretrained(model_dir, language="ko", task="transcribe")
        self.model = WhisperForConditionalGeneration.from_pretrained(
            model_dir, dtype=torch.float32, attn_implementation="eager").eval()
        heads = self.model.generation_config.alignment_heads
        self.heads = [tuple(h) for h in heads]
        tok = self.proc.tokenizer
        self.prefix = [tok.convert_tokens_to_ids(t) for t in
                       ("<|startoftranscript|>", "<|ko|>", "<|transcribe|>", "<|notimestamps|>")]
        self.eot = tok.eos_token_id

    def token_times(self, audio: np.ndarray, text: str) -> list[tuple[str, float, float]]:
        """문장 토큰별 (토큰 문자열, 시작, 끝) 초."""
        tok = self.proc.tokenizer
        feats = self.proc.feature_extractor(audio, sampling_rate=SR, return_tensors="pt").input_features
        body = tok(text, add_special_tokens=False).input_ids
        ids = torch.tensor([self.prefix + body + [self.eot]])
        with torch.no_grad():
            out = self.model(input_features=feats, decoder_input_ids=ids, output_attentions=True)
        n_frames = int(len(audio) / SR / FRAME)
        w = torch.stack([out.cross_attentions[l][0, h] for l, h in self.heads])   # [H, T_tok, 1500]
        w = w[:, :, :n_frames].float()
        w = (w - w.mean(-1, keepdim=True)) / (w.std(-1, keepdim=True) + 1e-8)
        w = torch.from_numpy(median_filter(w.numpy(), (1, 1, 7)))
        mat = w.mean(0)[len(self.prefix) - 1: -1]     # 텍스트 토큰을 "예측하는" 위치 = 이전 토큰 위치
        ti, fi = dtw(-mat.double().numpy())
        jumps = np.pad(np.diff(ti), (1, 0), constant_values=1).astype(bool)
        starts = fi[jumps] * FRAME
        times = list(starts) + [n_frames * FRAME]
        pieces = [tok.decode([t]) for t in body]
        return [(pieces[k], float(times[k]), float(times[k + 1])) for k in range(len(body))]


def word_span(tt: list[tuple[str, float, float]], text: str, a: int, b: int) -> tuple[float, float, bool]:
    """공백 뺀 음절 위치 [a, b)의 시각. 경계가 토큰 한가운데면 clean=False."""
    pos, start, end, clean = 0, None, None, True
    for piece, t0, t1 in tt:
        s = piece.replace(" ", "")
        n = len(s)
        if n == 0:
            continue
        lo, hi = pos, pos + n
        if start is None and hi > a:
            start = t0
            clean &= lo == a
        if hi >= b and end is None:
            end = t1
            clean &= hi == b
        pos = hi
    return start, end, clean


if __name__ == "__main__":
    sys.path.insert(0, "C:/AI/practiveTTS/scripts/asr_eval")
    import cut_word_segments as C
    PKG = "C:/Users/wsji9/Downloads/608-audio-work/colab_trainset_big7_vochold/"
    cuts = [json.loads(l) for l in open("C:/AI/_work/cut_pilot/cut_segments.jsonl", encoding="utf-8")]
    al = WhisperAligner("C:/AI/_work/whisper-turbo")
    cache = {}
    out = []
    for i, c in enumerate(cuts):
        key = c["parent"]
        if key not in cache:
            audio, _ = sf.read(PKG + key, dtype="float32")
            cache[key] = al.token_times(audio, c["sentence"])
        tt = cache[key]
        # 같은 문장에 같은 단어가 여러 번이면 순서대로 짝짓는다
        targets = [t for t in C.find_targets(c["sentence"], [c["text"]])]
        k = int(c["audio"].rsplit("_w", 1)[1].split(".")[0])
        allt = C.find_targets(c["sentence"], json.load(open("C:/Users/wsji9/.claude/jobs/99243c19/tmp/pilot_words.json", encoding="utf-8")))
        w, a, b = allt[k]
        ws, we, clean = word_span(tt, c["sentence"], a, b)
        # CTC 쪽 경계(여유 빼기 전은 저장 안 했으므로 잘린 구간 자체와 비교)
        d0, d1 = abs(ws - c["t0"]), abs(we - c["t1"])
        out.append({**{k2: c[k2] for k2 in ("audio", "text", "t0", "t1", "conf", "sent_cer")},
                    "w_t0": round(ws, 3), "w_t1": round(we, 3), "clean_token_boundary": clean,
                    "d_start": round(d0, 3), "d_end": round(d1, 3)})
        if (i + 1) % 10 == 0:
            print(f"{i + 1}/{len(cuts)}", flush=True)
    with open("C:/AI/_work/cut_pilot/agreement.jsonl", "w", encoding="utf-8") as f:
        for o in out:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    print("done", len(out))
