"""get_quiz_generator_service 의존성 팩토리 테스트 (QA-1).

GEMINI_API_KEY 미설정 시 처리되지 않은 500 대신 구조화된 503(LLM_NOT_CONFIGURED)을
반환하는지 검증한다.
"""
import pytest
from fastapi import HTTPException

import dependencies
from services.quiz_service import QuizGeneratorService


@pytest.fixture(autouse=True)
def _reset_singletons():
    """각 테스트가 깨끗한 싱글턴 상태에서 시작하도록 모듈 전역을 초기화한다."""
    dependencies._gemini_client = None
    dependencies._quiz_generator_service = None
    yield
    dependencies._gemini_client = None
    dependencies._quiz_generator_service = None


def test_키없으면_503_LLM_NOT_CONFIGURED를_던진다(monkeypatch):
    # Arrange: 키 제거
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    # Act / Assert
    with pytest.raises(HTTPException) as exc_info:
        dependencies.get_quiz_generator_service()

    assert exc_info.value.status_code == 503
    assert "LLM_NOT_CONFIGURED" in str(exc_info.value.detail)


def test_키가_있으면_서비스를_정상_반환한다(monkeypatch):
    # Arrange: 더미 키 (genai.configure는 네트워크 호출 없음)
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key-for-test")

    # Act
    service = dependencies.get_quiz_generator_service()

    # Assert
    assert isinstance(service, QuizGeneratorService)
