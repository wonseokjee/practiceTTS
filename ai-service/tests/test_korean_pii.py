"""한국어 PII 사전 감지 테스트.

설계 원칙이 '높은 정밀도, 낮은 재현율'이므로 두 방향을 다 본다:
  - 잡아야 할 것(호칭 인명·기관명·광역지명)을 잡는가
  - 잡으면 안 되는 것(정상 단어)을 안 잡는가 ← 사전 치환이라 과탐이 더 해롭다
"""
from constants.korean_pii import detect_korean_pii


def kinds(text: str) -> dict[str, str]:
    """{원본: 종류} 로 반환."""
    return {orig: kind for orig, kind in detect_korean_pii(text)}


# ── 잡아야 할 것 (재현) ───────────────────────────────────────


def test_person_with_title():
    assert kinds("이모 김순자님이 오셨어요")["김순자"] == "person"


def test_person_with_space_title():
    d = kinds("박영호 선생님이 오셨어요")
    assert d["박영호"] == "person"
    # "선생님"의 "선생"을 인명으로 오탐하지 않는다(선씨가 실제 성씨라 걸릴 뻔함)
    assert "선생" not in d


def test_title_nouns_not_flagged_as_names():
    for phrase in ["선생님이 오셨어요", "여사님과 통화", "교수님 강의", "원장님 회진"]:
        assert all(
            orig not in {"선생", "여사", "교수", "원장"}
            for orig, _ in detect_korean_pii(phrase)
        ), f"오탐: {phrase}"


def test_person_ssi():
    assert kinds("김민수씨와 통화했어요")["김민수"] == "person"


def test_organization():
    d = kinds("삼성서울병원 재활의학과에 갔어요")
    assert d.get("삼성서울병원") == "place"


def test_various_org_suffixes():
    assert "행복한의원" in kinds("행복한의원에서 진료받았어요")
    assert "은빛요양원" in kinds("은빛요양원에 다녀왔어요")


def test_region_metro_and_district():
    d = kinds("서울 강남구에 다녀왔어요")
    assert d.get("서울") == "place"
    assert d.get("강남구") == "place"


# ── 잡으면 안 되는 것 (정밀도 — 과탐 방지) ────────────────────


def test_common_words_with_surname_prefix_not_flagged():
    # 성씨로 시작하지만 호칭이 없는 일반어 — 인명이 아니다
    for word in ["정말", "강조", "안녕하세요", "고향", "우리", "지금", "노래"]:
        assert kinds(word) == {}, f"오탐: {word}"


def test_relation_words_without_name_not_flagged():
    # 앵커 호칭이 없는 관계어는 인명으로 잡지 않는다
    assert kinds("이모가 오셨어요") == {}
    assert kinds("삼촌이랑 놀았어요") == {}


def test_admin_suffix_common_words_not_flagged():
    # 동/구/면/리 접미사 일반어를 지명으로 오탐하지 않는다(사전 기반이라 안전)
    for word in ["운동 활동을 했어요", "친구랑 라면 먹었어요", "우리 동네 산책"]:
        assert all(kind != "place" for _, kind in detect_korean_pii(word)), (
            f"오탐: {word}"
        )


def test_bare_name_not_flagged():
    # 앵커 없는 맨이름은 못 잡는다(의도된 미탐 — Gemini가 2차로 잡음)
    assert kinds("철수랑 바다에 갔어요") == {}


def test_hospital_generic_phrase_needs_proper_noun():
    # "그 병원"(앞이 공백, 고유부 2자 미만)은 잡지 않는다
    assert "병원" not in kinds("그 병원에 갔어요")


# ── 페르소나 토큰 오염 없음 ───────────────────────────────────


def test_persona_token_not_detected_as_place():
    # [손자1] 안의 글자를 지명/인명으로 잡으면 안 된다
    d = detect_korean_pii("[손자1]이랑 갔어요")
    assert d == [] or all("손자" not in o for o, _ in d)
