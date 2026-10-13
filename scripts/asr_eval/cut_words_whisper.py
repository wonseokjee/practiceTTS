"""문장 세그먼트에서 앱 단어 구간을 찾는다 — 11차 whisper(LoRA) 정렬 + 재받아쓰기 필터 (TODOS 3b).

대장 「문장에서 단어 잘라내기」의 결론: 범용 정렬기(CTC·원래 whisper)는 구음장애 말을 못
알아들어 둘이 37%만 일치했다. 그래서 이 발화를 알아듣는 11차로 한다.

1. **정렬.** 정답 문장을 teacher forcing으로 넣고 교차 어텐션 DTW로 토큰 시각을 뽑는다
   (openai-whisper `timing.py` 방식, `whisper_word_align.py`와 같다). 인코더는 어텐션을
   돌려받지 않고 따로 돌린다 — 32층 인코더 자기 어텐션을 받으면 GPU 메모리가 터진다.
2. **경계.** 단어의 첫 토큰 시작 ~ 마지막 토큰 끝. 앞뒤 여유는 이웃 토큰 길이의 절반을
   넘지 않는다. 조사가 같은 토큰에 붙어 있으면(`clean=False`) 그대로 두고 3에 맡긴다.
3. **필터.** 잘린 구간만 11차가 다시 받아써 그 단어가 **정확히** 나와야 남긴다.
   대가: 11차도 처음 보는 단어는 맞는 클립의 절반 가까이를 버린다(대장).

**출력은 시각뿐이다.** 클립 오디오는 로컬에서 회수 zip의 세그먼트 wav로 자른다 — 드라이브에
작은 파일 수천 개를 쓰면 FUSE가 끊긴다(VS01 셀 6). 한 줄 = 단어 하나.

토큰↔음절 대응은 토큰마다 따로 디코드하지 않고 **누적 디코드**로 잡는다. 한글 한 음절이
바이트 토큰 둘로 쪼개지면 낱개 디코드는 '�'를 내 음절 위치가 밀린다.
"""
from __future__ import annotations

import re

import numpy as np

from cut_word_segments import find_targets  # noqa: F401  (노트북이 여기서 함께 쓴다)

SR, FRAME = 16000, 0.02
MAX_SEG_SEC = 30.0          # whisper 인코더 창. 넘는 세그먼트는 건너뛴다(잘려서 시각이 틀린다)
PAD_PRE, PAD_POST = 0.10, 0.15
PAD_POST_PARTICLE = 0.05    # 조사가 바로 붙는 단어의 뒤 여유(조사 첫 소리를 덜 담는다)
MIN_CLIP_SEC = 0.15
TRIM_REL = 0.15             # 말소리 문턱 = 세그먼트 RMS 95분위 × 이 값


def norm(s: str) -> str:
    """find_targets와 같은 음절 셈: 문장부호·공백 제거."""
    return re.sub(r"[^\w]", "", s)


def char_spans(prefix_texts: list[str]) -> list[tuple[int, int, int]]:
    """prefix_texts[k] = 본문 토큰 [0..k] 누적 디코드.

    토큰 k마다 (lo, hi, full): [lo, hi)는 이 토큰이 걸친 음절, full은 k까지 **완성된** 음절 수.
    끝이 '�'면 아직 덜 끝난 음절이 있다 — 그 음절을 이 토큰도 덮는 것으로 본다.
    """
    out, prev = [], 0
    for s in prefix_texts:
        partial = s.endswith("�")
        full = len(norm(s.rstrip("�")))
        out.append((prev, max(full, prev + (1 if partial else 0)), full))
        prev = full
    return out


def word_tokens(spans: list[tuple[int, int, int]], a: int, b: int) -> tuple[int, int, bool] | None:
    """음절 [a, b)를 덮는 (첫 토큰, 마지막 토큰, clean). clean = 양끝이 토큰 경계와 맞는다."""
    k0 = next((k for k, (lo, hi, _) in enumerate(spans) if lo <= a < hi), None)
    k1 = next((k for k, (_, _, full) in enumerate(spans) if full >= b), None)
    if k0 is None or k1 is None or k1 < k0:
        return None
    return k0, k1, spans[k0][0] == a and spans[k1][2] == b


