"""경쟁자 채점 서비스 — 이웃 비교 채점의 서버 쪽 절반.

설계: docs/history/20260926_NeighborScoring_design.md (팔 C), 계획 PR 2.

같은 녹음을 **목표**뿐 아니라 **경쟁자**(소리가 가까운 다른 단어, 그리고 후보 없이 인식한
결과)를 참조로도 채점해 점수를 돌려준다. **판정은 여기서 하지 않는다** — 정답/모호/오답은
프론트 도메인(`pronunciationScore.ts`)이 정한다. 이 서비스는 점수만 낸다.

흐름(왕복 두 번, 각 단계는 병렬):

    1차   PA(목표) ‖ STT(후보 없이)
          목표가 정답선 미만이거나 인식 실패면 여기서 끝 — 어차피 오답이라 비교할 것이 없다
    2차   PA(이웃 각각) ‖ PA(STT 전사)

**STT는 반드시 후보(phrase hint) 없이 부른다.** 앱의 `/stt` 폴백은 목표를 후보로 넣어
인식을 목표 쪽으로 당기는데, 경쟁자 생성에는 그게 해롭다 — 환자가 다른 단어를 말했는데도
전사가 목표로 나오면 경쟁자가 사라진다(철회한 제한 디코딩과 같은 실패).

경쟁자 호출이 실패해도 전체를 실패시키지 않는다. 그 경쟁자를 `status="error"`로 싣고
판정은 프론트가 채점 불가로 보낸다 — **목표 점수만으로 채점하지 않는다**(폴백 금지 원칙).
목표 채점 자체가 실패하면 예전처럼 예외를 그대로 올린다(라우터가 502).
"""
import re
import unicodedata
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

from models.pronunciation import CompetitorAssessment, CompetitorScore
from services.pronunciation_service import PronunciationService
from services.stt_service import SttService

# 목표 accuracy가 이 값 미만이면 경쟁자를 부르지 않는다. 프론트의 정답선
# (`pronunciationScore.ts`의 AZURE_GRADE_THRESHOLDS.good — 단어는 accuracy 그대로)과
# **같아야** 한다. 이 값이 프론트보다 낮으면 프론트가 정답 후보로 보는 목표에서 경쟁자를
# 안 부르게 되어 판정이 채점 불가로 샌다. `test_competitor_service.py`가 두 값을 대조한다.
COMPETITOR_SKIP_BELOW = 60.0

MAX_COMPETITORS = 5
# 한 요청에서 동시에 나가는 Azure 호출의 상한(이웃 5 + STT 전사 1). 목표·STT는 1차에서 나간다.
_MAX_WORKERS = MAX_COMPETITORS + 1


def normalize(text: str | None) -> str:
    """비교용 정규화 — NFC, 문장부호 제거, 공백 정리. 0단계 실측(azure_neighbor_eval)과 같다."""
    t = unicodedata.normalize("NFC", text or "")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def compact(text: str | None) -> str:
    """공백까지 없앤 비교 키."""
    return normalize(text).replace(" ", "")


def max_azure_calls(n_competitors: int, want_stt: bool) -> int:
    """이 요청이 낼 수 있는 Azure 호출의 최대 수 — 속도 제한기가 이 값으로 차감한다.

    목표 1 + 이웃 n + (STT 1 + STT 전사 채점 1). 목표가 정답선 미만이면 실제로는 더 적게
    나가지만 환급하지 않는다(보수적).
    """
    return 1 + n_competitors + (2 if want_stt else 0)


