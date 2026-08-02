"""발음 평가 라우터.

POST /pronunciation (multipart: audio + reference_text + lang)
  → 정답 텍스트 기준 음소 단위 발음 점수(accuracy/fluency/completeness/prosody).
정답을 아는 재활 과제(퀴즈·낭독)에서 목표 단어/문장을 reference_text로 넘긴다.
평가 실패 시 502 → 상위(백엔드)에서 기존 문자열 채점(nameMatch)으로 폴백 가능.
"""
import asyncio

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)

from dependencies import (
    client_key,
    get_pronunciation_rate_limiter,
    get_pronunciation_service,
)
from infra.rate_limiter import SlidingWindowRateLimiter
from models.pronunciation import (
    PhonemeScoreResponse,
    PronunciationResponse,
    WordScoreResponse,
)
from services.pronunciation_service import PronunciationService

router = APIRouter(prefix="/pronunciation", tags=["pronunciation"])

# 재활 발화는 짧다(수 초~수십 초). STT와 동일한 상한을 쓴다.
MAX_AUDIO_BYTES = 4 * 1024 * 1024  # 4MB
# 정답 텍스트도 재활 문장 범위. 과대 입력 방지.
MAX_REFERENCE_LEN = 500


@router.post("", response_model=PronunciationResponse, status_code=status.HTTP_200_OK)
async def assess(
    request: Request,
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    lang: str = Form("ko-KR"),
    service: PronunciationService = Depends(get_pronunciation_service),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_pronunciation_rate_limiter),
) -> PronunciationResponse:
    """WAV 오디오를 정답 텍스트 기준으로 채점한다.

    - audio: WAV(PCM 16kHz mono) 파일
    - reference_text: 환자가 말하도록 제시된 목표 단어/문장(정답)
    - lang: 언어 코드 (기본 ko-KR)
    """
    # 평가 엔진 폭주로 Azure 할당량을 소진시키는 것을 막는다(직접 노출 방어).
    if not rate_limiter.allow(client_key(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
        )

    reference = reference_text.strip()
    if not reference:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="정답 텍스트(reference_text)가 비어 있습니다.",
        )
    if len(reference) > MAX_REFERENCE_LEN:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="정답 텍스트가 너무 깁니다.",
        )

    # 본문을 읽기 전에 선언된 크기부터 거른다(스풀링 전 차단).
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="오디오가 너무 큽니다.",
        )

    wav_bytes = await audio.read()
    if not wav_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="오디오가 비어 있습니다.",
        )
    if len(wav_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="오디오가 너무 큽니다.",
        )

    try:
        # Azure SDK의 recognize_once()는 블로킹 네트워크 호출이다. async 라우트에서
        # 직접 부르면 단일 이벤트 루프를 막아, 한 요청이 지연되면 무관한 요청(health,
        # 다른 퀴즈)까지 얼어붙는다. 스레드로 오프로드해 루프를 풀어준다.
        result = await asyncio.to_thread(service.assess, wav_bytes, reference, lang)
    except Exception as exc:  # 엔진 취소·네트워크 등 → 상위에서 폴백.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="발음 평가에 실패했습니다.",
        ) from exc

    return PronunciationResponse(
        recognized_text=result.recognized_text,
        accuracy_score=result.accuracy_score,
        fluency_score=result.fluency_score,
        completeness_score=result.completeness_score,
        pronunciation_score=result.pronunciation_score,
        prosody_score=result.prosody_score,
        words=[
            WordScoreResponse(
                word=w.word,
                accuracy=w.accuracy,
                error_type=w.error_type,
                phonemes=[
                    PhonemeScoreResponse(phoneme=p.phoneme, accuracy=p.accuracy)
                    for p in w.phonemes
                ],
            )
            for w in result.words
        ],
        engine=service.engine_name,
    )
