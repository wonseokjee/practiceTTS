"""데일리 퀴즈 생성 엔드포인트 요청/응답 Pydantic 모델.

보안 불변식: 본 요청 모델에는 보호자 사적 데이터 필드
(mood, caregiver_reflection, caregiver_wish_message)가 존재하지 않는다.
Pydantic extra="ignore"로 알 수 없는 필드는 무시되어, 상위(NestJS)가 실수로
보호자 데이터를 보내더라도 모델로 진입조차 하지 못한다 (§14-3 보안 가드).
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 퀴즈 문제 유형
QuizType = Literal["multiple_choice", "yes_no", "fill_blank"]
# 환자 메모 카테고리
NoteCategory = Literal["activity", "moment", "context"]


class PatientNoteIn(BaseModel):
    """환자 관련 카테고리별 메모 (퀴즈 생성의 유일한 텍스트 입력)."""

    model_config = ConfigDict(extra="ignore")

    category: NoteCategory
    answer_text: str = Field(min_length=1)

    @field_validator("answer_text")
    @classmethod
    def _strip_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("answer_text는 빈 문자열일 수 없습니다")
        return v.strip()


class PhotoTagsIn(BaseModel):
    """사진 태그 (선택, R7(b) 진입 시 NestJS가 /tag 결과를 병합해 전달)."""

    model_config = ConfigDict(extra="ignore")

    location: str | None = None
    objects: list[str] = Field(default_factory=list)


class QuizDistribution(BaseModel):
    """문제 유형별 개수. 기본 4지선다 2 + 예/아니오 2 + 빈칸 1 = 5."""

    model_config = ConfigDict(extra="ignore")

    multiple_choice: int = 2
    yes_no: int = 2
    fill_blank: int = 1

    @property
    def total(self) -> int:
        """전체 문제 수 (= 응답 questions 길이)."""
        return self.multiple_choice + self.yes_no + self.fill_blank


class QuizGenerateRequest(BaseModel):
    """POST /quiz/generate 요청 모델.

    중요: mood / caregiver_reflection / caregiver_wish_message 필드는
    의도적으로 존재하지 않는다 (§14-3 보안 가드). extra="ignore"로
    상위가 실수로 전달해도 모델 진입 단계에서 무시된다.
    """

    model_config = ConfigDict(extra="ignore")

    patient_notes: list[PatientNoteIn] = Field(min_length=1)
    photo_tags: PhotoTagsIn | None = None
    target_words: list[str] = Field(default_factory=list)
    distribution: QuizDistribution = Field(default_factory=QuizDistribution)


class QuizQuestionOut(BaseModel):
    """생성된 1개 문제 (응답 단위). 불변식 I1~I5는 서비스에서 보장."""

    type: QuizType
    prompt: str
    choices: list[str] | None = None
    correct_answer: str
    hint_first_char: str | None = None


class QuizLLMResponse(BaseModel):
    """LLM 구조화 출력(JSON 모드) 강제용 스키마.

    Gemini에 response_schema로 넘겨, 모델이 이 형식({"questions":[...]})의 유효
    JSON만 반환하도록 강제한다. 코드펜스·군더더기·깨진 JSON을 원천 차단해 파싱
    실패·재시도를 없앤다. **형식만** 보장하며, 의미 불변식(I1~I5: 정답이 보기 안에
    있는지 등)은 여전히 QuizService._sanitize가 검증한다.
    """

    questions: list[QuizQuestionOut]


class QuizGenerateResponse(BaseModel):
    """POST /quiz/generate 응답 모델."""

    questions: list[QuizQuestionOut]
    model: str  # 실제 사용 모델명 (예: "gemini-1.5-flash")
    elapsed_ms: int
    fallback_used: bool = False  # 규칙 기반 폴백 보충이 발생했는지 여부 (Q-F)
