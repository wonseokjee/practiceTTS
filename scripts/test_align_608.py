"""align_608 정렬 로직 테스트 (오디오·whisper 없이 순수 함수만).

실행: cd ai-service && python -m pytest ../scripts/test_align_608.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from align_608 import _sentences, segment_file  # noqa: E402


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
