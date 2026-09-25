"""영어 마스킹 홀드아웃 — 감지기를 만든 뒤 **튜닝하지 않고** 한 번만 재는 별도 문장 묶음.

`masking_corpus_en.py`는 감지기를 만들 때 봤다(튜닝 대상). 이 파일은 같은 작성자가 쓰되 감지기
규칙을 보지 않고 다른 표현으로 썼다. 여기서 실패한 문장을 고치려고 감지기를 손보면 이 파일도
튜닝 세트가 된다 — 그때는 새 홀드아웃을 써야 한다.
"""

MUST_MASK = [
    ("You can reach him on (646) 555-0188 after lunch", "555-0188"),
    ("The office line is 718.555.0142", "555.0142"),
    ("Grandma's cell: +1 (305) 555-0170", "555-0170"),
    ("Her social is 987-65-4321, keep it safe", "4321"),
    ("Send the forms to margaret_o.brien@outlook.com", "margaret_o.brien@outlook.com"),
    ("Our neighbor Walter fixed the fence", "Walter"),
    ("My wife Patricia sang in the choir", "Patricia"),
    ("His grandson named Oliver loved trains", "Oliver"),
    ("Dr. Nguyen said the scan looked fine", "Nguyen"),
    ("Ms. Fitzgerald ran the front desk", "Fitzgerald"),
    ("He was born at Mercy General Hospital", "Mercy"),
    ("She taught at Jefferson High School for thirty years", "Jefferson"),
    ("They rented 782 Willow Lane for a summer", "Willow"),
    ("The old house on 19 Birch Road was sold", "Birch"),
]

MUST_NOT_MASK = [
    "In the summer of 1962 we drove to the lake",
    "The train fare was $12 each way",
    "She turned 90 last spring",
    "Chapter 4 was her favorite",
    "We sang carols every December",
    "He liked to will himself out of bed early",
    "Faith kept her going through the hard years",
    "My daughter called on Monday",
    "The nurse was kind and patient",
    "Her husband worked at the plant",
    "We walked to the library after school",
    "It cost 2000 won in Seoul back then",
]
