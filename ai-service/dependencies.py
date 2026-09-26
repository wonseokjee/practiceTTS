"""
의존성 주입 팩토리 (Composition Root).
싱글턴 인스턴스를 생성하고 각 서비스에 주입한다.

패턴: 모듈 수준 변수로 싱글턴 보장 (FastAPI 프로세스 생존 기간 동안 유지).
구현체 교체 시 이 파일의 팩토리 함수만 수정하면 된다.
"""
import os
import secrets

from fastapi import Depends, Header, HTTPException, Request, status

from infra.azure_pronunciation import AzurePronunciationAssessor
from infra.azure_stt import AzureSttEngine
from infra.azure_tts import AzureTtsEngine
from infra.gemini_client import GeminiClient
from infra.in_memory_masking_store import InMemoryMaskingStore
from infra.in_memory_vector_store import InMemoryVectorStore
from infra.rate_limiter import SlidingWindowRateLimiter
from services.chat_service import ChatService
from services.competitor_service import CompetitorService
from services.masking_service import MaskingService
from services.pronunciation_service import PronunciationService
from services.quiz_service import QuizGeneratorService
from services.scenario_service import ScenarioService
from services.stt_service import SttService
from services.tagging_service import TaggingService
from services.tts_service import TtsService
from services.wish_service import WishToPracticeService

# 싱글턴 인스턴스 초기화
_gemini_client: GeminiClient | None = None
_vector_store: InMemoryVectorStore | None = None
_masking_store: InMemoryMaskingStore | None = None

_tagging_service: TaggingService | None = None
_masking_service: MaskingService | None = None
_scenario_service: ScenarioService | None = None
_chat_service: ChatService | None = None
_quiz_generator_service: QuizGeneratorService | None = None
_wish_service: WishToPracticeService | None = None
_stt_service: SttService | None = None
_tts_service: TtsService | None = None
_pronunciation_service: PronunciationService | None = None

_tts_rate_limiter: SlidingWindowRateLimiter | None = None
_stt_rate_limiter: SlidingWindowRateLimiter | None = None
_pronunciation_rate_limiter: SlidingWindowRateLimiter | None = None

# 기본 캐시 상한 200MB. 재활 문장은 짧아(수 KB/개) 수만 개까지 캐시 가능.
_DEFAULT_TTS_CACHE_MAX_BYTES = 200 * 1024 * 1024


def _get_gemini_client() -> GeminiClient:
    """GeminiClient 싱글턴 반환."""
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY", "")
        _gemini_client = GeminiClient(api_key=api_key)
    return _gemini_client


def _get_vector_store() -> InMemoryVectorStore:
    """InMemoryVectorStore 싱글턴 반환."""
    global _vector_store
    if _vector_store is None:
        _vector_store = InMemoryVectorStore()
    return _vector_store


def _get_masking_store() -> InMemoryMaskingStore:
    """InMemoryMaskingStore 싱글턴 반환."""
    global _masking_store
    if _masking_store is None:
        _masking_store = InMemoryMaskingStore()
    return _masking_store


# ─── 서비스 간 인증 ────────────────────────────────────────────


def require_service_token(x_service_token: str = Header(default="")) -> None:
    """백엔드만 호출할 수 있는 엔드포인트를 지키는 공유 토큰 검사.

    이 서비스는 외부 LLM(Gemini)과 Azure를 호출한다. 인증이 없으면 포트에
    닿는 누구나 남의 API 할당량을 태우고, /mask에 임의 텍스트를 넣어
    외부 LLM으로 흘려보낼 수 있다. 의료 성격 데이터라 후자가 특히 문제다.

    브라우저가 직접 부르는 /stt·/tts에는 걸지 않는다 — 브라우저에 심은
    토큰은 비밀이 아니기 때문이다. 그쪽은 레이트리밋으로 막고 있고,
    근본 해결은 백엔드 프록시로 옮기는 것이다(별도 과제).

    토큰이 설정돼 있지 않으면 **막는다**. 설정을 잊었을 때 조용히 열린
    상태로 남는 편이 훨씬 위험하다.
    """
    expected = os.getenv("AI_SERVICE_TOKEN", "")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_SERVICE_TOKEN이 설정되지 않아 요청을 처리할 수 없습니다.",
        )
    # 타이밍 공격 방지를 위해 상수 시간 비교를 쓴다.
    if not secrets.compare_digest(x_service_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="서비스 토큰이 올바르지 않습니다.",
        )


# FastAPI Depends() 주입 함수들


def get_tagging_service() -> TaggingService:
    """TaggingService 싱글턴 반환 (FastAPI Depends 용)."""
    global _tagging_service
    if _tagging_service is None:
        _tagging_service = TaggingService(llm_client=_get_gemini_client())
    return _tagging_service