def frame_rms(audio: np.ndarray) -> np.ndarray:
    """20ms 프레임 RMS(인코더 프레임과 같은 간격)."""
    n = len(audio) // 320
    f = audio[: n * 320].reshape(n, 320).astype(np.float64)
    return np.sqrt((f ** 2).mean(1) + 1e-12)


def speech_threshold(rms: np.ndarray) -> float:
    """말소리 문턱 = 세그먼트 RMS 95분위의 15%."""
    return float(TRIM_REL * np.percentile(rms, 95)) if len(rms) else 0.0


def energy_adjust(rms: np.ndarray, thr: float, ws: float, we: float, end_limit: float) -> tuple[float, float]:
    """DTW 시각을 소리 에너지로 고친다.

    DTW는 앞 토큰이 끝난 순간을 다음 토큰의 시작으로 잡아 **단어 앞 침묵이 단어에 붙는다**.
    합성 문장(단어 클립을 침묵 사이에 이어 붙여 경계를 아는 문장, 원래 turbo)에서 시작이
    중앙값 0.68초 일렀다. 그래서 [ws, we] 안의 첫 말소리 프레임으로 시작을 당기고, 끝은
    말소리가 이어지는 동안 end_limit(다음 토큰 중간)까지 늘린다. 같은 시험에서 클립이 단어를
    온전히 덮는 비율 82% → 93%, 군더더기 중앙값(여유 0.25초 포함) 0.60 → 0.32초.
    말소리 프레임이 없으면 DTW 시각을 그대로 둔다.
    """
    f0, f1 = int(round(ws / FRAME)), int(round(we / FRAME))
    voiced = [f for f in range(f0, min(f1, len(rms))) if rms[f] >= thr]
    if not voiced:
        return ws, we
    g, lim = f1, min(int(end_limit / FRAME), len(rms))
    while g < lim and rms[g] >= thr:
        g += 1
    return voiced[0] * FRAME, max(we, g * FRAME)


def clip_bounds(ws: float, we: float, prev_start: float, next_end: float, dur: float,
                pad_pre: float = PAD_PRE, pad_post: float = PAD_POST) -> tuple[float, float]:
    """단어 [ws, we]에 여유를 붙인다. 여유는 이웃 토큰 쪽 남은 길이의 절반까지만."""
    t0 = max(0.0, ws - min(pad_pre, max(ws - prev_start, 0.0) / 2))
    t1 = min(dur, we + min(pad_post, max(next_end - we, 0.0) / 2))
    return round(t0, 3), round(t1, 3)


def keep(word: str, hyp: str) -> bool:
    """재받아쓰기가 그 단어와 정확히 같다(문장부호·공백 무시). 조사가 붙어 나오면 버린다."""
    return norm(hyp) == word


