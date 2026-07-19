"""한국어 PII 사전 감지 테스트.

두 방향을 다 본다:
  - 잡아야 할 것을 잡는가 ← **미탐이 곧 외부 LLM 유출이다**
  - 잡으면 안 되는 것(정상 단어)을 안 잡는가 ← 과탐은 퀴즈 문장을 망친다

과탐과 미탐 중에는 과탐이 낫지만(유출보다 품질 저하가 덜 나쁘다), 블록리스트로
최대한 줄인다. 두 방향 모두 회귀를 막는 것이 이 파일의 목적이다.
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


def test_bare_name_in_lexicon_is_flagged():
    """사전에 있는 맨이름 + 사람 조사는 잡는다.

    예전에는 "앵커 없는 맨이름은 Gemini가 2차로 잡는다"며 일부러 놓쳤다.
    그런데 Gemini가 잡으려면 **원문이 외부로 나가야** 해서, 그 미탐이 곧
    유출이었다. 실측에서 맨이름이 가장 큰 유출원이라 사전으로 막는다.
    """
    assert kinds("철수랑 바다에 갔어요") == {"철수": "person"}


def test_bare_name_outside_lexicon_still_missed():
    """사전에 없는 이름은 여전히 놓친다 — 알려진 한계다.

    사전 없이 2~3자를 이름으로 단정하면 일반명사를 마구 가린다. 이 구멍을
    닫으려면 로컬 NER이 필요하다(별도 과제).
    """
    assert kinds("뫼별랑 바다에 갔어요") == {}


def test_hospital_generic_phrase_needs_proper_noun():
    # "그 병원"(앞이 공백, 고유부 2자 미만)은 잡지 않는다
    assert "병원" not in kinds("그 병원에 갔어요")


# ── 페르소나 토큰 오염 없음 ───────────────────────────────────


def test_persona_token_not_detected_as_place():
    # [손자1] 안의 글자를 지명/인명으로 잡으면 안 된다
    d = detect_korean_pii("[손자1]이랑 갔어요")
    assert d == [] or all("손자" not in o for o, _ in d)


# ── A1: 유출 축소를 위해 넓힌 규칙들 ──────────────────────────
#
# 실측(tests/measure_leak.py)에서 외부로 나가던 것들을 막는 규칙이다.
# 미탐 = 유출이므로, 각 규칙이 살아 있는지 고정한다.


def test_kinship_anchor_catches_name():
    """관계어 뒤 이름은 사전에 없어도 잡는다."""
    assert kinds("아들 원석이랑 산책했어요")["원석"] == "person"
    assert kinds("손녀 지민이가 놀러 왔어요")["지민"] == "person"
    assert kinds("며느리 지수한테 고맙다고 했어요")["지수"] == "person"


def test_kinship_anchor_ignores_common_nouns():
    """관계어 뒤라도 일반명사는 잡지 않는다 (퀴즈 문장이 망가진다)."""
    assert kinds("아들 생일이라 케이크를 샀어요") == {}
    assert kinds("딸 결혼식에 다녀왔어요") == {}


def test_bare_name_with_honorific_without_surname():
    """성씨 없이 이름 + 경칭도 잡는다 ("혜란씨")."""
    assert kinds("혜란씨가 데려다줬어요")["혜란"] == "person"


def test_honorific_rule_ignores_common_address_terms():
    for text in ["아저씨가 왔어요", "아가씨가 안내했어요", "어머님이 편찮으세요"]:
        assert kinds(text) == {}, text


def test_place_suffix_rules():
    assert kinds("역삼동 시장에서 과일을 샀어요")["역삼동"] == "place"
    assert kinds("종로3가역에서 만났어요")["종로3가역"] == "place"
    assert kinds("덕진공원에 갔어요")["덕진공원"] == "place"
    assert kinds("올림픽대교를 건넜어요")["올림픽대교"] == "place"


def test_place_suffix_rules_ignore_common_nouns():
    """접미사만 보면 과탐이 심하다. 블록리스트가 살아 있는지 확인한다."""
    for text in [
        "오늘은 운동을 했어요",
        "이 지역은 조용해요",
        "우리 집에 왔어요",
        "머리를 깎았어요",
        "요리를 했어요",
        "시장경제 뉴스를 봤어요",
    ]:
        assert kinds(text) == {}, text