def get_masking_service() -> MaskingService:
    """MaskingService 싱글턴 반환 (FastAPI Depends 용)."""
    global _masking_service
    if _masking_service is None:
        _masking_service = MaskingService(
            llm_client=_get_gemini_client(),
            masking_store=_get_masking_store(),
        )
    return _masking_service


def get_scenario_service() -> ScenarioService:
    """ScenarioService 싱글턴 반환 (FastAPI Depends 용)."""
    global _scenario_service
    if _scenario_service is None:
        _scenario_service = ScenarioService(
            llm_client=_get_gemini_client(),
            vector_store=_get_vector_store(),
        )
    return _scenario_service


def get_chat_service() -> ChatService:
    """ChatService 싱글턴 반환 (FastAPI Depends 용)."""
    global _chat_service
    if _chat_service is None:
        _chat_service = ChatService(
            llm_client=_get_gemini_client(),
            vector_store=_get_vector_store(),
        )
    return _chat_service


def get_quiz_generator_service() -> QuizGeneratorService:
    """QuizGeneratorService 싱글턴 반환 (FastAPI Depends 용).

    GEMINI_API_KEY 미설정 시 GeminiClient 생성자가 ValueError를 던지는데,
    그대로 두면 의존성 주입 단계에서 처리되지 않은 500이 발생한다.
    이를 구조화된 503(LLM_NOT_CONFIGURED)으로 변환해, 상위(NestJS)와 운영자가
    '일시적 LLM 오류'가 아니라 '서비스 미구성'임을 구분할 수 있게 한다.
    """
    global _quiz_generator_service
    if _quiz_generator_service is None:
        try:
            _quiz_generator_service = QuizGeneratorService(
                llm_client=_get_gemini_client(),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"LLM_NOT_CONFIGURED: {exc}",
            ) from exc
    return _quiz_generator_service


def get_wish_service() -> WishToPracticeService:
    """WishToPracticeService 싱글턴 반환 (FastAPI Depends 용).

    quiz와 동일하게 GEMINI_API_KEY 부재 시 503(LLM_NOT_CONFIGURED)으로 변환한다.
    """
    global _wish_service
    if _wish_service is None:
        try:
            _wish_service = WishToPracticeService(llm_client=_get_gemini_client())
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"LLM_NOT_CONFIGURED: {exc}",
            ) from exc
    return _wish_service


def get_stt_service() -> SttService:
    """SttService 싱글턴 반환 (FastAPI Depends 용).

    AZURE_SPEECH_KEY/REGION 미설정 시 503(STT_NOT_CONFIGURED)으로 변환해,
    상위(NestJS/프론트)가 '미구성'을 구분하고 폴백할 수 있게 한다.
    """
    global _stt_service
    if _stt_service is None:
        try:
            engine = AzureSttEngine(
                speech_key=os.getenv("AZURE_SPEECH_KEY", ""),
                speech_region=os.getenv("AZURE_SPEECH_REGION", ""),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"STT_NOT_CONFIGURED: {exc}",
            ) from exc
        _stt_service = SttService(engine=engine)
    return _stt_service


def get_pronunciation_service() -> PronunciationService:
    """PronunciationService 싱글턴 반환 (FastAPI Depends 용).

    AZURE_SPEECH_KEY/REGION 미설정 시 503(PRONUNCIATION_NOT_CONFIGURED)으로
    변환해, 상위(백엔드)가 '미구성'을 구분하고 기존 문자열 채점(nameMatch)으로
    폴백할 수 있게 한다.
    """
    global _pronunciation_service
    if _pronunciation_service is None:
        try:
            assessor = AzurePronunciationAssessor(
                speech_key=os.getenv("AZURE_SPEECH_KEY", ""),
                speech_region=os.getenv("AZURE_SPEECH_REGION", ""),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"PRONUNCIATION_NOT_CONFIGURED: {exc}",
            ) from exc
        _pronunciation_service = PronunciationService(assessor=assessor)
    return _pronunciation_service


def get_tts_service() -> TtsService:
    """TtsService 싱글턴 반환 (FastAPI Depends 용).

    AZURE_SPEECH_KEY/REGION 미설정 시 503(TTS_NOT_CONFIGURED)으로 변환해,
    상위(프론트)가 '미구성'을 구분하고 Web Speech로 폴백할 수 있게 한다.
    캐시는 TTS_CACHE_DIR/dynamic(기본 ../tts-cache/dynamic)에 둔다.
    """
    global _tts_service
    if _tts_service is None:
        try:
            engine = AzureTtsEngine(
                speech_key=os.getenv("AZURE_SPEECH_KEY", ""),
                speech_region=os.getenv("AZURE_SPEECH_REGION", ""),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"TTS_NOT_CONFIGURED: {exc}",
            ) from exc
        cache_root = os.getenv("TTS_CACHE_DIR", "../tts-cache")
        cache_dir = os.path.join(cache_root, "dynamic")
        max_bytes = _int_env("TTS_CACHE_MAX_BYTES", _DEFAULT_TTS_CACHE_MAX_BYTES)
        _tts_service = TtsService(
            engine=engine, cache_dir=cache_dir, max_cache_bytes=max_bytes
        )
    return _tts_service


