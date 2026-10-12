"""cut_words_whisper — 모델 없이 도는 부분(음절↔토큰 대응, 경계 보정, 필터, 계획)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import median_filter

sys.path.insert(0, str(Path(__file__).parent))

import cut_words_whisper as W  # noqa: E402


# ─── 음절 ↔ 토큰 ───────────────────────────────────────────────

def test_char_spans_whole_syllable_tokens():
    # "사탕 줘" → 토큰 "사", "탕", " 줘"
    spans = W.char_spans(["사", "사탕", "사탕 줘"])
    assert spans == [(0, 1, 1), (1, 2, 2), (2, 3, 3)]


def test_char_spans_syllable_split_into_byte_tokens():
    # "탕"이 바이트 토큰 둘로 쪼개지면 첫 토큰의 누적 디코드는 '�'로 끝난다.
    # 낱개 디코드로 세면 '�'가 음절 하나로 세어져 뒤 위치가 전부 밀린다.
    spans = W.char_spans(["사", "사�", "사탕", "사탕과"])
    assert spans == [(0, 1, 1), (1, 2, 1), (1, 2, 2), (2, 3, 3)]
    # "탕"(음절 1)은 두 바이트 토큰 1·2가 덮는다 → 시작은 토큰 1
    assert W.word_tokens(spans, 0, 2) == (0, 2, True)
    assert W.word_tokens(spans, 1, 2) == (1, 2, True)


def test_char_spans_ignores_punctuation_like_find_targets():
    spans = W.char_spans(["사과", "사과,", "사과, 배"])
    assert [s[2] for s in spans] == [2, 2, 3]


def test_word_tokens_particle_in_same_token_is_not_clean():
    # "사탕과"의 "탕과"가 한 토큰이면 단어 끝이 토큰 한가운데다
    spans = W.char_spans(["사", "사탕과"])
    assert W.word_tokens(spans, 0, 2) == (0, 1, False)


def test_word_tokens_out_of_range():
    spans = W.char_spans(["사", "사탕"])
    assert W.word_tokens(spans, 2, 4) is None


def test_find_targets_positions_match_char_spans():
    text = "열과 성을 다해, 사탕과 풍선을 샀다."
    targets = W.find_targets(text, ["사탕", "풍선", "성"])
    assert [(w, a, b) for w, a, b in targets] == [("성", 2, 3), ("사탕", 6, 8), ("풍선", 9, 11)]
    assert W.norm(text)[6:8] == "사탕"


# ─── 경계 ───────────────────────────────────────────────────────

def _rms_with_speech(frames: int, voiced: list[range]) -> np.ndarray:
    r = np.full(frames, 0.001)
    for rg in voiced:
        r[list(rg)] = 1.0
    return r


def test_energy_adjust_pulls_start_past_leading_silence():
    # DTW가 단어를 프레임 10~40으로 잡았지만 소리는 25~38
    rms = _rms_with_speech(60, [range(25, 38)])
    ws, we = W.energy_adjust(rms, 0.15, 10 * W.FRAME, 40 * W.FRAME, 50 * W.FRAME)
    assert ws == 25 * W.FRAME and we == 40 * W.FRAME


def test_energy_adjust_extends_end_while_voiced_up_to_limit():
    rms = _rms_with_speech(60, [range(10, 55)])
    ws, we = W.energy_adjust(rms, 0.15, 10 * W.FRAME, 30 * W.FRAME, 45 * W.FRAME)
    assert ws == 10 * W.FRAME
    assert we == 45 * W.FRAME          # 다음 토큰 중간에서 멈춘다


def test_energy_adjust_keeps_dtw_times_without_speech():
    rms = _rms_with_speech(60, [])
    assert W.energy_adjust(rms, 0.15, 0.2, 0.6, 0.8) == (0.2, 0.6)


def test_clip_bounds_pads_but_not_past_half_neighbor():
    assert W.clip_bounds(1.0, 1.5, 0.0, 3.0, 3.0) == (0.9, 1.65)
    # 이웃이 짧으면 그 절반만
    assert W.clip_bounds(1.0, 1.5, 0.9, 1.6, 3.0) == (0.95, 1.55)
    # 오디오 양끝을 넘지 않는다
    assert W.clip_bounds(0.02, 2.98, 0.0, 3.0, 3.0) == (0.01, 2.99)


def test_speech_extent():
    a = np.zeros(W.SR, np.float32)
    a[int(0.3 * W.SR): int(0.7 * W.SR)] = 0.5
    s, e = W.speech_extent(a)
    assert abs(s - 0.3) <= W.FRAME and abs(e - 0.7) <= W.FRAME


# ─── 어텐션 → 시각 ──────────────────────────────────────────────

def test_attention_matrix_renormalizes_and_standardizes_over_tokens():
    # 프레임 축으로 일정한 행: 중앙값 필터가 값을 안 바꾼다
    w = np.array([[[0.2] * 10, [0.6] * 10, [0.1] * 10]])      # [H=1, 토큰 3, 프레임 10]
    m = W.attention_matrix(w, median_filter)
    assert m.shape == (3, 10)
    np.testing.assert_allclose(m.mean(0), 0.0, atol=1e-6)        # 토큰 축 평균 0
    assert m[1, 0] > m[0, 0] > m[2, 0]


def test_times_from_attention_diagonal():
    # 토큰 3개가 프레임 0~9, 10~19, 20~29에 몰린 어텐션
    mat = np.full((3, 30), -1.0)
    for k in range(3):
        mat[k, k * 10:(k + 1) * 10] = 1.0
    times = W.times_from_attention(mat, 30)
    assert times == [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6)]


# ─── 필터 · 계획 ───────────────────────────────────────────────

def test_keep_is_exact_word_ignoring_spaces_and_punct():
    assert W.keep("사탕", " 사탕.")
    assert W.keep("사탕", "사 탕")
    assert not W.keep("사탕", "사탕과")
    assert not W.keep("사탕", "사자")
    assert not W.keep("사탕", "")


def test_plan_rows_skips_wordlist_no_word_and_long():
    rows = [
        {"task_type": "narrative", "reference_text": "사탕을 먹었다.", "start": 0, "end": 3},
        {"task_type": "narrative", "reference_text": "밥을 먹었다.", "start": 0, "end": 3},
        {"task_type": "wordlist", "reference_text": "사탕", "start": 0, "end": 1},
        {"task_type": "narrative", "reference_text": "사탕이 많다.", "start": 0, "end": 31},
    ]
    keep, skipped = W.plan_rows(rows, ["사탕"])
    assert [r["end"] for r in keep] == [3]
    assert skipped == {"wordlist": 1, "no_app_word": 1, "too_long": 1}


class _FakeAligner:
    """토큰 = 음절 하나, 음절마다 0.5초."""

    def align(self, audio, text):
        n = len(W.norm(text))
        spans = W.char_spans([W.norm(text)[: k + 1] for k in range(n)])
        return spans, [(k * 0.5, (k + 1) * 0.5) for k in range(n)]


def test_cut_one_marks_each_occurrence():
    text = "사탕과 풍선, 사탕."
    audio = np.full(int(len(W.norm(text)) * 0.5 * W.SR), 0.3, np.float32)
    audio[int(1.0 * W.SR): int(1.5 * W.SR)] = 0.0        # "과"는 조용하다 → 끝을 늘리지 않는다
    row = {"reference_text": text, "segment_wav_relpath": "p/p_001.wav", "parent_file_id": "p.wav"}
    out = W.cut_one(_FakeAligner(), audio, row, ["사탕", "풍선"])
    assert [(o["word"], o["occ"]) for o in out] == [("사탕", 0), ("풍선", 1), ("사탕", 2)]
    first = out[0]
    assert (first["t0"], first["t1"], first["clean"]) == (0.0, 1.15, True)   # 끝 1.0 + 여유 0.15
    # 소리가 이어지면 끝을 다음 토큰 중간(1.25)까지 늘리고, 여유는 남은 0.25의 절반
    audio[:] = 0.3
    assert abs(W.cut_one(_FakeAligner(), audio, row, ["사탕"])[0]["t1"] - 1.375) <= W.FRAME
    assert all(o["segment"] == "p/p_001.wav" for o in out)
