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
