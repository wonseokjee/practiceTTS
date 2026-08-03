"""개인화 적응기(Adapter) — personalization_curve가 소비하는 교체 가능한 백엔드.

`adapt_and_eval(adapt, holdout, minutes) -> CER|None` 하나만 구현하면 커브에 꽂힌다.
적응(adapt) 발화로 화자에 맞추고, 홀드아웃(holdout)에서 CER을 재 돌려준다.
adapt와 holdout은 절대 겹치지 않는다(curve가 보장).

제공 구현:
  - PromptBiasingAdapter : **학습 불필요.** whisper `initial_prompt`에 그 화자의
      적응 전사를 넣어 디코딩을 그 도메인/발음 어휘 쪽으로 편향시킨다. GPU·파인튜닝
      없이 오늘 바로 되는 1차 개인화. 오디오는 필요.
  - FinetuneAdapter     : LoRA/파인튜닝 스캐폴드. 실제 학습 루프를 끼우는 자리.
  - SimAdapter          : 오디오 없이 커브 형태만 보는 가상(→ personalization_curve.simulated_adapter).

프롬프트 구성 로직은 오디오와 무관해 순수 함수로 분리(테스트 대상).
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Protocol

sys.path.insert(0, str(Path(__file__).parent))
import metrics as M  # noqa: E402


class Adapter(Protocol):
    """개인화 적응기 인터페이스."""

    def adapt_and_eval(
        self, adapt: list[dict], holdout: list[dict], minutes: float
    ) -> float | None:
        ...


# ─── 프롬프트 바이어싱(학습 불필요) ────────────────────────────────

# whisper initial_prompt는 길수록 앞이 잘린다. 최근 컨텍스트(~224토큰)만 반영되므로
# 적응 전사를 이 상한 글자수로 자른다(대략치, 한국어는 토큰당 글자수가 작음).
_PROMPT_CHAR_BUDGET = 480


def build_bias_prompt(adapt: list[dict], *, char_budget: int = _PROMPT_CHAR_BUDGET) -> str:
    """적응 발화들의 정답 전사를 이어붙여 whisper initial_prompt를 만든다.

    최신(뒤쪽) 전사를 우선 채운다 — whisper가 프롬프트 뒷부분을 더 강하게 반영하기
    때문. 예산을 넘으면 앞을 버린다. 공백은 한 칸으로 축약.
    """
    texts = [str(r.get("transcript", "")).strip() for r in adapt if r.get("transcript")]
    prompt = ""
    for t in reversed(texts):  # 뒤에서부터 채워 최신 것을 살린다
        candidate = (t + " " + prompt).strip() if prompt else t
        if len(candidate) > char_budget:
            break
        prompt = candidate
    return M.normalize(prompt, drop_punct=False)


class PromptBiasingAdapter:
    """whisper initial_prompt 편향 개인화. 학습 없이 화자 어휘로 디코딩을 유도.

    recognize(audio_path, initial_prompt) -> 전사  콜러블을 주입한다.
    resolve_audio(row) -> Path|None 로 발화 오디오를 찾는다(없으면 그 발화는 건너뜀).
    """

    def __init__(
        self,
        recognize: Callable[[Path, str], str],
        resolve_audio: Callable[[dict], Path | None],
    ):
        self._recognize = recognize
        self._resolve = resolve_audio

    def adapt_and_eval(
        self, adapt: list[dict], holdout: list[dict], minutes: float
    ) -> float | None:
        if not holdout:
            return None
        prompt = build_bias_prompt(adapt) if minutes > 0 else ""
        total = M.ErrorStat(0, 0)
        scored = 0
        for r in holdout:
            ref = str(r.get("transcript", "")).strip()
            if not ref:
                continue
            audio = self._resolve(r)
            if audio is None:
                continue
            hyp = self._recognize(audio, prompt)
            total = total + M.cer_stat(hyp, ref)
            scored += 1
        return total.rate if scored else None


# ─── LoRA/파인튜닝 스캐폴드 ────────────────────────────────────────


class FinetuneAdapter:
    """화자별 경량 파인튜닝(LoRA 등) 적응기 — 실제 학습 루프를 끼우는 자리.

    설계 메모(구현 시):
      1. adapt 발화(오디오+전사)로 작은 학습셋을 만든다.
      2. 베이스 whisper에 LoRA 어댑터를 얹어(peft) 소수 스텝 학습.
      3. holdout 오디오를 그 어댑터로 인식 → CER.
      4. 어댑터 가중치는 화자별로 캐시(재사용). 누수 방지: adapt만 학습, holdout은 평가만.

    학습 인프라(GPU/peft/torch)가 필요해 여기서는 명시적으로 미구현으로 둔다.
    프롬프트 바이어싱(PromptBiasingAdapter)이 학습 없는 1차 대안이다.
    """

    def adapt_and_eval(
        self, adapt: list[dict], holdout: list[dict], minutes: float
    ) -> float | None:
        raise NotImplementedError(
            "LoRA/파인튜닝 적응기는 학습 백엔드(peft+torch+GPU)가 필요합니다. "
            "학습 없는 개인화는 PromptBiasingAdapter를 쓰세요."
        )
