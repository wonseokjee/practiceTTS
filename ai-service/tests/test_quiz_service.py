"""데일리 퀴즈 생성 서비스(QuizGeneratorService) 단위 테스트.

Feature Plan(20260601_DailyQuiz_Phase2_feature_plan.md) §8 의 Given-When-Then
명세(TC-Q1 ~ TC-Q8)를 그대로 구현한다.

테스트 더블 전략:
  - ILlmClient 를 구현한 FakeLlmClient(stub) 를 생성자 주입해 결정적으로 테스트한다.
  - 실제 Gemini/네트워크 호출은 일절 하지 않는다.
  - 타임아웃 케이스는 _LLM_TIMEOUT_SECONDS 모듈 상수를 monkeypatch 로 낮추고
    FakeLlmClient 가 지연(delay)을 흉내내도록 구성한다.

모든 테스트는 AAA(Arrange-Act-Assert) 패턴을 따른다.
"""
import asyncio
import json
import logging

import pytest

from domain.errors import (
    GeminiApiError,
    InvalidPatientNotesError,
    QuizGenerationTimeoutError,
)
from interfaces.llm_client import ILlmClient
from models.quiz import (
    PatientNoteIn,
    QuizDistribution,
    QuizGenerateRequest,
)
from services import quiz_service
from services.quiz_service import QuizGeneratorService


# ======================================================================
# 테스트 더블: FakeLlmClient (ILlmClient stub)
# ======================================================================
class FakeLlmClient(ILlmClient):
    """결정적 동작을 하는 ILlmClient 스텁.

    - raw   : complete() 가 항상 반환할 단일 문자열
    - raws  : 호출 순서대로 반환할 문자열 리스트 (재시도 시나리오)
    - error : complete() 호출 시 raise 할 예외 (GeminiApiError 등)
    - delay : complete() 가 응답 전 대기할 시간(초) — 타임아웃 시뮬레이션
    호출될 때마다 전달된 (messages, model, kwargs) 를 captured 에 기록한다.
    """

    def __init__(self, *, raw=None, raws=None, error=None, delay=0.0):
        self._raw = raw
        self._raws = list(raws) if raws is not None else None
        self._error = error
        self._delay = delay
        self.call_count = 0
        self.captured_messages: list[list[dict]] = []
        self.captured_kwargs: list[dict] = []

    async def complete(self, messages, model, **kwargs) -> str:
        self.call_count += 1
        self.captured_messages.append(messages)
        self.captured_kwargs.append(kwargs)

        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error is not None:
            raise self._error

        if self._raws is not None:
            # 호출 순서대로 반환, 리스트 소진 시 마지막 값을 반복 반환
            idx = min(self.call_count - 1, len(self._raws) - 1)
            return self._raws[idx]
        return self._raw if self._raw is not None else "{}"

    async def complete_with_vision(self, *args, **kwargs) -> str:
        raise NotImplementedError("퀴즈 생성은 vision을 사용하지 않습니다")


# ======================================================================
# 공통 픽스처 / 헬퍼
# ======================================================================
def make_request(**overrides) -> QuizGenerateRequest:
    """정상 QuizGenerateRequest 빌더 (patient_notes 합본 >= 10자)."""
    data = {
        "patient_notes": [
            {"category": "activity", "answer_text": "공원에서 산책했어요"},
            {"category": "moment", "answer_text": "손녀와 사과를 먹었어요"},
            {"category": "context", "answer_text": "날씨가 맑았어요"},
        ],
    }
    data.update(overrides)
    return QuizGenerateRequest(**data)


def valid_five_questions_json() -> str:
    """mc2 + yn2 + fb1 = 5문제 유효 JSON.

    correct_answer 들은 make_request() 의 patient_notes 합본에 부분 일치하도록 구성
    (가드 3 부분일치 검사 통과 보장).
    """
    payload = {
        "questions": [
            {
                "type": "multiple_choice",
                "prompt": "어디에서 산책했나요?",
                "choices": ["공원", "학교", "시장", "병실"],
                "correct_answer": "공원",
            },
            {
                "type": "multiple_choice",
                "prompt": "무엇을 먹었나요?",
                "choices": ["사과", "포도", "수박", "참외"],
                "correct_answer": "사과",
            },
            {
                "type": "yes_no",
                "prompt": "산책을 했나요?",
                "correct_answer": "yes",
            },
            {
                "type": "yes_no",
                "prompt": "비가 왔나요?",
                "correct_answer": "no",
            },
            {
                "type": "fill_blank",
                "prompt": "손녀와 ___를 먹었어요.",
                "correct_answer": "사과",
                "hint_first_char": "사",
            },
        ]
    }
    return json.dumps(payload, ensure_ascii=False)


