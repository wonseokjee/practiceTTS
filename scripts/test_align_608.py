"""align_608 정렬 로직 테스트 (오디오·whisper 없이 순수 함수만).

실행: cd ai-service && python -m pytest ../scripts/test_align_608.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from align_608 import _sentences, segment_file, segment_wordlist  # noqa: E402


def test_sentence_split():
    assert _sentences("바다는 넓다. 하늘은 파랗다.") == ["바다는 넓다.", "하늘은 파랗다."]
    # 구분자 없으면 통짜 1문장
    assert _sentences("구분자없는문장") == ["구분자없는문장"]
    assert _sentences("") == []


def test_segment_aligns_each_sentence_to_time():
    tr = "바다는 넓다. 하늘은 파랗다. 나는 걷는다."
    hyp = [
        {"text": "바다는", "start": 0.0, "end": 0.5},
        {"text": "넓다", "start": 0.5, "end": 1.0},
        {"text": "하늘은", "start": 1.2, "end": 1.7},
        {"text": "파랗다", "start": 1.7, "end": 2.3},
        {"text": "나는", "start": 2.6, "end": 2.9},
        {"text": "건는다", "start": 2.9, "end": 3.5},  # 오인식(걷→건)
    ]
    segs = segment_file(tr, hyp)
    assert [s["sent_index"] for s in segs] == [0, 1, 2]
    assert [s["reference_text"] for s in segs] == _sentences(tr)
    # 시간은 단조 증가하고 각 구간은 유효(end>start)
    assert segs[0]["start"] == 0.0
    for s in segs:
        assert s["end"] > s["start"]
    # 오인식 문장도 앵커 보간으로 시작 시각 확보(2번째 문장 뒤)
    assert segs[2]["start"] >= segs[1]["end"] - 0.5


def test_no_anchor_returns_empty():
    # whisper가 전혀 못 맞추면(교집합 0) 세그먼트 없음 → 상위에서 skip
    tr = "바다는 넓다."
    hyp = [{"text": "전혀", "start": 0.0, "end": 0.3}, {"text": "다른말", "start": 0.3, "end": 0.6}]
    assert segment_file(tr, hyp) == []


def test_empty_inputs():
    assert segment_file("", []) == []
    assert segment_file("바다.", []) == []


def test_wordlist_splits_per_word():
    # 문장부호 없는 단어 나열 → 단어별 세그먼트(문장 모드면 통짜 1개였을 것)
    tr = "거울 안경 전화 신발"
    hyp = [
        {"text": "거울", "start": 0.0, "end": 0.8},
        {"text": "안경", "start": 1.5, "end": 2.3},
        {"text": "전화", "start": 3.0, "end": 3.9},
        {"text": "신발", "start": 4.5, "end": 5.2},
    ]
    segs = segment_wordlist(tr, hyp, words_per_seg=1)
    assert len(segs) == 4
    assert [s["reference_text"] for s in segs] == ["거울", "안경", "전화", "신발"]
    for s in segs:
        assert s["end"] > s["start"]
    assert segs[0]["start"] == 0.0 and segs[0]["end"] == 0.8


def test_wordlist_drops_unanchored_and_short():
    # 앵커 없는 단어(whisper가 못 잡음)는 시각이 무너져 버려진다.
    tr = "거울 안경 전화"
    hyp = [
        {"text": "거울", "start": 0.0, "end": 0.8},
        # '안경'은 whisper가 놓침 → 앵커 없음
        {"text": "전화", "start": 3.0, "end": 3.9},
    ]
    segs = segment_wordlist(tr, hyp, words_per_seg=1, min_dur=0.4)
    texts = [s["reference_text"] for s in segs]
    assert "거울" in texts and "전화" in texts
    assert "안경" not in texts  # 보간으로 붕괴 → 제외


def test_wordlist_groups_words():
    tr = "거울 안경 전화 신발"
    hyp = [
        {"text": "거울", "start": 0.0, "end": 0.8},
        {"text": "안경", "start": 1.5, "end": 2.3},
        {"text": "전화", "start": 3.0, "end": 3.9},
        {"text": "신발", "start": 4.5, "end": 5.2},
    ]
    segs = segment_wordlist(tr, hyp, words_per_seg=2)
    assert [s["reference_text"] for s in segs] == ["거울 안경", "전화 신발"]


def test_wordlist_empty():
    assert segment_wordlist("", []) == []
    assert segment_wordlist("거울 안경", []) == []


# ─── 긴 녹음 나눠 정렬 · 재개 ─────────────────────────────────────

import json  # noqa: E402

import align_608 as A  # noqa: E402


class _FakeModel:
    """입력 길이(초)마다 단어 하나를 0.5초에 놓는다. 통째 경로면 파일 경로 문자열을 받는다."""

    def __init__(self):
        self.calls = []

    def transcribe(self, audio, **kw):
        self.calls.append(audio)
        n = 2 if isinstance(audio, str) else len(audio)
        return {"segments": [{"words": [{"word": f" w{i}", "start": i + 0.5, "end": i + 0.9}
                                        for i in range(n)]}]}


def test_short_audio_is_aligned_whole_as_before(monkeypatch):
    monkeypatch.setattr(A, "_wav_duration", lambda p: A.LONG_AUDIO_SEC)
    m = _FakeModel()
    words = A.align_words(Path("x.wav"), m)
    assert m.calls == ["x.wav"]
    assert words[0] == {"text": "w0", "start": 0.5, "end": 0.9}


def test_unknown_duration_is_aligned_whole(monkeypatch):
    monkeypatch.setattr(A, "_wav_duration", lambda p: None)
    m = _FakeModel()
    A.align_words(Path("x.flac"), m)
    assert m.calls == ["x.flac"]


def test_long_audio_is_chunked_and_offset(monkeypatch):
    dur = A.LONG_AUDIO_SEC + 1
    monkeypatch.setattr(A, "_wav_duration", lambda p: dur)
    loads = []

    def fake_load(path, start, d):
        loads.append((start, d))
        return [0.0] * 2           # 조각마다 단어 2개
    monkeypatch.setattr(A, "_load_chunk", fake_load)
    m = _FakeModel()
    words = A.align_words(Path("x.wav"), m)

    n = int(A.LONG_AUDIO_SEC // A.CHUNK_SEC) + 1
    assert [s for s, _ in loads] == [k * A.CHUNK_SEC for k in range(n)]
    assert loads[-1][1] == 1                       # 마지막 조각은 남은 길이만
    assert all(d <= A.CHUNK_SEC for _, d in loads)
    starts = [w["start"] for w in words]
    assert starts == sorted(starts)                # 조각 시각이 이어진다
    assert words[2]["start"] == A.CHUNK_SEC + 0.5  # 두 번째 조각 첫 단어 = 오프셋 + 0.5


def test_wav_duration_reads_header(tmp_path):
    import wave
    p = tmp_path / "a.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\0\0" * 8000)
    assert A._wav_duration(p) == 0.5
    assert A._wav_duration(tmp_path / "missing.wav") is None


def test_load_chunk_reads_only_the_window(tmp_path):
    import shutil
    import wave

    import pytest
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg 없음")
    p = tmp_path / "a.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\0\0" * 16000 * 3)
    assert len(A._load_chunk(p, 1.0, 1.0)) == 16000


def _seg(parent):
    return json.dumps({"parent_file_id": parent, "sent_index": 0})


def test_resume_drops_partial_file_lines(tmp_path):
    seg, att = tmp_path / "segments.jsonl", tmp_path / "_attempted.txt"
    seg.write_text("\n".join([_seg("a"), _seg("a"), _seg("b"), '{"parent_fi']) + "\n", encoding="utf-8")
    att.write_text("a\nzero\n", encoding="utf-8")   # b는 정렬 도중 죽었다, zero는 세그 0개
    done = A._resume_state(seg, att)
    assert done == {"a", "zero"}
    assert [json.loads(l)["parent_file_id"] for l in seg.read_text(encoding="utf-8").splitlines()] == ["a", "a"]


def test_resume_without_attempted_log_keeps_legacy_behavior(tmp_path):
    seg = tmp_path / "segments.jsonl"
    seg.write_text(_seg("a") + "\n" + _seg("b") + "\n", encoding="utf-8")
    assert A._resume_state(seg, tmp_path / "_attempted.txt") == {"a", "b"}
    assert len(seg.read_text(encoding="utf-8").splitlines()) == 2


def test_resume_fresh_dir(tmp_path):
    assert A._resume_state(tmp_path / "segments.jsonl", tmp_path / "_attempted.txt") == set()

