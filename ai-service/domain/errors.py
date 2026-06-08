"""
도메인 에러 계층 정의.
모든 AI 서비스 에러는 AiServiceError를 최상위 부모로 상속한다.
"""


class AiServiceError(Exception):
    """AI 서비스 최상위 에러."""


# 이미지 태깅 관련 에러
class ImageDecodeError(AiServiceError):
    """Base64 이미지 디코딩 실패."""


class ImageSizeError(AiServiceError):
    """이미지 크기가 허용 범위(5MB)를 초과."""


class TagParseError(AiServiceError):
    """Gemini Vision 응답 JSON 파싱 실패."""


# 텍스트 마스킹 관련 에러
class TextTooLongError(AiServiceError):
    """입력 텍스트가 최대 허용 길이(5000자)를 초과."""


class ResidualPiiError(AiServiceError):
    """마스킹 후에도 원본 개인정보가 텍스트에 잔존."""


# 시나리오 생성 관련 에러
class EmptyTargetWordsError(AiServiceError):
    """목표 단어 목록이 비어 있음."""


class ScenarioGuardrailError(AiServiceError):
    """Guardrail 위반이 최대 재시도(2회) 초과."""


# 데일리 퀴즈 생성 관련 에러
class InvalidPatientNotesError(AiServiceError):
    """patient_notes가 0개이거나 합본 글자 수가 10자 미만."""


class QuizGenerationTimeoutError(AiServiceError):
    """Gemini 응답이 제한 시간(25초)을 초과."""


class QuizParseError(AiServiceError):
    """Gemini 응답을 2회 시도 후에도 JSON으로 파싱 실패.

    서비스 내부에서 가드 2(규칙 기반 폴백)로 흡수되므로 라우터까지 전파되지 않는다.
    방어적으로 정의만 해 둔다.
    """


# 양방향 치유 v1 (Pattern 1) — 한마디→발화연습 변환 관련 에러
class WishConversionError(AiServiceError):
    """한마디(wish) 입력이 비었거나 금칙어를 포함해 변환 불가."""


# 대화 에이전트 관련 에러
class GuardrailViolationError(AiServiceError):
    """Gemini 응답에 금지 단어(guardrail_words) 포함 감지."""


class SessionNotFoundError(AiServiceError):
    """요청한 session_id에 해당하는 대화 세션 없음."""


class InvalidHintLevelError(AiServiceError):
    """hint_level이 허용 범위(0~2)를 벗어남."""


# 외부 API 에러
class GeminiApiError(AiServiceError):
    """Gemini API 호출 중 오류 발생."""
