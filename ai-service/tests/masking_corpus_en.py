"""영어 메모 마스킹 정확도 측정용 코퍼스 (en-US).

한국어 코퍼스(`masking_corpus.py`)와 같은 규칙이다 — **수정 전에 쓴다.** 고친 뒤에 예시를
고르면 통과할 문장만 담게 된다. 미탐(leak)과 과탐(false positive)을 함께 잰다.

영어 회상 노트의 특징(미국 가구, 영어 보호자가 쓴 메모):
  - 전화는 (212) 555-0123 / 212-555-0123 / +1 형태. 한국 규칙(국번 0 접두)으로는 안 잡힌다.
  - SSN은 123-45-6789. 한국 주민번호 규칙(6-7)과 모양이 다르다.
  - 이름은 앵커(관계어·호칭·`name is`)가 있을 때만 로컬에서 확실히 잡는다.
  - 과탐 함정: Hope·Will·Mark·Grace처럼 일반어인 이름, 연도·연도 범위·금액.
"""

# (문장, 반드시 사라져야 하는 부분문자열)
MUST_MASK = [
    # 전화번호
    ("Call me at (212) 555-0123 tonight", "555-0123"),
    ("My cell is 212-555-0123.", "555-0123"),
    ("212.555.0123 works too", "555.0123"),
    ("Her number is +1 212 555 0123 if you need it", "555 0123"),
    ("Try 1-800-555-0199 for the pharmacy", "555-0199"),
    ("Her phone is 2125550123 now", "2125550123"),
    # SSN
    ("His SSN is 123-45-6789", "6789"),
    ("Social security number 123 45 6789 was on the form", "6789"),
    ("SSN: 123456789", "123456789"),
    # 이메일
    ("Email me at jane.doe@gmail.com please", "jane.doe@gmail.com"),
    ("bob_smith99@yahoo.com works best", "bob_smith99@yahoo.com"),
    # 인명 — 관계어 + 이름
    ("My son Michael came by on Sunday", "Michael"),
    ("Her husband Robert Miller loved fishing", "Miller"),
    ("Our daughter named Emily called", "Emily"),
    ("His mother Dorothy loved gardening", "Dorothy"),
    ("My brother Thomas served in the army", "Thomas"),
    # 인명 — 호칭
    ("Mr. Johnson was our neighbor", "Johnson"),
    ("Dr. Patel treated him for years", "Patel"),
    ("Mrs. Alvarez taught him piano", "Alvarez"),
    # 인명 — name is / called
    ("Her name is Susan Clark", "Clark"),
    ("The nurse was called Angela", "Angela"),
    # 기관명
    ("He worked at St. Mary's Hospital", "Mary"),
    ("She went to Lincoln Elementary School", "Lincoln"),
    ("We joined Grace Baptist Church in 1970", "Baptist"),
    # 주소
    ("We lived at 123 Maple Street back then", "Maple"),
    ("Their house was 45 Oak Avenue", "Oak"),
]

# 절대 가려지면 안 되는 것 (과탐 측정)
MUST_NOT_MASK = [
    # 연도·연도 범위·연대
    "1950-1953 during the Korean War",
    "He was sick between 2020-2024",
    "She was born in 1953",
    "We watched the 1988 Olympics",
    "Music from the 1950s was her favorite",
    # 금액·수량
    "The car cost $1,500 back then",
    "Rent was $250 a month",
    "We had five children and she was the second",
    "It was room 201 on the third floor",
    "Take Route 66 all the way west",
    # 이름이기도 한 일반어 (앵커 없음)
    "I hope you can come on Sunday",
    "He will visit next week",
    "Please mark the date on the calendar",
    "Grace under pressure was his motto",
    "It was a bright day in May",
    "The rose garden was her pride",
    # 관계어 자체는 이름이 아니다
    "My son came by on Sunday",
    "Her husband loved fishing",
    "The grandchildren visit often",
    # 기관·장소를 일반명사로 쓴 것
    "The hospital was near the river",
    "We went to church every Sunday",
    "The school had a big playground",
    "He walked down the street to the bank",
]
