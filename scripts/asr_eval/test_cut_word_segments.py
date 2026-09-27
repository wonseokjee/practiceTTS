"""문장 속 단어 잘라내기 — 모델 없이 도는 부분(어절 찾기·CTC 강제 정렬)."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import cut_word_segments as C  # noqa: E402


def test_find_targets_counts_syllables_without_spaces_and_strips_particles():
    t = C.find_targets("가방에 사탕과 연필을 넣을 거예요.", ["사탕", "연필"])
    assert t == [("사탕", 3, 5), ("연필", 6, 8)]           # 가방에=0..2, 사탕과=3..5
    assert C.find_targets("눈썹이 짙다", ["눈"]) == []       # 썹은 조사가 아니다
    assert C.find_targets("풍선을 샀다", ["풍선"]) == [("풍선", 0, 2)]


def test_ctc_align_recovers_planted_spans():
    blank, V = 0, 4
    # 프레임: 공백 공백 A A 공백 B 공백 C C C
    seq = [0, 0, 1, 1, 0, 2, 0, 3, 3, 3]
    lp = np.full((len(seq), V), np.log(0.01))
    for t, k in enumerate(seq):
        lp[t, k] = np.log(0.97)
    assert C.ctc_align(lp, [1, 2, 3], blank) == [(2, 4), (5, 6), (7, 10)]


def test_ctc_align_repeated_token_needs_blank_between():
    blank = 0
    seq = [1, 0, 1, 0]          # 같은 토큰 두 번은 사이에 공백이 있어야 둘로 읽힌다
    lp = np.full((4, 2), np.log(0.02))
    for t, k in enumerate(seq):
        lp[t, k] = np.log(0.98)
    assert C.ctc_align(lp, [1, 1], blank) == [(0, 1), (2, 3)]


def test_edit_distance():
    assert C.edit("사탕", "사탕") == 0 and C.edit("사탄", "사탕") == 1 and C.edit("", "abc") == 3