# ======================================================================
# TC-Q1: 정상 생성
# ======================================================================
class TestTCQ1정상생성:
    """Given 유효 5문제 JSON + 정상 요청 / When generate_quiz / Then 5문제 반환."""

    async def test_5문제를_반환하고_재시도없이_1회_호출한다(self):
        # Arrange
        fake = FakeLlmClient(raw=valid_five_questions_json())
        service = QuizGeneratorService(fake)
        request = make_request()

        # Act
        response = await service.generate_quiz(request)

        # Assert
        assert len(response.questions) == 5
        assert response.model == "gemini-2.5-flash-lite"
        assert fake.call_count == 1  # 재시도 없음
        assert response.fallback_used is False

    async def test_multiple_choice_문제는_choices4개이고_정답이_choices에_포함된다(self):
        # Arrange
        service = QuizGeneratorService(FakeLlmClient(raw=valid_five_questions_json()))

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        mc_questions = [q for q in response.questions if q.type == "multiple_choice"]
        assert len(mc_questions) == 2
        for q in mc_questions:
            assert q.choices is not None
            assert len(q.choices) == 4
            assert q.correct_answer in q.choices

    async def test_fill_blank_문제의_hint_first_char는_정답_첫글자다(self):
        # Arrange
        service = QuizGeneratorService(FakeLlmClient(raw=valid_five_questions_json()))

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        fb_questions = [q for q in response.questions if q.type == "fill_blank"]
        assert len(fb_questions) >= 1
        for q in fb_questions:
            assert q.hint_first_char == q.correct_answer.replace(" ", "")[0]

    async def test_yes_no_문제의_정답은_yes_또는_no다(self):
        # Arrange
        service = QuizGeneratorService(FakeLlmClient(raw=valid_five_questions_json()))

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        yn_questions = [q for q in response.questions if q.type == "yes_no"]
        for q in yn_questions:
            assert q.correct_answer in {"yes", "no"}
            assert q.choices is None


# ======================================================================
# TC-Q2: LLM 타임아웃 → QuizGenerationTimeoutError
# ======================================================================
class TestTCQ2타임아웃:
    """Given LLM 응답이 제한 시간 초과 / When generate_quiz / Then 타임아웃 에러."""

    async def test_제한시간_초과시_QuizGenerationTimeoutError를_던진다(self, monkeypatch):
        # Arrange: 타임아웃 임계값을 0.1초로 낮추고 LLM 지연을 0.5초로 설정
        monkeypatch.setattr(quiz_service, "_LLM_TIMEOUT_SECONDS", 0.1)
        fake = FakeLlmClient(raw=valid_five_questions_json(), delay=0.5)
        service = QuizGeneratorService(fake)

        # Act / Assert
        with pytest.raises(QuizGenerationTimeoutError):
            await service.generate_quiz(make_request())


# ======================================================================
# TC-Q3: JSON 깨짐 → temperature=0 재시도 / 폴백
# ======================================================================
class TestTCQ3JSON깨짐:
    """가드 1(재시도) + 가드 2(폴백) 동작 검증."""

    async def test_3a_1차깨짐_2차정상이면_재시도로_5문제_생성하고_2회호출한다(self):
        # Arrange: 1차는 깨진 텍스트, 2차는 정상 JSON
        fake = FakeLlmClient(raws=["이건 JSON이 아닙니다 그냥 텍스트", valid_five_questions_json()])
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        assert len(response.questions) == 5
        assert fake.call_count == 2  # 가드 1 재시도 발생
        # 2차 호출은 temperature=0 으로 이뤄져야 한다
        assert fake.captured_kwargs[1]["generation_config"]["temperature"] == 0.0

    async def test_3b_2회모두깨지면_규칙기반_빈칸폴백으로_5문제를_채운다(self):
        # Arrange: 1차/2차 모두 파싱 불가
        fake = FakeLlmClient(raws=["깨진 텍스트", "또 깨짐 {불완전"])
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        assert len(response.questions) == 5
        assert fake.call_count == 2
        assert all(q.type == "fill_blank" for q in response.questions)  # 전량 폴백
        assert response.fallback_used is True

    async def test_3b_폴백문제도_예외없이_200정상응답이다(self):
        # Arrange
        service = QuizGeneratorService(FakeLlmClient(raws=["x", "y"]))

        # Act (예외가 발생하지 않아야 함)
        response = await service.generate_quiz(make_request())

        # Assert
        assert response is not None
        assert len(response.questions) == 5


