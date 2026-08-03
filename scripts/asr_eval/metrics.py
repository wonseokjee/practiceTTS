"""ASR 평가 지표 — CER/WER (한국어 기본은 CER).

베이스라인/개인화 실측의 채점 코어. 오디오 없이도 (가설, 정답) 쌍만으로
단위 테스트가 되도록 순수 함수로 둔다.

- CER (Character Error Rate): 편집거리 / 정답 글자수. 한국어 낭독 채점의 표준.
- WER (Word Error Rate): 공백 토큰 기준. 참고용.
- 정규화: 공백 축약, 문장부호 제거(옵션). 병리 발화 낭독은 구두점이 불안정해
  기본적으로 부호를 떼고 비교한다.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_PUNCT = re.compile(r"[^\w가-힣\s]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize(text: str, *, drop_punct: bool = True) -> str:
    """비교용 정규화: NFC 정규화 → (옵션)부호 제거 → 공백 축약."""
    t = unicodedata.normalize("NFC", text or "")
    if drop_punct:
        t = _PUNCT.sub(" ", t)
    return _WS.sub(" ", t).strip()


def _levenshtein(a: list[str], b: list[str]) -> int:
    """토큰열 a→b 편집거리(삽입/삭제/치환 각 1). 메모리 O(min)."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


@dataclass(frozen=True)
class ErrorStat:
    """오류율 집계 — 여러 발화를 마이크로평균(전체 편집거리/전체 길이)."""

    edits: int
    length: int

    @property
    def rate(self) -> float:
        return self.edits / self.length if self.length else 0.0

    def __add__(self, other: "ErrorStat") -> "ErrorStat":
        return ErrorStat(self.edits + other.edits, self.length + other.length)


def cer_stat(hypothesis: str, reference: str, *, drop_punct: bool = True) -> ErrorStat:
    """글자 단위 오류 통계. 공백은 세지 않는다(글자 기준 CER)."""
    ref = normalize(reference, drop_punct=drop_punct).replace(" ", "")
    hyp = normalize(hypothesis, drop_punct=drop_punct).replace(" ", "")
    return ErrorStat(_levenshtein(list(hyp), list(ref)), len(ref))


def wer_stat(hypothesis: str, reference: str, *, drop_punct: bool = True) -> ErrorStat:
    """단어(공백 토큰) 단위 오류 통계."""
    ref = normalize(reference, drop_punct=drop_punct).split()
    hyp = normalize(hypothesis, drop_punct=drop_punct).split()
    return ErrorStat(_levenshtein(hyp, ref), len(ref))


def corpus_cer(pairs: list[tuple[str, str]], *, drop_punct: bool = True) -> float:
    """(가설, 정답) 쌍 목록의 마이크로평균 CER."""
    total = ErrorStat(0, 0)
    for hyp, ref in pairs:
        total = total + cer_stat(hyp, ref, drop_punct=drop_punct)
    return total.rate


def corpus_wer(pairs: list[tuple[str, str]], *, drop_punct: bool = True) -> float:
    """(가설, 정답) 쌍 목록의 마이크로평균 WER."""
    total = ErrorStat(0, 0)
    for hyp, ref in pairs:
        total = total + wer_stat(hyp, ref, drop_punct=drop_punct)
    return total.rate