def _int_env(name: str, default: int) -> int:
    """정수 환경변수 파싱 — 미설정/파싱 실패 시 기본값."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def client_key(request: Request) -> str:
    """레이트리밋 키(클라이언트 IP).

    X-Forwarded-For는 클라이언트가 마음대로 넣을 수 있는 헤더다. 무조건 신뢰하면
    공격자가 요청마다 임의의 XFF를 넣어 (1) 매번 새 버킷을 받아 한도를 완전히
    우회하고, (2) 레이트리밋터 내부 맵을 위조 IP로 무한히 부풀린다. 보호장치가
    오히려 DoS 벡터가 된다.

    따라서 기본값은 소켓 IP다. 실제로 신뢰할 수 있는 리버스 프록시 뒤에 배포할
    때만 TRUST_PROXY_HEADER=true로 켠다.
    """
    if _trust_proxy_header():
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _trust_proxy_header() -> bool:
    """신뢰할 수 있는 프록시 뒤에 있을 때만 XFF를 존중한다(기본 false)."""
    return os.getenv("TRUST_PROXY_HEADER", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


# 이 서비스의 레이트리밋은 **더 이상 사용자별이 아니다**.
#
# /stt·/tts를 백엔드 프록시 뒤로 옮기면서 여기서 보이는 IP가 전부 백엔드
# 하나가 됐다. 즉 IP 기준 버킷이 전 사용자 합산 **전역 한도**로 바뀌었다.
#
# 사용자별 격리는 백엔드가 인증된 사용자 ID로 한다(tts 30, stt 12 /분).
# 여기 값은 그 위에 놓인 전역 회로차단기다. 그래서 프록시 한도보다 낮으면
# 안 된다 — 예전 값(120/60)은 동시 4~5명이면 포화돼, 정상 사용자들이 서로를
# 밀어내는 병목이 됐을 것이다.
#
# 기본값은 동시 20명이 프록시 상한을 꽉 채워도 견디는 수준으로 잡는다.
# 배포 규모에 맞춰 환경변수로 조정할 것.
def get_tts_rate_limiter() -> SlidingWindowRateLimiter:
    """/tts 전역 회로차단기 (기본 600회/분, 사용자별 아님)."""
    global _tts_rate_limiter
    if _tts_rate_limiter is None:
        _tts_rate_limiter = SlidingWindowRateLimiter(
            max_requests=_int_env("TTS_RATE_LIMIT_PER_MIN", 600),
            window_seconds=60.0,
        )
    return _tts_rate_limiter


def get_stt_rate_limiter() -> SlidingWindowRateLimiter:
    """/stt 전역 회로차단기 (기본 240회/분, 사용자별 아님)."""
    global _stt_rate_limiter
    if _stt_rate_limiter is None:
        _stt_rate_limiter = SlidingWindowRateLimiter(
            max_requests=_int_env("STT_RATE_LIMIT_PER_MIN", 240),
            window_seconds=60.0,
        )
    return _stt_rate_limiter


def get_competitor_service(
    pronunciation: PronunciationService = Depends(get_pronunciation_service),
) -> CompetitorService:
    """CompetitorService (FastAPI Depends 용).

    STT 서비스는 **지연 생성**이라(`get_stt_service`를 넘기기만 한다) 경쟁자 모드에서 STT를
    요청했을 때만 만들어진다. 경쟁자를 안 쓰는 요청이 STT 설정 누락(503)에 영향받지 않는다.
    """
    return CompetitorService(pronunciation, stt_provider=get_stt_service)


def get_pronunciation_rate_limiter() -> SlidingWindowRateLimiter:
    """/pronunciation 전역 회로차단기 (기본 240회/분, 사용자별 아님).

    STT와 마찬가지로 Azure 유료 호출이라 폭주를 전역에서 차단한다.
    """
    global _pronunciation_rate_limiter
    if _pronunciation_rate_limiter is None:
        _pronunciation_rate_limiter = SlidingWindowRateLimiter(
            max_requests=_int_env("PRONUNCIATION_RATE_LIMIT_PER_MIN", 240),
            window_seconds=60.0,
        )
    return _pronunciation_rate_limiter