# ======================================================================
# TC-Q4: 금칙어 필터 (가드 4)
# ======================================================================
class TestTCQ4금칙어:
    """Given 금칙어 포함 문제 / When generate_quiz / Then 제거 후 폴백 보충."""

    async def test_금칙어_포함_문제는_제거되고_최종응답에_금칙어가_없다(self):
        # Arrange: 5문제 중 1문제 prompt 에 금칙어 "사고" 포함
        payload = json.loads(valid_five_questions_json())
        payload["questions"][0]["prompt"] = "교통사고가 있었나요?"
        payload["questions"][0]["correct_answer"] = "공원"  # 부분일치는 통과하도록
        fake = FakeLlmClient(raw=json.dumps(payload, ensure_ascii=False))
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert: 길이는 여전히 5 (제거분은 폴백으로 보충), 어디에도 "사고" 미포함
        assert len(response.questions) == 5
        for q in response.questions:
            assert "사고" not in q.prompt
            assert "사고" not in q.correct_answer
            for choice in q.choices or []:
                assert "사고" not in choice
        assert response.fallback_used is True


# ======================================================================
# TC-Q5: 문장 길이 초과 절단 (가드 5)
# ======================================================================
class TestTCQ5길이초과:
    """Given 30자 초과 prompt / When generate_quiz / Then 30자로 절단 + 경고 로깅."""

    async def test_30자_초과_prompt는_30자로_절단된다(self):
        # Arrange: prompt 45자 (정답은 합본 부분일치 통과하도록 유지)
        long_prompt = "오늘 " + "가" * 45 + " 무엇을 했나요?"
        payload = json.loads(valid_five_questions_json())
        payload["questions"][1]["prompt"] = long_prompt
        fake = FakeLlmClient(raw=json.dumps(payload, ensure_ascii=False))
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert
        assert all(len(q.prompt) <= 30 for q in response.questions)

    async def test_길이_초과시_경고_로그를_남긴다(self, caplog):
        # Arrange
        long_prompt = "나" * 50
        payload = json.loads(valid_five_questions_json())
        payload["questions"][1]["prompt"] = long_prompt
        service = QuizGeneratorService(
            FakeLlmClient(raw=json.dumps(payload, ensure_ascii=False))
        )

        # Act
        with caplog.at_level(logging.WARNING):
            await service.generate_quiz(make_request())

        # Assert
        assert any("절단" in rec.message for rec in caplog.records)


# ======================================================================
# TC-Q6: 보호자 사적 데이터 미포함 보장 (★ 핵심 보안 회귀 테스트)
# ======================================================================
class TestTCQ6보호자데이터미포함:
    """요청에 보호자 필드를 넣어도 모델/프롬프트 어디에도 진입하지 못함을 보장."""

    def test_요청모델에_보호자_필드_자체가_존재하지_않는다(self):
        # Arrange & Act: 보호자 필드를 끼워넣어 생성 (extra="ignore"로 무시되어야 함)
        request = QuizGenerateRequest(
            patient_notes=[{"category": "activity", "answer_text": "공원에서 산책했어요"}],
            mood=2,
            caregiver_reflection="오늘 힘들었다",
            caregiver_wish_message="사랑해",
        )

        # Assert: 속성 자체가 존재하지 않아야 한다
        assert not hasattr(request, "mood")
        assert not hasattr(request, "caregiver_reflection")
        assert not hasattr(request, "caregiver_wish_message")

    async def test_LLM에_전달되는_프롬프트에_보호자_텍스트가_포함되지_않는다(self):
        # Arrange
        request = QuizGenerateRequest(
            patient_notes=[
                {"category": "activity", "answer_text": "공원에서 산책했어요"},
                {"category": "moment", "answer_text": "손녀와 사과를 먹었어요"},
            ],
            mood=2,
            caregiver_reflection="오늘 힘들었다",
            caregiver_wish_message="사랑해",
        )
        fake = FakeLlmClient(raw=valid_five_questions_json())
        service = QuizGeneratorService(fake)

        # Act
        await service.generate_quiz(request)

        # Assert: complete()에 전달된 messages 전체 문자열에 보호자 텍스트 부재
        all_sent_text = json.dumps(fake.captured_messages, ensure_ascii=False)
        assert "오늘 힘들었다" not in all_sent_text
        assert "사랑해" not in all_sent_text


