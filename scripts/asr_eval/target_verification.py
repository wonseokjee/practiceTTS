"""목표 단어 검증 — 받아쓰기 대신 "이 소리가 목표 단어인가"를 점수로 매긴다.

설계와 판정 규칙: 대장 `608-finetune-log.md` 「목표 단어 검증 — 설계」(사전 등록).

**점수.** 같은 녹음에 대해 목표 단어와 자유 받아쓰기 결과(모델이 스스로 적은 것)를 각각
teacher forcing으로 채점해, 토큰당 평균 로그 확률의 차이를 본다.

    s = lp(목표) − lp(자유 받아쓰기)        lp = 텍스트 토큰(+끝 토큰)의 평균 log p

자유 받아쓰기가 목표와 같으면 s = 0이다. 다른 단어가 훨씬 그럴듯하면 s가 크게 음수다.
`s ≥ τ`이면 통과다. 철회한 제한 디코딩(출력을 목표로 강제)과 달리 출력을 강제하지 않는다 —
그래서 "틀리게 말해도 통과"가 문턱 τ로 조절되고 오통과율로 잴 수 있다.

**왜 기대하나.** 12차의 오답 절반은 "풍선→방선", "신발→전발"처럼 소리를 가깝게 받아썼지만
철자를 모르는 경우였다(대장 「12차 결과」 사후 관찰 ②). 이런 녹음은 목표로 채점하면 lp가
높게 나올 수 있다.

**라벨 모양은 transformers 버전을 따른다.** Colab(5.15.1)의 `tokenizer(text).input_ids`는
`<|startoftranscript|><|ko|><|transcribe|><|notimestamps|>…<|endoftext|>`이고 로컬 4.57.6은
언어·과제 토큰을 빼먹는다. 학습 라벨도 같은 호출로 만들었으므로 `label_ids`는 그 환경의 학습
라벨을 그대로 재현하고, 접두 길이는 `prefix_len`이 환경마다 잰다(Colab 3, 로컬 1).

이 모듈의 계산 함수(`sequence_logprobs`)는 모델·프로세서를 받는 순수 함수라 로컬 CPU에서
작은 whisper로 검증한다(`test_target_verification.py`). Colab 노트북은 이 파일을 불러 쓴다.
"""
from __future__ import annotations

import math
import random
import re
import unicodedata
from typing import Callable, Iterable, Sequence

# 사전 등록(대장 「목표 단어 검증 — 설계」): dev에서 근접 foil 오통과율이 이 값 이하가 되는
# 가장 너그러운 τ를 고르고, test에서 판정한다.
FA_TARGET = 0.05
FA_HOLD = 0.10
BOOT_B, BOOT_SEED = 1000, 42


def norm(text: str | None) -> str:
    """비교용 정규화 — NFC·문장부호 제거·공백 제거."""
    t = unicodedata.normalize("NFC", text or "")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", "", t)


# ─── 채점 (모델이 필요한 부분) ────────────────────────────────────


def label_ids(processor, text: str) -> list[int]:
    """학습과 같은 라벨 토큰열 — `tokenizer(text).input_ids`에서 시작 토큰을 뗀 것.

    학습 노트북의 콜레이터가 첫 토큰이 `<|startoftranscript|>`면 떼고 모델이 그걸 decoder_start로
    다시 붙인다. 같은 모양이어야 학습 때 본 분포로 채점한다.
    """
    ids = processor.tokenizer(text).input_ids
    start = processor.tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
    return ids[1:] if ids and ids[0] == start else ids


def prefix_len(processor) -> int:
    """라벨 앞의 고정 접두(언어·과제·타임스탬프 없음) 토큰 수. 후보끼리 같아서 평균에서 뺀다."""
    return len(label_ids(processor, "")) - 1   # 빈 텍스트의 라벨 = 접두 + 끝 토큰