class CompetitorService:
    """목표 + 경쟁자 채점. 엔진은 주입받은 서비스 뒤에 있다(엔진 교체에 영향 없음)."""

    def __init__(
        self,
        pronunciation: PronunciationService,
        stt_provider: Callable[[], SttService],
    ) -> None:
        self._pron = pronunciation
        # 지연 생성 — STT를 안 쓰는 요청이 STT 설정 누락에 영향받지 않게 한다.
        self._stt_provider = stt_provider

    def assess(
        self,
        wav_bytes: bytes,
        reference_text: str,
        lang: str,
        competitors: list[str],
        want_stt: bool,
    ) -> CompetitorAssessment:
        if len(competitors) > MAX_COMPETITORS:
            raise ValueError(f"competitors는 최대 {MAX_COMPETITORS}개다.")
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            f_target = pool.submit(self._pron.assess, wav_bytes, reference_text, lang)
            f_stt = pool.submit(self._recognize, wav_bytes, lang) if want_stt else None

            target = f_target.result()   # 실패는 그대로 올린다 → 라우터가 502
            stt_transcript, stt_status = self._collect_stt(f_stt)

            skipped = None
            if not (target.recognized_text or "").strip():
                skipped = "no_match"
            elif target.accuracy_score < COMPETITOR_SKIP_BELOW:
                skipped = "target_below_pass"
            if skipped:
                return CompetitorAssessment(
                    target=target, competitors=None, stt_transcript=stt_transcript,
                    stt_status=stt_status, skipped_reason=skipped,
                )

            # ── 2차: 이웃 각각 + STT 전사 ──
            target_key = compact(reference_text)
            neighbor_keys = {compact(c) for c in competitors}
            stt_text = normalize(stt_transcript) if stt_status == "ok" else ""
            stt_usable = bool(stt_text) and compact(stt_text) != target_key

            jobs: list[tuple[str, str, Future | None]] = []   # (text, source, future)
            for c in competitors:
                jobs.append((c, "neighbor", pool.submit(self._score, wav_bytes, c, lang)))
            stt_dup_of: int | None = None
            if stt_usable:
                if compact(stt_text) in neighbor_keys:
                    # 전사가 이웃 하나와 같다 — 같은 점수를 다시 매기지 않고 그 결과를 재사용한다
                    stt_dup_of = next(i for i, (t, _, _) in enumerate(jobs)
                                      if compact(t) == compact(stt_text))
                else:
                    jobs.append((stt_text, "stt", pool.submit(self._score, wav_bytes, stt_text, lang)))

            scores = [self._result(text, source, fut) for text, source, fut in jobs]
            if stt_dup_of is not None:
                dup = scores[stt_dup_of]
                scores.append(CompetitorScore(
                    text=stt_text, source="stt", accuracy_score=dup.accuracy_score,
                    recognized_text=dup.recognized_text, status=dup.status,
                ))
            return CompetitorAssessment(
                target=target, competitors=scores, stt_transcript=stt_transcript,
                stt_status=stt_status, skipped_reason=None,
            )

    # ── 내부 ────────────────────────────────────────────────

    def _recognize(self, wav_bytes: bytes, lang: str):
        # candidates=[] — 후보 없는 자유 인식(모듈 머리말 참고)
        return self._stt_provider().recognize(wav_bytes, lang, [])

    @staticmethod
    def _collect_stt(f_stt: Future | None) -> tuple[str | None, str | None]:
        if f_stt is None:
            return None, None
        try:
            result = f_stt.result()
        except Exception:  # noqa: BLE001 - 인식 실패는 경쟁자를 못 만드는 것일 뿐이다
            return None, "error"
        transcript = (result.transcript or "").strip()
        return (transcript, "ok") if normalize(transcript) else (transcript or None, "empty")

    def _score(self, wav_bytes: bytes, text: str, lang: str):
        return self._pron.assess(wav_bytes, text, lang)

    @staticmethod
    def _result(text: str, source: str, fut: Future) -> CompetitorScore:
        try:
            r = fut.result()
        except Exception:  # noqa: BLE001 - 이 경쟁자만 못 쟀다 → 프론트가 채점 불가로 보낸다
            return CompetitorScore(text=text, source=source, accuracy_score=0.0,
                                   recognized_text="", status="error")
        if not (r.recognized_text or "").strip():
            return CompetitorScore(text=text, source=source, accuracy_score=0.0,
                                   recognized_text="", status="no_match")
        return CompetitorScore(text=text, source=source, accuracy_score=r.accuracy_score,
                               recognized_text=r.recognized_text, status="ok")
