"""app_scorer 이식 검증 — 프론트 원본과 같은 답을 내는지 고정한다.

아래 사례는 대부분 `frontend/.../domain/speechScore.test.ts`와
`phoneticDistance.test.ts`를 **그대로 미러링**한 것이다. 같은 입력에 같은 답이
나오지 않으면 이식이 어긋난 것이고, ASR 평가 수치가 앱 동작과 달라진다.
원본을 고칠 때 이 파일도 같이 고쳐야 한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app_scorer import (  # noqa: E402
    SPEECH_PASS_THRESHOLD,
    _derange,
    decompose_hangul,
    is_speech_correct,
    mismatch_control,
    score_batch,
    speech_error_rate,
    syllable_phonetic_cost,
)


# ─── 자모 분해 ────────────────────────────────────────────────

def test_골든_벡터를_재현한다():
    """TS 정본이 얼려둔 입력·출력 쌍을 이식본이 그대로 재현하는지 본다.

    아래 다른 테스트들은 기대값을 **하드코딩**한다. 그건 Python 쪽이 바뀌는 것만
    잡는다 — TS에서 W_JONG을 0.2→0.3으로 바꿔도 여기는 초록이고, 그때부터 608
    평가는 앱이 안 쓰는 채점기로 측정한다. 그런데 활발히 바뀌는 쪽은 TS(앱)다.

    이 테스트는 방향이 반대다. 벡터 파일이 계약이고, TS를 고치면 거기서 먼저
    빨간불이 나며, 벡터를 다시 쓰면(UPDATE_GOLDEN=1) 이번엔 이식본이 안 따라온
    만큼 여기가 빨간불이 된다. 한쪽만 바뀌는 경로가 없다.

    벡터 생성:
      cd frontend && UPDATE_GOLDEN=1 npx vitest run \
        src/memory-link/patient/quiz/domain/speechScoreGolden.test.ts
    """
    vec_path = Path(__file__).parent / "golden" / "speech_scorer_vectors.json"
    assert vec_path.exists(), (
        f"골든 벡터가 없다: {vec_path}. TS 테스트를 UPDATE_GOLDEN=1로 돌려 만들어라."
    )
    v = json.loads(vec_path.read_text(encoding="utf-8"))

    assert SPEECH_PASS_THRESHOLD == v["threshold"], (
        f"임계값 불일치: py={SPEECH_PASS_THRESHOLD} ts={v['threshold']}"
    )

    for c in v["decompose"]:
        got = decompose_hangul(c["ch"])
        want = None if c["jamo"] is None else tuple(c["jamo"])
        assert got == want, f"decompose_hangul({c['ch']!r}): py={got} ts={want}"

    for c in v["syllableCost"]:
        got = syllable_phonetic_cost(c["a"], c["b"])
        assert abs(got - c["cost"]) < 1e-9, (
            f"syllable_phonetic_cost({c['a']}, {c['b']}): py={got} ts={c['cost']}"
        )

    for c in v["errorRate"]:
        got = speech_error_rate(c["transcript"], c["target"], c["mode"])
        assert abs(got - c["rate"]) < 1e-9, (
            f"speech_error_rate({c['transcript']!r}, {c['target']!r}, {c['mode']}): "
            f"py={got} ts={c['rate']}"
        )

    for c in v["isCorrect"]:
        got = is_speech_correct(c["transcript"], c["target"], c["mode"])
        assert got == c["correct"], (
            f"is_speech_correct({c['transcript']!r}, {c['target']!r}, {c['mode']}): "
            f"py={got} ts={c['correct']}"
        )


def test_한글_분해():
    assert decompose_hangul("각") == ("ㄱ", "ㅏ", "ㄱ")
    assert decompose_hangul("가") == ("ㄱ", "ㅏ", "")


def test_한글이_아니면_None():
    assert decompose_hangul("a") is None
    assert decompose_hangul("1") is None


# ─── 음절 비용 ────────────────────────────────────────────────

def test_같은_음절은_비용_0():
    assert syllable_phonetic_cost("바", "바") == 0.0


def test_조음_위치가_같으면_부분_비용():
    # ㅂ↔ㅍ 양순 파열음: 구음장애에서 가장 흔한 혼동
    assert syllable_phonetic_cost("바", "파") == 0.3 * 0.4


def test_종성_탈락은_관대():
    # '반'→'바': 종성만 빠짐 → JONG_DROP_COST(0.4) × W_JONG(0.2)
    assert syllable_phonetic_cost("반", "바") == 0.4 * 0.2


def test_한글이_아니면_완전_불일치():
    assert syllable_phonetic_cost("a", "바") == 1.0


# ─── 오류율 (speechScore.test.ts 미러) ────────────────────────

def test_완전_일치는_오류율_0():
    assert speech_error_rate("사과", "사과", "word") == 0
    assert speech_error_rate("오늘 날씨가 좋아요", "오늘 날씨가 좋아요", "sentence") == 0


def test_단어_조음_유사_혼동은_관대():
    # "바다"→"파다"(ㅂ↔ㅍ) — 부분 오류만
    assert speech_error_rate("파다", "바다", "word") < 0.2


def test_단어_조음_위치가_다르면_큰_오류율():
    # 너무 관대하면 QAB 점수의 진단 변별력이 떨어진다
    assert speech_error_rate("하수", "바다", "word") > SPEECH_PASS_THRESHOLD


def test_문장_한_어절_차이는_어절수분의_1():
    got = speech_error_rate("오늘 날씨가 추워요", "오늘 날씨가 좋아요", "sentence")
    assert abs(got - 1 / 3) < 1e-9


def test_구두점_대소문자_공백은_무시():
    assert speech_error_rate("  오늘   날씨가 좋아요! ", "오늘 날씨가 좋아요", "sentence") == 0


def test_목표가_비면_오류율_1():
    assert speech_error_rate("사과", "", "word") == 1


# ─── 정답 판정 (speechScore.test.ts 미러) ─────────────────────

def test_완전_일치는_정답():
    assert is_speech_correct("사과", "사과", "word") is True


def test_긴_문장에서_한_어절_차이는_정답():
    # 4어절 중 1어절 차이 = 0.25 ≤ 0.34
    assert is_speech_correct(
        "가족이 함께 점심을 먹어요", "가족이 함께 저녁을 먹어요", "sentence"
    ) is True


def test_절반이_틀리면_오답():
    assert is_speech_correct("바나나", "사과", "word") is False


def test_빈_입력은_오답():
    assert is_speech_correct("", "사과", "word") is False
    assert is_speech_correct("   ", "오늘 날씨가 좋아요", "sentence") is False


# ─── 1음절 목표에서 등급 해상도가 무너지는 것 (부채 재현) ──────

def test_1음절_목표는_통과_아니면_큰_오류율():
    """분모가 1이라 중간 등급이 사실상 없다.

    docs/history/20260816_speech_grade_threshold_debt.md 참조. 조음 유사 혼동만
    경계 아래로 들어오고, 그 외에는 임계값을 훌쩍 넘는다.
    """
    assert speech_error_rate("바", "바", "word") == 0            # 일치
    assert speech_error_rate("파", "바", "word") <= SPEECH_PASS_THRESHOLD  # 유사 → 통과
    assert speech_error_rate("수", "바", "word") > 0.5           # 다르면 곧장 큰 값


# ─── 묶음 채점 ────────────────────────────────────────────────

def test_통과율은_평균_오류율과_다르다():
    """평균이 임계값 아래여도 통과율은 100%가 아니다 — 그래서 따로 낸다.

    "평균 단어 CER이 0.34 아래니까 앱에서 다 통과한다"는 추론이 틀렸음을 못박는다.
    아래는 4개 중 3개가 완전 일치인데도 통과율이 75%다.
    """
    hyps = ["사과", "사과", "사과", "바나나"]
    refs = ["사과", "사과", "사과", "사과"]

    got = score_batch(hyps, refs, "word")

    assert got["n"] == 4
    assert got["pass_rate"] == 3 / 4
    assert got["error_rate"] < SPEECH_PASS_THRESHOLD   # 평균은 경계 아래인데(0.275)


def test_빈_묶음():
    got = score_batch([], [], "word")
    assert got == {"error_rate": 0.0, "pass_rate": 0.0, "n": 0}


# ─── 짝 섞기 대조군 (오통과 탐지) ────────────────────────────────
#
# 구음장애 음성을 목표 대본으로 파인튜닝하면 모델이 흐린 발음을 목표어로 고쳐
# 적게 된다. 대화 인식엔 좋지만 채점엔 정반대다 — 틀리게 발음한 환자가 통과한다.
# README에 이미 관측 기록이 있다(모델이 오디오를 무시하고 학습 문장을 그대로 출력).
#
# 전사 문자열 수준에서 검증 가능하다 — 오디오도 모델도 필요 없다.


def test_derange는_고정점을_남기지_않는다():
    import random as _r

    for n in range(2, 12):
        for seed in range(5):
            idx = _derange(n, _r.Random(seed))
            assert sorted(idx) == list(range(n)), "순열이어야 한다"
            assert all(idx[i] != i for i in range(n)), f"n={n} seed={seed}: 고정점이 남았다"


def test_변별력_있는_모델은_어긋난_짝에서_떨어진다():
    # 오디오를 제대로 듣는 모델: 자기 목표엔 맞고 남의 목표엔 안 맞는다.
    refs = ["사과", "바나나", "포도", "수박", "딸기", "참외"]
    hyps = list(refs)

    got = mismatch_control(hyps, refs, "word", seed=1)

    assert got["paired_pass"] == 1.0
    assert got["mismatched_pass"] < 0.2, "서로 다른 낱말끼리는 통과하면 안 된다"
    assert got["discrimination"] > 0.8


def test_오디오를_무시하는_모델은_변별력이_0이다():
    # 암기한 모델: 무슨 오디오를 줘도 같은 말을 뱉는다. 목표가 뭐든 결과가 같아서
    # 정상 짝과 어긋난 짝의 통과율이 붙는다 — 그게 이 지표가 잡으려는 그림이다.
    refs = ["사과", "사과", "사과", "사과", "사과", "사과"]
    hyps = ["사과"] * 6

    got = mismatch_control(hyps, refs, "word", seed=1)

    assert got["paired_pass"] == 1.0
    assert got["mismatched_pass"] == 1.0
    assert got["discrimination"] == 0.0, (
        "정상 짝과 어긋난 짝이 같으면 통과율은 그 음성에 대한 판정이 아니다"
    )


def test_관대해진_모델은_변별력이_깎인다():
    # 파인튜닝 전후 비교의 축소판. 목표어가 서로 음운적으로 가까우면 어긋난 짝도
    # 통과하기 시작하고, 그만큼 discrimination이 내려간다.
    refs = ["바", "파", "바", "파", "바", "파"]
    hyps = list(refs)

    got = mismatch_control(hyps, refs, "word", seed=1)

    assert got["paired_pass"] == 1.0
    # ㅂ↔ㅍ는 같은 조음위치라 비용이 임계값 아래 → 남의 목표에도 통과한다.
    assert got["mismatched_pass"] == 1.0
    assert got["discrimination"] == 0.0


def test_대조군은_결정론적이다():
    # 같은 seed면 같은 값이어야 배치 간 비교가 성립한다.
    refs = ["사과", "바나나", "포도", "수박"]
    hyps = ["사과", "바나나", "포도", "참외"]

    a = mismatch_control(hyps, refs, "word", seed=7)
    b = mismatch_control(hyps, refs, "word", seed=7)

    assert a == b


def test_두_개_미만이면_섞을_수_없다():
    got = mismatch_control(["사과"], ["사과"], "word")
    assert got["n"] == 1
    assert got["discrimination"] == 0.0