# ======================================================================
# TC-Q7: 입력 검증 (보강)
# ======================================================================
class TestTCQ7입력검증:
    """note 0개 / 합본 < 10자 → InvalidPatientNotesError."""

    async def test_patient_notes가_비면_Pydantic이_먼저_거부한다(self):
        # Arrange & Act / Assert: min_length=1 위반 → Pydantic ValidationError
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            QuizGenerateRequest(patient_notes=[])

    async def test_합본이_10자_미만이면_InvalidPatientNotesError를_던진다(self):
        # Arrange: 합본 "안녕" = 2자 (< 10자)
        request = make_request(
            patient_notes=[{"category": "activity", "answer_text": "안녕"}]
        )
        service = QuizGeneratorService(FakeLlmClient(raw=valid_five_questions_json()))

        # Act / Assert
        with pytest.raises(InvalidPatientNotesError):
            await service.generate_quiz(request)

    async def test_합본이_정확히_10자면_통과한다_경계값(self):
        # Arrange: 합본 정확히 10자
        request = make_request(
            patient_notes=[{"category": "activity", "answer_text": "가나다라마바사아자차"}]
        )
        service = QuizGeneratorService(FakeLlmClient(raw=valid_five_questions_json()))

        # Act
        response = await service.generate_quiz(request)

        # Assert: 검증 통과 → 정상 응답
        assert len(response.questions) == 5


# ======================================================================
# TC-Q8: 환각 부분일치 제거 (보강, 가드 3)
# ======================================================================
class TestTCQ8부분일치:
    """correct_answer가 메모 합본에 없으면 제거 후 폴백 보충."""

    async def test_정답이_메모에_없으면_제거되고_폴백으로_보충된다(self):
        # Arrange: mc 문제의 정답을 메모에 없는 "비행기"로 변경 (환각 시뮬레이션)
        payload = json.loads(valid_five_questions_json())
        payload["questions"][0]["choices"] = ["비행기", "기차", "버스", "택시"]
        payload["questions"][0]["correct_answer"] = "비행기"  # 합본에 없음
        fake = FakeLlmClient(raw=json.dumps(payload, ensure_ascii=False))
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert: "비행기" 문제는 제거, 길이는 폴백으로 5 유지
        assert len(response.questions) == 5
        assert not any(q.correct_answer == "비행기" for q in response.questions)
        assert response.fallback_used is True

    async def test_정답이_메모에_있으면_유지된다(self):
        # Arrange: 정답 "공원"은 make_request 메모에 존재
        fake = FakeLlmClient(raw=valid_five_questions_json())
        service = QuizGeneratorService(fake)

        # Act
        response = await service.generate_quiz(make_request())

        # Assert: 부분일치 통과 → 폴백 없이 5문제
        assert response.fallback_used is False
        assert any(q.correct_answer == "공원" for q in response.questions)


# ======================================================================
# 추가: GeminiApiError 전파 (라우터 502 매핑 근거)
# ======================================================================
class TestLLM호출실패:
    """LLM 호출 자체가 실패하면 GeminiApiError를 폴백으로 흡수하지 않고 전파한다."""

    async def test_GeminiApiError는_그대로_전파된다(self):
        # Arrange
        fake = FakeLlmClient(error=GeminiApiError("업스트림 오류"))
        service = QuizGeneratorService(fake)

        # Act / Assert
        with pytest.raises(GeminiApiError):
            await service.generate_quiz(make_request())