def sequence_logprobs(model, processor, input_features, texts: Sequence[str],
                      device: str | None = None) -> list[float]:
    """한 녹음(input_features, [n_mels, frames])에 대해 각 텍스트의 토큰당 평균 log p.

    인코더는 한 번만 돌리고 디코더만 후보 수만큼 돌린다. 평균은 접두 뒤(텍스트 토큰 + 끝 토큰)에서만
    낸다 — 접두는 모든 후보에 같아서 넣으면 짧은 후보가 유리해진다.
    """
    import torch

    # 입력은 모델이 있는 장치로 보낸다. 인자로 준 장치와 모델 장치가 다르면 조용히 옮기지 않고 멈춘다.
    model_device = next(model.parameters()).device
    if device is not None and torch.device(device).type != model_device.type:
        raise ValueError(f"모델은 {model_device}에 있는데 device={device}가 주어졌다 — model.to(...)를 먼저 하라")
    device = model_device

    labels = [label_ids(processor, t) for t in texts]
    skip = prefix_len(processor)
    pad = processor.tokenizer.pad_token_id
    width = max(len(l) for l in labels)
    lab = torch.full((len(texts), width), -100, dtype=torch.long)
    for i, l in enumerate(labels):
        lab[i, : len(l)] = torch.tensor(l)

    feats = torch.as_tensor(input_features).unsqueeze(0).to(device)
    dtype = next(model.parameters()).dtype
    with torch.no_grad():
        enc = model.get_encoder()(feats.to(dtype)).last_hidden_state
        enc = enc.expand(len(texts), -1, -1)
        dec_in = lab.clone()
        dec_in[dec_in == -100] = pad
        start = model.config.decoder_start_token_id
        dec_in = torch.cat([torch.full((len(texts), 1), start), dec_in[:, :-1]], dim=1)
        out = model(encoder_outputs=(enc,), decoder_input_ids=dec_in.to(device))
        logp = torch.log_softmax(out.logits.float(), dim=-1).cpu()

    scores = []
    for i, l in enumerate(labels):
        tok = torch.tensor(l)
        lp = logp[i, torch.arange(len(l)), tok]
        body = lp[skip:]
        scores.append(float(body.mean()) if len(body) else float("-inf"))
    return scores


# ─── 판정 (모델이 필요 없는 부분) ─────────────────────────────────


def margin(lp_target: float, lp_hyp: float) -> float:
    return lp_target - lp_hyp


def choose_tau(neg_scores: Sequence[float], fa_max: float = FA_TARGET) -> float:
    """음성(foil) 오통과율이 fa_max 이하가 되는 가장 너그러운(낮은) τ.

    통과 조건은 `s ≥ τ`다. 음성 점수를 내림차순으로 놓고 허용 개수 k = ⌊fa_max·N⌋ 개까지만
    통과시키는 경계 — (k+1)번째로 높은 음성 점수보다 바로 위 — 를 고른다. 동점은 통과로 보므로
    경계를 그 점수의 바로 위로 둔다.
    """
    neg = sorted(neg_scores, reverse=True)
    if not neg:
        return float("-inf")
    k = math.floor(fa_max * len(neg) + 1e-9)
    if k >= len(neg):
        return float("-inf")
    return math.nextafter(neg[k], math.inf)


def rates(pos: Sequence[float], neg: Sequence[float], tau: float) -> tuple[float, float]:
    """(오판정률 FR, 오통과율 FA). FR = 양성 중 s < τ, FA = 음성 중 s ≥ τ."""
    fr = sum(s < tau for s in pos) / len(pos) if pos else float("nan")
    fa = sum(s >= tau for s in neg) / len(neg) if neg else float("nan")
    return fr, fa