def dtw(cost: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """whisper_word_align.dtw와 같다(그 모듈은 soundfile·transformers를 최상단에서 읽어 따로 둔다)."""
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


def times_from_attention(mat: np.ndarray, n_frames: int) -> list[tuple[float, float]]:
    """[본문 토큰, 프레임] 어텐션(표준화·필터 후 헤드 평균) → 토큰별 (시작, 끝) 초. 끝 = 다음 토큰 시작."""
    ti, fi = dtw(-mat.astype(np.float64))
    jumps = np.pad(np.diff(ti), (1, 0), constant_values=1).astype(bool)
    starts = list(fi[jumps] * FRAME)
    bounds = starts + [n_frames * FRAME]
    return [(float(bounds[k]), float(bounds[k + 1])) for k in range(mat.shape[0])]


def attention_matrix(w: np.ndarray, median_filter) -> np.ndarray:
    """정렬 헤드 교차 어텐션 [H, 토큰, 오디오 프레임] → DTW용 [토큰, 프레임]. openai-whisper timing.py와 같다.

    - 확률을 **실제 오디오 프레임 안에서 다시 정규화**한다. timing.py는 잘라낸 뒤 softmax를
      하는데, 잘린 구간으로 확률을 나누는 것이 그것과 정확히 같다(뒤쪽 무음 패딩 몫을 뺀다).
    - 표준화는 **토큰 축(dim=-2)** 으로 한다. 시간 축으로 하면 토큰마다 자기 최댓값 근처만
      남아 DTW가 긴 구간을 한 토큰에 몰아준다 — 파일럿 `whisper_word_align.py`가 이랬다.
    """
    w = w / (w.sum(-1, keepdims=True) + 1e-12)
    w = (w - w.mean(-2, keepdims=True)) / (w.std(-2, keepdims=True) + 1e-8)
    return median_filter(w, (1, 1, 7)).mean(0)


class TokenAligner:
    """teacher forcing + 교차 어텐션 DTW. model은 이미 올린 WhisperForConditionalGeneration(어댑터 병합본)."""

    def __init__(self, model, processor):
        import torch
        from scipy.ndimage import median_filter
        self.torch, self.median_filter = torch, median_filter
        self.model, self.proc = model, processor
        self.heads = [tuple(h) for h in model.generation_config.alignment_heads]
        tok = processor.tokenizer
        self.prefix = [tok.convert_tokens_to_ids(t) for t in
                       ("<|startoftranscript|>", "<|ko|>", "<|transcribe|>", "<|notimestamps|>")]
        self.eot = tok.eos_token_id

    def align(self, audio: np.ndarray, text: str) -> tuple[list[tuple[int, int, int]], list[tuple[float, float]]]:
        torch, tok = self.torch, self.proc.tokenizer
        dev = self.model.device
        feats = self.proc.feature_extractor(audio, sampling_rate=SR, return_tensors="pt").input_features
        body = tok(text, add_special_tokens=False).input_ids
        ids = torch.tensor([self.prefix + body + [self.eot]], device=dev)
        with torch.no_grad():
            enc = self.model.model.encoder(feats.to(dev, self.model.dtype)).last_hidden_state
            out = self.model.model.decoder(input_ids=ids, encoder_hidden_states=enc, output_attentions=True)
        n_frames = min(int(len(audio) / SR / FRAME), 1500)
        w = torch.stack([out.cross_attentions[l][0, h] for l, h in self.heads])   # [H, T, 1500]
        mat = attention_matrix(w[:, :, :n_frames].float().cpu().numpy(), self.median_filter)
        mat = mat[len(self.prefix) - 1: -1]           # 본문 토큰을 "예측하는" 위치 = 이전 토큰 위치
        times = times_from_attention(mat, n_frames)
        spans = char_spans([tok.decode(body[:k + 1]) for k in range(len(body))])
        return spans, times


def eojeol_ends(text: str) -> set[int]:
    """어절이 끝나는 음절 위치(find_targets와 같은 셈). 단어 끝이 여기 없으면 조사가 붙어 있다."""
    ends, pos = set(), 0
    for tok in re.sub(r"[^\w\s]", " ", text).split():
        pos += len(tok)
        ends.add(pos)
    return ends


def plan_rows(rows: list[dict], words: list[str]) -> tuple[list[dict], dict]:
    """정렬할 세그먼트(문장·앱 단어 있음·30초 이하)와 건너뛴 이유별 개수."""
    keep_rows, skipped = [], {"wordlist": 0, "no_app_word": 0, "too_long": 0}
    for r in rows:
        if r.get("task_type") != "narrative":
            skipped["wordlist"] += 1
        elif not find_targets(r["reference_text"], words):
            skipped["no_app_word"] += 1
        elif r["end"] - r["start"] > MAX_SEG_SEC:
            skipped["too_long"] += 1
        else:
            keep_rows.append(r)
    return keep_rows, skipped


def cut_one(aligner: TokenAligner, audio: np.ndarray, row: dict, words: list[str]) -> list[dict]:
    """세그먼트 하나 → 단어별 후보(시각만). 재받아쓰기는 노트북이 묶어서 한다."""
    text = row["reference_text"]
    dur = len(audio) / SR
    spans, times = aligner.align(audio, text)
    rms = frame_rms(audio)
    thr = speech_threshold(rms)
    ends = eojeol_ends(text)
    out = []
    for j, (w, a, b) in enumerate(find_targets(text, words)):
        kk = word_tokens(spans, a, b)
        base = {"segment": row["segment_wav_relpath"], "parent": row["parent_file_id"],
                "word": w, "occ": j, "sentence": text}
        if kk is None:
            out.append({**base, "skip": "token_map"})
            continue
        k0, k1, clean = kk
        prev_start = times[k0 - 1][0] if k0 > 0 else 0.0
        next_end = times[k1 + 1][1] if k1 + 1 < len(times) else dur
        # 조사가 붙으면(사탕과) 단어와 조사 사이에 쉼이 없다 — 끝을 "말소리가 이어지는 동안" 늘리면
        # 조사를 삼킨다(로컬 스모크: 나비→"나비가", 텔레비전→"텔레비인을"). 그때는 끝을 늘리지 않고
        # 뒤 여유도 줄인다. 합성 시험은 단어 사이에 침묵이 있어 이 경우를 못 본다.
        particle = b not in ends
        end_limit = times[k1][1] if particle else (times[k1][1] + next_end) / 2
        ws, we = energy_adjust(rms, thr, times[k0][0], times[k1][1], end_limit)
        t0, t1 = clip_bounds(ws, we, prev_start, next_end, dur,
                             pad_post=PAD_POST_PARTICLE if particle else PAD_POST)
        if t1 - t0 < MIN_CLIP_SEC:
            out.append({**base, "skip": "too_short", "t0": t0, "t1": t1})
            continue
        out.append({**base, "t0": t0, "t1": t1, "clean": clean, "particle": particle})
    return out


def speech_extent(audio: np.ndarray) -> tuple[float, float]:
    """클립에서 실제 말소리가 난 [시작, 끝] 초 — 합성 시험의 정답 경계."""
    rms = frame_rms(audio)
    idx = np.where(rms >= speech_threshold(rms))[0]
    return (float(idx[0] * FRAME), float((idx[-1] + 1) * FRAME)) if len(idx) else (0.0, len(audio) / SR)


def synthetic_check(aligner: TokenAligner, clips: list[tuple[np.ndarray, str]], n_sent: int = 12,
                    per: int = 5, seed: int = 1, tol: float = 0.03) -> dict:
    """경계를 아는 합성 문장으로 잘라내기 경로 전체(정렬·에너지 보정·여유)를 잰다.

    단어 하나짜리 클립 `per`개를 0.05~0.5초 침묵 사이에 이어 붙인다. 정답은 각 클립의 말소리
    구간이다. 잘린 [t0, t1]이 정답을 (tol 안에서) 온전히 덮는 비율과 군더더기(여유 포함) 중앙값.
    실제 문장은 단어 사이 침묵이 짧아 이 시험보다 쉽거나 어렵다 — 경로가 망가지지 않았는지
    보는 관문이지 품질 추정치가 아니다.
    """
    import random
    rng = random.Random(seed)
    covered, extra = [], []
    for _ in range(n_sent):
        pick = rng.sample(clips, per)
        parts, truth, pos = [], [], 0.0
        for audio, word in pick:
            gap = np.zeros(int(SR * rng.uniform(0.05, 0.5)), np.float32)
            parts += [gap, audio]
            pos += len(gap) / SR
            s, e = speech_extent(audio)
            truth.append((word, pos + s, pos + e))
            pos += len(audio) / SR
        audio = np.concatenate(parts + [np.zeros(SR // 4, np.float32)])
        dur = len(audio) / SR
        spans, times = aligner.align(audio, " ".join(w for _, w in pick))
        rms = frame_rms(audio)
        thr = speech_threshold(rms)
        a = 0
        for word, s, e in truth:
            b = a + len(norm(word))
            kk = word_tokens(spans, a, b)
            a = b
            if kk is None:
                covered.append(False)
                continue
            k0, k1, _ = kk
            prev_start = times[k0 - 1][0] if k0 > 0 else 0.0
            next_end = times[k1 + 1][1] if k1 + 1 < len(times) else dur
            ws, we = energy_adjust(rms, thr, times[k0][0], times[k1][1], (times[k1][1] + next_end) / 2)
            t0, t1 = clip_bounds(ws, we, prev_start, next_end, dur)
            covered.append(t0 <= s + tol and t1 >= e - tol)
            extra.append(max(0.0, s - t0) + max(0.0, t1 - e))
    return {"n": len(covered), "covered": float(np.mean(covered)),
            "extra_median": float(np.median(extra)) if extra else None}
