"""양방향 치유 v1 (Pattern 1) — 한마디→발화연습 변환 엔드포인트 모델.

보호자의 "지금 듣고 싶은 한마디"(caregiverWishMessage) 1문장을 받아
환자 발화 연습 콘텐츠로 변환한다 (H3):
  (a) echo_sentence — 따라말하기용 (한마디 그대로)
  (b) fill_blank    — 핵심 명사 1개를 빈칸 처리한 빈칸 채우기
"""
from pydantic import BaseModel, ConfigDict, Field, field_validator


class WishToPracticeRequest(BaseModel):
    """POST /wish/to-practice 요청 모델."""

    model_config = ConfigDict(extra="ignore")

    wish_message: str = Field(min_length=1, max_length=120)

    @field_validator("wish_message")
    @classmethod
    def _strip_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("wish_message는 빈 문자열일 수 없습니다")
        return v.strip()


class FillBlankOut(BaseModel):
    """빈칸 채우기 1문항 (한마디 기반)."""

    prompt: str  # 빈칸(___) 포함 문장
    answer: str  # 빈칸 정답(핵심 명사)
    hint_first_char: str  # 정답 첫 글자 힌트


class WishToPracticeResponse(BaseModel):
    """POST /wish/to-practice 응답 모델."""

    echo_sentence: str  # 따라말하기용 문장
    fill_blank: FillBlankOut  # 빈칸 채우기 문항
    model: str  # 사용 모델명
    fallback_used: bool = False  # 빈칸을 규칙 기반 폴백으로 만들었는지