def word_bootstrap(items: Sequence[dict], stat: Callable[[list[dict]], float],
                   b: int = BOOT_B, seed: int = BOOT_SEED) -> tuple[float, float]:
    """단어 단위 복원 추출 95% 구간. items는 "word" 키가 있는 dict."""
    by: dict[str, list[dict]] = {}
    for it in items:
        by.setdefault(it["word"], []).append(it)
    words = sorted(by)
    rng = random.Random(seed)
    vals = []
    for _ in range(b):
        sample = [x for w in (rng.choice(words) for _ in words) for x in by[w]]
        v = stat(sample)
        if not math.isnan(v):
            vals.append(v)
    vals.sort()
    if not vals:
        return float("nan"), float("nan")
    return vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))]


def verdict(test_fa: float, test_fr: float, baseline_fr: float | None) -> str:
    """사전 등록 판정. baseline_fr = 같은 test 행에서 현행 채점기(Azure)의 오판정률."""
    if baseline_fr is None:
        fr_part = "오판정 비교 대기(같은 행의 Azure 오판정률이 아직 없다)"
    elif test_fr < baseline_fr:
        fr_part = f"오판정 {test_fr:.1%} < 현행 {baseline_fr:.1%}"
    else:
        return f"기각 — 오판정 {test_fr:.1%} ≥ 현행 {baseline_fr:.1%}"
    if test_fa <= FA_TARGET:
        return f"채택 — 오통과 {test_fa:.1%} ≤ {FA_TARGET:.0%} · {fr_part}"
    if test_fa <= FA_HOLD:
        return f"보류 — 오통과 {test_fa:.1%} ({FA_TARGET:.0%}~{FA_HOLD:.0%}) · {fr_part}"
    return f"기각 — 오통과 {test_fa:.1%} > {FA_HOLD:.0%} · {fr_part}"


def split_scored(rows: Iterable[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """채점된 행 → (양성, 음성, 참고) 목록. 각 항목: {word, orig_split, kind, s}.

    음성 = 오통과로 세는 foil(`counts`, 음운·의미 근접). 참고 = 음소 착어·무작위 —
    τ 고르기와 판정에 안 쓰고 종류별로 따로 보고만 한다(설계 「평가 대상과 판정 규칙」).
    """
    pos, neg, ref = [], [], []
    for r in rows:
        for c in r["candidates"]:
            item = {"word": r["word"], "orig_split": r["orig_split"], "kind": c["kind"], "s": c["s"]}
            if c["kind"] == "target":
                pos.append(item)
            else:
                (neg if c["counts"] else ref).append(item)
    return pos, neg, ref


# ─── 사례 구성 ────────────────────────────────────────────────────


def build_cases(holdout_rows: Sequence[dict], foils: dict[str, dict],
                accepted: Callable[[str, str], bool],
                fair_splits: Iterable[str] = ("dev", "test")) -> list[dict]:
    """홀드아웃 행 → 채점 사례. 공정 행(원래 dev·test)만 쓴다.

    - 양성: 목표 = 그 녹음의 단어
    - foil: 목표 = 바꿔치기 단어. `counts`는 오통과로 세는가(`counts_for_fa` — 음운·의미 근접,
      즉 다른 실제 단어). 음소 착어·무작위는 `counts=False`로 넣어 따로 보고만 한다.
      정답으로 보는 변형(`accepted(said, target)` — 부분 명칭 등, 사용자 결정 2026-09-26)은 빼는데,
      그건 오류가 아니라서다. 이웃 비교 0단계와 같은 정의다.

    `row`는 holdout_eval.jsonl의 행 번호다 — 평가 노트북의 예측 파일(`row` 키)과 맞대는 열쇠다.
    """
    fair = set(fair_splits)
    cases = []
    for i, r in enumerate(holdout_rows):
        if r["orig_split"] not in fair:
            continue
        word = r["text"].strip()
        cands = [{"text": word, "kind": "target", "counts": False}]
        for f in foils[word]["foils"]:
            if not accepted(word, f["foil"]):
                cands.append({"text": f["foil"], "kind": f["kind"], "counts": f["counts_for_fa"]})
        cases.append({"row": i, "word": word, "orig_split": r["orig_split"],
                      "audio": r["audio"], "candidates": cands})
    return cases
