"""앱 채점기 이식 — ASR 평가를 제품과 같은 잣대로 잰다.

608 평가는 표준 편집거리 CER을 쓰는데, **앱은 다른 채점기를 쓴다.** 단어 과제는
음소 유사 가중 거리(`phoneticEditDistance`)로 조음 유사 혼동(ㅂ↔ㅍ, 종성 탈락)을
부분 오류로 관대하게 본다. 그래서 표준 CER은 앱 조건보다 **비관적**이고, "이 모델을
붙이면 앱이 얼마나 좋아지나"에 답하지 못한다.

원본(단일 진실): `frontend/src/memory-link/patient/quiz/domain/phoneticDistance.ts`,
`.../speechScore.ts`. 이 파일은 그 이식본이다 — 원본이 바뀌면 여기도 따라가야 하고,
`test_app_scorer.py`가 두 구현의 대표 사례를 고정해 어긋남을 잡는다.

앱이 실제로 내는 판정은 오류율 자체가 아니라 **임계값 통과 여부**(≤0.34 정답)다.
평균 오류율이 임계값 아래인 것과 항목별 통과율은 다른 이야기라, 통과율을 따로 낸다.
"""
from __future__ import annotations

import re
import unicodedata

# ─── 자모 표 (유니코드 조합 순서) ────────────────────────────────

