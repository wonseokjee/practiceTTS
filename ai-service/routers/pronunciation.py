"""발음 평가 라우터.

POST /pronunciation (multipart: audio + reference_text + lang
                     [+ competitors + stt_competitor])
  → 정답 텍스트 기준 음소 단위 발음 점수(accuracy/fluency/completeness/prosody).
정답을 아는 재활 과제(퀴즈·낭독)에서 목표 단어/문장을 reference_text로 넘긴다.
평가 실패 시 502 → 상위(백엔드)에서 기존 문자열 채점(nameMatch)으로 폴백 가능.

경쟁자 모드(선택, 이웃 비교 채점 — services/competitor_service.py):
  - competitors: 같은 녹음을 참조로도 채점할 단어의 JSON 배열 문자열(최대 5개)
  - stt_competitor: true면 후보 없는 인식 결과도 경쟁자로 채점한다
  둘 다 없으면 응답은 예전과 키 집합까지 같다.
"""
import asyncio
import json

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
    get_competitor_service,
    get_pronunciation_rate_limiter,
    get_pronunciation_service,
)
from infra.rate_limiter import SlidingWindowRateLimiter
from models.pronunciation import (
    CompetitorScoreResponse,
    PhonemeScoreResponse,
    PronunciationResponse,
    WordScoreResponse,
)
from services.competitor_service import (
    MAX_COMPETITORS,
    CompetitorService,
    compact,
    max_azure_calls,
)
from services.pronunciation_service import PronunciationService

router = APIRouter(prefix="/pronunciation", tags=["pronunciation"])

# 재활 발화는 짧다(수 초~수십 초). STT와 동일한 상한을 쓴다.
MAX_AUDIO_BYTES = 4 * 1024 * 1024  # 4MB
# 정답 텍스트도 재활 문장 범위. 과대 입력 방지.
MAX_REFERENCE_LEN = 500
# 경쟁자는 낱말 하나다. 문장을 경쟁자로 받을 이유가 없어 짧게 자른다.
MAX_COMPETITOR_LEN = 30


def _parse_competitors(raw: str | None, reference: str) -> list[str]:
    """`competitors` 폼 값(JSON 배열 문자열)을 검증해 정리한다.

    빈 항목·목표와 같은 항목·중복은 조용히 버린다(무해하고 호출만 낭비한다).
    형식이 틀리거나 개수·길이가 상한을 넘으면 400.
    """
    if raw is None or not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        data = None
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="competitors는 문자열 배열(JSON)이어야 합니다.",
        )
    if len(data) > MAX_COMPETITORS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"competitors는 최대 {MAX_COMPETITORS}개입니다.",
        )
    seen = {compact(reference)}
    out: list[str] = []
    for item in data:
        text = item.strip()
        if len(text) > MAX_COMPETITOR_LEN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"competitors 항목은 {MAX_COMPETITOR_LEN}자 이하여야 합니다.",
            )
        key = compact(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


@router.post(
    "",
    response_model=PronunciationResponse,
    response_model_exclude_unset=True,   # 경쟁자 필드는 경쟁자 모드에서만 나간다(모델 주석 참고)
    status_code=status.HTTP_200_OK,
)
async def assess(
    request: Request,
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    lang: str = Form(...),
    competitors: str | None = Form(default=None),
    stt_competitor: bool = Form(default=False),
    service: PronunciationService = Depends(get_pronunciation_service),
    competitor_service: CompetitorService = Depends(get_competitor_service),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_pronunciation_rate_limiter),
) -> PronunciationResponse:
    """WAV 오디오를 정답 텍스트 기준으로 채점한다.

    - audio: WAV(PCM 16kHz mono) 파일
    - reference_text: 환자가 말하도록 제시된 목표 단어/문장(정답)
    - lang: 언어 코드 (필수 — 기본값 없음, 빠뜨리면 422)
    - competitors: (선택) 같은 녹음을 참조로도 채점할 단어의 JSON 배열 문자열
    - stt_competitor: (선택) 후보 없는 인식 결과도 경쟁자로 채점
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

    competitor_list = _parse_competitors(competitors, reference)
    competitor_mode = bool(competitor_list) or stt_competitor
    if competitor_mode:
        # 위에서 요청 1건을 이미 차감했다. 이 요청이 낼 수 있는 Azure 호출 수만큼 더 차감한다
        # (전역 한도의 단위는 요청이 아니라 호출이다 — 유료 호출 폭주를 막는 회로차단기).
        extra = max_azure_calls(len(competitor_list), stt_competitor) - 1
        if extra > 0 and not rate_limiter.allow(client_key(request), cost=extra):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
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

    assessment = None
    try:
        # Azure SDK의 recognize_once()는 블로킹 네트워크 호출이다. async 라우트에서
        # 직접 부르면 단일 이벤트 루프를 막아, 한 요청이 지연되면 무관한 요청(health,
        # 다른 퀴즈)까지 얼어붙는다. 스레드로 오프로드해 루프를 풀어준다.
        if competitor_mode:
            assessment = await asyncio.to_thread(
                competitor_service.assess, wav_bytes, reference, lang,
                competitor_list, stt_competitor,
            )
            result = assessment.target
        else:
            result = await asyncio.to_thread(service.assess, wav_bytes, reference, lang)
    except Exception as exc:  # 엔진 취소·네트워크 등 → 상위에서 폴백.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="발음 평가에 실패했습니다.",
        ) from exc

    extra_fields: dict = {}
    if assessment is not None:
        # 경쟁자 모드에서만 채운다 — 채우지 않은 필드는 응답에서 키째 빠진다.
        extra_fields["stt_transcript"] = assessment.stt_transcript
        extra_fields["stt_status"] = assessment.stt_status
        extra_fields["competitors_skipped"] = assessment.skipped_reason
        if assessment.competitors is not None:
            extra_fields["competitor_scores"] = [
                CompetitorScoreResponse(
                    text=c.text, source=c.source, accuracy_score=c.accuracy_score,
                    recognized_text=c.recognized_text, status=c.status,
                )
                for c in assessment.competitors
            ]

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
        **extra_fields,
    )
