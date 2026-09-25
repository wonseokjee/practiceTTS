"""영어(en-US) 텍스트의 로컬 PII 감지 — 외부 LLM 호출 없이 **확실한 것만** 잡는다.

한국어 사전(`korean_pii.py`)과 같은 원칙이다: 앵커가 확실한 것(전화·SSN·호칭 인명·관계어 인명·
기관명·도로 주소)은 정밀도를 높게, 앵커 없는 맨 이름은 여기서 포기하고 Gemini 감지에 맡긴다.
그래서 재현율이 낮고 정밀도가 높다 — 회상 노트의 연도·금액·일반어(Hope, Will, Mark)를 가리면
퀴즈·시나리오가 깨진다.

반환은 `[(원문 부분문자열, 종류)]`. 종류는 masking_service의 라벨 체계를 따른다
(`person`·`place`·`phone`·`ssn`).
"""

import re

# ── 전화번호(미국) ────────────────────────────────────────────────
# (212) 555-0123 · 212-555-0123 · 212.555.0123 · +1 212 555 0123 · 1-800-555-0199 · 2125550123
# 한국 규칙은 0 국번 접두를 요구해서 영어 번호를 못 잡거나 뒤 7자리만 가려 지역번호가 남는다.
_PHONE = re.compile(
    r"(?<![\d$,.])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])"
    r"|(?<![\d$,.])\d{10}(?![\d])"
)

# ── SSN ───────────────────────────────────────────────────────────
# 123-45-6789 / 123 45 6789 는 모양만으로 잡는다. 맨 9자리는 금액·번호와 구별이
# 안 되므로 앞말이 신분번호임을 밝힐 때만 잡는다(숫자 부분만 가린다).
_SSN_SHAPED = re.compile(r"(?<![\d-])\d{3}[-\s]\d{2}[-\s]\d{4}(?![\d-])")
_SSN_ANCHORED = re.compile(
    r"(?i:\bSSN|social\s+security(?:\s+(?:number|no\.?))?|social)[:\s#]*(\d{9})(?!\d)"
)

# ── 인명 ──────────────────────────────────────────────────────────
_NAME = r"[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\s[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)?"

_KINSHIP = (
    "son|daughter|husband|wife|mother|father|mom|dad|brother|sister|grandson|granddaughter|"
    "grandmother|grandfather|grandma|grandpa|uncle|aunt|cousin|nephew|niece|friend|neighbor|"
    "neighbour|nurse|doctor|caregiver|teacher|boss"
)
# my son Michael · her husband Robert Miller · our daughter named Emily
_PERSON_KINSHIP = re.compile(
    rf"(?i:\b(?:my|his|her|our|their)\s+(?:{_KINSHIP})\s+(?:(?:named|called)\s+)?)({_NAME})"
)
# Mr. Johnson · Dr. Patel · Mrs. Alvarez  (Father·Sister는 관계어와 겹쳐 뺀다)
_PERSON_TITLE = re.compile(rf"\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Pastor)\.?\s+({_NAME})")
# her name is Susan Clark · the nurse was called Angela · a boy named Tom
_PERSON_COPULA = re.compile(rf"(?:\bname is|\bnamed|\b(?:was|is|are|were) called)\s+({_NAME})")

# 앵커 뒤에 이름이 아닌 대문자 낱말이 오는 경우("He was called Monday")를 거른다.
_NOT_A_NAME = {
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "I", "The", "A", "An", "This", "That", "It", "He", "She", "We", "They",
    "Christmas", "Easter", "Thanksgiving",
}

# ── 기관명 ────────────────────────────────────────────────────────
# St. Mary's Hospital · Lincoln Elementary School · Grace Baptist Church
_ORG = re.compile(
    r"\b(?:(?:St\.|Saint)\s+)?(?:[A-Z][a-z']+\s+){1,3}"
    r"(?:Elementary School|Middle School|High School|Hospital|Clinic|Church|School|"
    r"University|College|Library|Bank|Center)\b"
)
# 관사·대명사로 시작하는 대문자 낱말은 기관명의 일부가 아니다("The Hospital").
_ORG_LEADING_STOPWORDS = {
    "The", "A", "An", "This", "That", "Our", "My", "His", "Her", "Their", "We", "He",
    "She", "It", "In", "At", "On", "Of", "To", "And", "But", "Then", "When", "After",
}

# ── 도로 주소 ─────────────────────────────────────────────────────
# 123 Maple Street · 45 Oak Avenue
_ADDRESS = re.compile(
    r"\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way)\b\.?"
)


def _strip_leading_stopwords(value: str) -> str:
    words = value.split(" ")
    while len(words) > 1 and words[0] in _ORG_LEADING_STOPWORDS:
        words = words[1:]
    return " ".join(words)


def detect_english_pii(text: str) -> list[tuple[str, str]]:
    """텍스트에서 로컬로 확실히 잡을 수 있는 영어 PII를 [(원문, 종류)]로 돌려준다."""
    found: dict[str, str] = {}

    def add(value: str, kind: str) -> None:
        value = value.strip().rstrip(".")
        if value and value not in found:
            found[value] = kind

    for m in _PHONE.finditer(text):
        add(m.group(), "phone")
    for m in _SSN_SHAPED.finditer(text):
        add(m.group(), "ssn")
    for m in _SSN_ANCHORED.finditer(text):
        add(m.group(1), "ssn")

    for pattern in (_PERSON_KINSHIP, _PERSON_TITLE, _PERSON_COPULA):
        for m in pattern.finditer(text):
            name = m.group(1)
            first = name.split(" ")[0]
            if first in _NOT_A_NAME:
                continue
            add(name, "person")

    for m in _ORG.finditer(text):
        add(_strip_leading_stopwords(m.group()), "place")
    for m in _ADDRESS.finditer(text):
        add(m.group(), "place")

    return list(found.items())