CHO = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]
JUNG = [
    "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
    "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
]
JONG = [
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
    "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]

_HANGUL_BASE = 0xAC00
_HANGUL_LAST = 0xD7A3

# 조음 위치가 같은 자음 그룹 — 그룹 내 치환만 감면한다. 조음 위치가 다른 오류를
# 감면하면 QAB 점수의 진단 변별력이 떨어진다.
CONSONANT_GROUPS = [
    ["ㄱ", "ㄲ", "ㅋ"],        # 연구개 파열음
    ["ㄷ", "ㄸ", "ㅌ"],        # 치조 파열음
    ["ㅂ", "ㅃ", "ㅍ"],        # 양순 파열음
    ["ㅈ", "ㅉ", "ㅊ"],        # 파찰음
    ["ㅅ", "ㅆ"],              # 치조 마찰음
    ["ㄴ", "ㄹ", "ㅁ", "ㅇ"],  # 비음·유음
]
VOWEL_GROUPS = [
    ["ㅏ", "ㅓ"],
    ["ㅗ", "ㅜ"],
    ["ㅐ", "ㅔ", "ㅚ", "ㅟ", "ㅙ", "ㅞ"],
    ["ㅡ", "ㅣ", "ㅢ"],
    ["ㅑ", "ㅕ"],
    ["ㅛ", "ㅠ"],
]

SAME_GROUP_COST = 0.3
JONG_DROP_COST = 0.4
W_CHO, W_JUNG, W_JONG = 0.4, 0.4, 0.2

SPEECH_PASS_THRESHOLD = 0.34
"""앱의 정답 처리 경계(`good` 등급까지 정답)."""

_PUNCT = re.compile(r"[.,!?~…·\"'“”‘’「」『』]")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    """앱과 동일한 비교용 정규화: NFC + 소문자 + 구두점 제거 + 공백 정리."""
    t = unicodedata.normalize("NFC", text or "").lower()
    t = _PUNCT.sub("", t)
    return _WS.sub(" ", t).strip()


def decompose_hangul(ch: str) -> tuple[str, str, str] | None:
    """완성형 한글 1글자 → (초성, 중성, 종성). 한글이 아니면 None."""
    code = ord(ch)
    if code < _HANGUL_BASE or code > _HANGUL_LAST:
        return None
    off = code - _HANGUL_BASE
    return CHO[off // 588], JUNG[(off % 588) // 28], JONG[off % 28]


def _grouped_cost(a: str, b: str, groups: list[list[str]]) -> float:
    if a == b:
        return 0.0
    for g in groups:
        if a in g and b in g:
            return SAME_GROUP_COST
    return 1.0


def _jong_cost(a: str, b: str) -> float:
    """종성 치환 — 한쪽만 종성이 있으면 '탈락'으로 관대하게 본다."""
    if a == b:
        return 0.0
    if a == "" or b == "":
        return JONG_DROP_COST
    return _grouped_cost(a, b, CONSONANT_GROUPS)


def syllable_phonetic_cost(a: str, b: str) -> float:
    """두 음절의 음소 유사 거리 — 0(동일)~1(완전 다름)."""
    if a == b:
        return 0.0
    ja, jb = decompose_hangul(a), decompose_hangul(b)
    if ja is None or jb is None:
        return 1.0
    return (
        _grouped_cost(ja[0], jb[0], CONSONANT_GROUPS) * W_CHO
        + _grouped_cost(ja[1], jb[1], VOWEL_GROUPS) * W_JUNG
        + _jong_cost(ja[2], jb[2]) * W_JONG
    )


def _edit_distance(a: list[str], b: list[str], sub_cost) -> float:
    """토큰열 편집거리. 삽입/삭제는 1, 치환 비용은 `sub_cost`가 정한다."""
    m, n = len(a), len(b)
    if m == 0:
        return float(n)
    if n == 0:
        return float(m)
    prev = [float(j) for j in range(n + 1)]
    for i in range(1, m + 1):
        curr = [float(i)] + [0.0] * n
        for j in range(1, n + 1):
            curr[j] = min(
                prev[j] + 1,                            # 삭제
                curr[j - 1] + 1,                        # 삽입
                prev[j - 1] + sub_cost(a[i - 1], b[j - 1]),
            )
        prev = curr
    return prev[n]


def phonetic_edit_distance(a: list[str], b: list[str]) -> float:
    return _edit_distance(a, b, syllable_phonetic_cost)


def _tokenize(text: str, mode: str) -> list[str]:
    """'word'=음절 단위, 'sentence'=어절 단위."""
    norm = normalize(text)
    if not norm:
        return []
    if mode == "sentence":
        return [t for t in norm.split(" ") if t]
    return list(_WS.sub("", norm))


def speech_error_rate(transcript: str, target: str, mode: str) -> float:
    """앱과 동일한 오류율 — 편집거리 / **목표** 토큰 수.

    인자 순서가 (인식결과, 목표)이고 분모가 목표라는 점에 주의. 뒤집으면 값이
    달라진다(삽입/삭제 비대칭 + 분모 변경).
    """
    said = _tokenize(transcript, mode)
    want = _tokenize(target, mode)
    if not want:
        return 0.0 if not said else 1.0
    dist = (
        phonetic_edit_distance(said, want)
        if mode == "word"
        else _edit_distance(said, want, lambda x, y: 0.0 if x == y else 1.0)
    )
    return dist / len(want)


def is_speech_correct(transcript: str, target: str, mode: str) -> bool:
    """앱의 정답 판정. 빈 인식은 무조건 오답."""
    if not normalize(transcript):
        return False
    return speech_error_rate(transcript, target, mode) <= SPEECH_PASS_THRESHOLD


def score_batch(hyps: list[str], refs: list[str], mode: str) -> dict[str, float]:
    """앱 잣대로 한 묶음을 채점 → 평균 오류율 + **통과율**.

    통과율이 핵심이다. 앱이 내는 판정은 오류율 자체가 아니라 임계값 통과 여부이고,
    평균이 임계값 아래인 것과 항목별 통과율은 다른 이야기다.
    """
    if not refs:
        return {"error_rate": 0.0, "pass_rate": 0.0, "n": 0}
    rates = [speech_error_rate(h, r, mode) for h, r in zip(hyps, refs)]
    passes = [is_speech_correct(h, r, mode) for h, r in zip(hyps, refs)]
    return {
        "error_rate": sum(rates) / len(rates),
        "pass_rate": sum(passes) / len(passes),
        "n": len(refs),
    }
