"""한마디→발화연습 변환 유스케이스 (Pattern 1).

보호자 한마디 1문장을 환자 발화 연습 콘텐츠로 변환한다:
  (a) echo_sentence — 따라말하기 (한마디 그대로, LLM 불필요)
  (b) fill_blank    — 핵심 명사 1개 빈칸 처리 (LLM, 실패 시 규칙 기반 폴백)

설계 원칙: LLM이 죽거나 타임아웃이어도 echo + 규칙 기반 빈칸으로 항상 200 응답을
보장한다 (따라말하기 옵션은 LLM 없이도 동작). 입력에 금칙어가 있으면 변환 거부(422).
"""
import asyncio
import json
import logging
import os
import re

from constants.banned_words import BANNED_WORDS
from domain.errors import WishConversionError
from interfaces.llm_client import ILlmClient
from models.wish import FillBlankOut, WishToPracticeRequest, WishToPracticeResponse
from prompts.wish_to_practice_prompt import (
    WISH_RETRY_INSTRUCTION,
    WISH_TO_PRACTICE_PROMPT,
)

logger = logging.getLogger(__name__)

# 변환 모델 (quiz와 동일 저비용 flash 계열, env 오버라이드 가능)
_WISH_MODEL = os.getenv("GEMINI_QUIZ_MODEL", "gemini-2.5-flash-lite")
# LLM 호출 제한 시간 (초)
_LLM_TIMEOUT_SECONDS = 15
# 빈칸 문장 최대 길이
_MAX_SENTENCE_LEN = 30
# 한글 토큰(2~5자) 추출 정규식 — 규칙 기반 폴백용
_KOREAN_TOKEN_RE = re.compile(r"[가-힣]{2,5}")


class WishToPracticeService:
    """한마디→발화연습 변환 서비스."""

    def __init__(self, llm_client: ILlmClient) -> None:
        self._llm = llm_client

    async def convert(
        self, request: WishToPracticeRequest
    ) -> WishToPracticeResponse:
        """한마디를 echo + fill_blank로 변환한다.

        Raises:
            WishConversionError: 입력에 금칙어 포함 → 라우터 422
        """
        wish = request.wish_message.strip()

        # 금칙어 검사 — 한마디 자체가 부적절하면 변환 거부 (환자 노출 차단)
        if self._contains_banned_word(wish):
            raise WishConversionError("한마디에 사용할 수 없는 표현이 포함되어 있습니다")

        # (a) 따라말하기 — 한마디 그대로 (LLM 불필요)
        echo_sentence = wish

        # (b) 빈칸 채우기 — LLM 시도, 실패 시 규칙 기반 폴백
        fill_blank, fallback_used = await self._build_fill_blank(wish)

        return WishToPracticeResponse(
            echo_sentence=echo_sentence,
            fill_blank=fill_blank,
            model=_WISH_MODEL,
            fallback_used=fallback_used,
        )

    # ------------------------------------------------------------------

    async def _build_fill_blank(self, wish: str) -> tuple[FillBlankOut, bool]:
        """LLM으로 빈칸 문항 생성 시도 → 실패하면 규칙 기반 폴백.

        반환: (FillBlankOut, fallback_used)
        """
        parsed = await self._try_llm(wish)
        if parsed is not None:
            sanitized = self._sanitize(parsed, wish)
            if sanitized is not None:
                return sanitized, False
        return self._rule_based_fallback(wish), True

    async def _try_llm(self, wish: str) -> dict | None:
        """LLM 1회 호출 + 파싱. 타임아웃/API오류/파싱실패는 None 반환(폴백 위임)."""
        prompt = WISH_TO_PRACTICE_PROMPT.format(WISH_MESSAGE=wish)
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": WISH_RETRY_INSTRUCTION},
        ]
        try:
            raw = await asyncio.wait_for(
                self._llm.complete(
                    messages=messages,
                    model=_WISH_MODEL,
                    generation_config={"temperature": 0.2},
                ),
                timeout=_LLM_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning("한마디 변환 LLM 타임아웃 → 규칙 기반 폴백")
            return None
        except Exception as exc:  # GeminiApiError 등 — 폴백으로 흡수
            logger.warning("한마디 변환 LLM 오류(%s) → 규칙 기반 폴백", type(exc).__name__)
            return None

        return self._parse(raw)

    @staticmethod
    def _parse(raw: str) -> dict | None:
        """코드펜스 제거 + json.loads + {..} 슬라이스 폴백. 실패 시 None."""
        cleaned = raw.strip()
        fence = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL | re.IGNORECASE)
        if fence:
            cleaned = fence.group(1).strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            start, end = cleaned.find("{"), cleaned.rfind("}")
            if start == -1 or end <= start:
                return None
            try:
                data = json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                return None
        return data if isinstance(data, dict) else None

    def _sanitize(self, raw: dict, wish: str) -> FillBlankOut | None:
        """형식/금칙어/부분일치 검사. 부적합하면 None(폴백 위임)."""
        prompt = raw.get("prompt")
        answer = raw.get("answer")
        hint = raw.get("hint_first_char")
        if not isinstance(prompt, str) or not prompt.strip():
            return None
        if not isinstance(answer, str) or not answer.strip():
            return None
        prompt, answer = prompt.strip(), answer.strip()
        if len(prompt) > _MAX_SENTENCE_LEN:
            prompt = prompt[:_MAX_SENTENCE_LEN]
        # 금칙어 검사
        if self._contains_banned_word(prompt) or self._contains_banned_word(answer):
            return None
        # 부분일치: 정답이 한마디 원문에 존재해야 함 (환각 방지)
        if answer.replace(" ", "") not in wish.replace(" ", ""):
            return None
        # 빈칸이 실제로 있어야 함
        if "_" not in prompt:
            return None
        first = answer.replace(" ", "")[:1]
        if not isinstance(hint, str) or not hint.strip():
            hint = first
        return FillBlankOut(prompt=prompt, answer=answer, hint_first_char=hint)

    def _rule_based_fallback(self, wish: str) -> FillBlankOut:
        """LLM 없이 한마디에서 가장 긴 한글 토큰을 빈칸 처리한다."""
        tokens = _KOREAN_TOKEN_RE.findall(wish)
        # 가장 긴 토큰을 핵심 명사 후보로 (동률이면 먼저 나온 것)
        answer = max(tokens, key=len) if tokens else wish.replace(" ", "")[:2]
        if not answer:
            answer = wish.strip()[:2] or "오늘"
        prompt = wish.replace(answer, "___", 1)
        if "_" not in prompt:  # 치환 실패(answer가 wish에 없음) → 끝에 빈칸 부가
            prompt = f"{wish} ___"
        prompt = prompt[:_MAX_SENTENCE_LEN]
        if "_" not in prompt:  # 절단으로 빈칸이 유실됨(긴 문장 뒤쪽 치환) → 빈칸 보존 재구성
            prompt = f"{prompt[: _MAX_SENTENCE_LEN - 4].rstrip()} ___"
        return FillBlankOut(
            prompt=prompt,
            answer=answer,
            hint_first_char=answer.replace(" ", "")[:1] or "오",
        )

    @staticmethod
    def _contains_banned_word(text: str) -> bool:
        return any(banned in text for banned in BANNED_WORDS)
