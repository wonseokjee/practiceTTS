"""데일리 퀴즈 생성 유스케이스 (UC: GenerateDailyQuiz).

ILlmClient 인터페이스에만 의존하며 구현체는 생성자로 주입받는다
(scenario/tagging 컨벤션과 동일, RAG 미사용이라 vector_store 불필요).

plan §8-2 안전 가드 1~5 + 규칙 기반 폴백을 구현한다:
  - 가드 1: JSON 파싱 실패 시 temperature=0 로 1회 재시도
  - 가드 2: 결과가 부족하면 규칙 기반 빈칸 문제로 보충
  - 가드 3: 정답이 메모 합본에 부분 일치하는지 검사 (환각 방지)
  - 가드 4: 금칙어 포함 문제 제거
  - 가드 5: 문장 30자 초과 절단
"""
import asyncio
import json
import logging
import os
import random
import re
import time

from constants.banned_words import BANNED_WORDS
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
    QuizGenerateResponse,
    QuizLLMResponse,
    QuizQuestionOut,
)
from prompts.quiz_prompt import QUIZ_RETRY_INSTRUCTION, QUIZ_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# 퀴즈 생성 모델 (저비용 flash 계열). 모델명이 폐기될 때 코드 수정 없이 교체할 수
# 있도록 GEMINI_QUIZ_MODEL 환경변수로 오버라이드 가능. (gemini-1.5-flash는 폐기됨)
_QUIZ_MODEL = os.getenv("GEMINI_QUIZ_MODEL", "gemini-2.5-flash-lite")
# LLM 호출 제한 시간 (초)
_LLM_TIMEOUT_SECONDS = 25
# 문장(prompt) 최대 길이 (가드 5)
_MAX_SENTENCE_LEN = 30
# patient_notes 합본 최소 글자 수
_MIN_NOTES_BLOB_LEN = 10
# 예/아니오 정답 허용값
_YES_NO_ANSWERS = {"yes", "no"}
# 폴백 후보 단어 추출용 한글 토큰 정규식 (2~5자)
_KOREAN_TOKEN_RE = re.compile(r"[가-힣]{2,5}")
# 토큰 끝에서 제거할 조사 접미사 (긴 것부터 검사)
_PARTICLE_SUFFIXES = ("에서", "으로", "에게", "을", "를", "이", "가", "은", "는", "에", "와", "과", "도")


class QuizGeneratorService:
    """데일리 퀴즈 생성 서비스.

    Gemini로 환자 메모 기반 퀴즈를 생성하고, 안전 가드와 규칙 기반 폴백을 통해
    항상 distribution.total 개수만큼의 안전한 문제를 보장한다.
    """

    def __init__(self, llm_client: ILlmClient) -> None:
        self._llm = llm_client

    async def generate_quiz(
        self, request: QuizGenerateRequest
    ) -> QuizGenerateResponse:
        """가드 1~5 + 폴백을 적용해 distribution.total 개수의 문제를 생성한다.

        Args:
            request: 환자 메모/사진 태그/목표 단어/분포로 구성된 요청

        Returns:
            QuizGenerateResponse (questions, model, elapsed_ms, fallback_used)

        Raises:
            InvalidPatientNotesError: note 0개 또는 합본<10자 → 라우터 422
            QuizGenerationTimeoutError: Gemini 25초 초과 → 라우터 504
            GeminiApiError: 호출 실패 → 라우터 502
        """
        started_at = time.monotonic()

        # 1. 입력 검증 (합본 텍스트 확보)
        notes_blob = self._validate_notes(request.patient_notes)

        # 2. 분포 정규화 (없으면 기본값 mc2/yn2/fb1)
        dist = request.distribution
        need = dist.total

        # 3. 프롬프트 구성
        prompt = self._build_prompt(request, dist)

        # 4. [가드 1] 1차 호출 → 파싱, 실패 시 temperature=0 재시도
        parsed = await self._generate_and_parse(prompt)

        # 5. [가드 3·4·5] 안전 가드 통과 문제만 추출 (요청 분포도 함께 적용)
        questions = self._sanitize(parsed, notes_blob, dist)

        # 6. [가드 2] 부족분을 규칙 기반 빈칸 폴백으로 보충
        fallback_used = len(questions) < need
        if fallback_used:
            questions += self._backfill(questions, notes_blob, need - len(questions))
        questions = questions[:need]  # 초과분 절단

        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        return QuizGenerateResponse(
            questions=questions,
            model=_QUIZ_MODEL,
            elapsed_ms=elapsed_ms,
            fallback_used=fallback_used,
        )

    # ------------------------------------------------------------------
    # 내부 헬퍼 (모두 private)
    # ------------------------------------------------------------------

    def _validate_notes(self, notes: list[PatientNoteIn]) -> str:
        """합본 텍스트를 반환. note 0개 또는 합본<10자면 InvalidPatientNotesError."""
        if not notes:
            raise InvalidPatientNotesError(
                "patient_notes가 비어 있습니다. 최소 1개 이상의 메모가 필요합니다"
            )
        # 줄바꿈으로 구분해 노트 경계를 가로지르는 허위 부분일치(가드 3)를 방지한다.
        blob = "\n".join(n.answer_text for n in notes)
        if len(blob.strip()) < _MIN_NOTES_BLOB_LEN:
            raise InvalidPatientNotesError(
                f"메모 합본 글자 수가 부족합니다 (최소 {_MIN_NOTES_BLOB_LEN}자)"
            )
        return blob

    def _build_prompt(
        self, request: QuizGenerateRequest, dist: QuizDistribution
    ) -> str:
        """patient_notes/photo_tags/target_words/distribution만 참조해 프롬프트 구성.

        보호자 사적 데이터는 요청 모델에 존재하지 않으므로 구조적으로 진입 불가하다.
        """
        patient_notes_str = "\n".join(
            f"- [{n.category}] {n.answer_text}" for n in request.patient_notes
        )
        if request.photo_tags is not None:
            photo_tags_str = json.dumps(
                {
                    "location": request.photo_tags.location,
                    "objects": request.photo_tags.objects,
                },
                ensure_ascii=False,
            )
        else:
            photo_tags_str = "없음"
        target_words_str = (
            ", ".join(request.target_words) if request.target_words else "없음"
        )

        return QUIZ_SYSTEM_PROMPT.format(
            N_MULTIPLE_CHOICE=dist.multiple_choice,
            N_YES_NO=dist.yes_no,
            N_FILL_BLANK=dist.fill_blank,
            PATIENT_NOTES=patient_notes_str,
            PHOTO_TAGS=photo_tags_str,
            TARGET_WORDS=target_words_str,
        )

    async def _generate_and_parse(self, prompt: str) -> list[dict]:
        """[가드 1] 1차 호출(temperature=0.7) → 파싱 실패 시 temperature=0 재시도.

        2회 모두 파싱 실패하면 빈 리스트를 반환해 가드 2 폴백이 전량 보충하도록 한다.
        타임아웃/API 오류는 폴백으로 흡수하지 않고 그대로 전파한다.
        """
        raw = await self._call_llm(prompt, temperature=0.7)
        try:
            return self._parse_questions(raw)
        except ValueError:
            logger.warning("퀴즈 JSON 1차 파싱 실패, temperature=0 재시도")

        raw_retry = await self._call_llm(prompt, temperature=0.0)
        try:
            return self._parse_questions(raw_retry)
        except ValueError:
            logger.warning("퀴즈 JSON 2차 파싱 실패, 규칙 기반 폴백으로 전환")
            return []

    async def _call_llm(self, prompt: str, *, temperature: float) -> str:
        """asyncio.wait_for(25s)로 self._llm.complete를 래핑한다.

        temperature는 generation_config로 래핑해 전달한다 (GeminiClient가 kwargs를
        generate_content로 그대로 흘려보내므로 generation_config 키가 정상 처리됨).
        """
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": QUIZ_RETRY_INSTRUCTION},
        ]
        try:
            return await asyncio.wait_for(
                self._llm.complete(
                    messages=messages,
                    model=_QUIZ_MODEL,
                    # 구조화 출력: Gemini가 QuizLLMResponse({"questions":[...]}) 형식의
                    # 유효 JSON만 반환하도록 강제한다(코드펜스·군더더기·깨진 JSON 차단).
                    # GeminiClient가 generation_config를 GenerateContentConfig로 그대로
                    # 흘려보내므로 여기서 두 키를 얹기만 하면 된다.
                    generation_config={
                        "temperature": temperature,
                        "response_mime_type": "application/json",
                        "response_schema": QuizLLMResponse,
                    },
                ),
                timeout=_LLM_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise QuizGenerationTimeoutError(
                f"Gemini 응답이 {_LLM_TIMEOUT_SECONDS}초를 초과했습니다"
            ) from exc
        # GeminiApiError는 _llm.complete가 이미 raise → 그대로 전파

    def _parse_questions(self, raw: str) -> list[dict]:
        """코드펜스 제거 + json.loads + {..} 슬라이스 폴백. 실패 시 ValueError."""
        cleaned = self._strip_code_fence(raw)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            # 앞뒤 설명이 붙은 경우 첫 { ~ 마지막 } 만 슬라이스해 재시도
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise ValueError("JSON 객체를 찾을 수 없습니다")
            try:
                data = json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError as exc:
                raise ValueError(f"JSON 파싱 실패: {exc}") from exc

        questions = data.get("questions")
        if not isinstance(questions, list):
            raise ValueError("응답에 questions 리스트가 없습니다")
        return [q for q in questions if isinstance(q, dict)]

    @staticmethod
    def _strip_code_fence(raw: str) -> str:
        """```json ... ``` / ``` ... ``` / 펜스 없음 모두 처리해 내부 본문만 반환."""
        cleaned = raw.strip()
        fence_match = re.search(
            r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL | re.IGNORECASE
        )
        if fence_match:
            return fence_match.group(1).strip()
        return cleaned

    def _sanitize(
        self, questions: list[dict], notes_blob: str, dist: QuizDistribution
    ) -> list[QuizQuestionOut]:
        """가드 3(부분일치)·4(금칙어)·5(30자 절단) + 유형 정합성 통과 문제만 반환."""
        result: list[QuizQuestionOut] = []
        for raw_q in questions:
            sanitized = self._sanitize_one(raw_q, notes_blob, dist)
            if sanitized is not None:
                result.append(sanitized)
        return result

    def _sanitize_one(
        self, raw_q: dict, notes_blob: str, dist: QuizDistribution
    ) -> QuizQuestionOut | None:
        """단일 문제 dict에 가드를 적용. 부적합하면 None을 반환(제거)."""
        q_type = raw_q.get("type")
        prompt = raw_q.get("prompt")
        correct_answer = raw_q.get("correct_answer")
        choices = raw_q.get("choices")
        hint_first_char = raw_q.get("hint_first_char")

        # 기본 형식 검사 (불변식 I4)
        if q_type not in ("multiple_choice", "yes_no", "fill_blank"):
            return None

        # 요청 분포에서 제외된 유형은 LLM이 만들어도 버린다(부족분은 폴백이 보충).
        # 예: yes_no=0이면 LLM이 yes_no를 반환해도 제거 → 빈칸 폴백으로 대체.
        if q_type == "yes_no" and dist.yes_no == 0:
            return None
        if not isinstance(prompt, str) or not prompt.strip():
            return None
        if not isinstance(correct_answer, str) or not correct_answer.strip():
            return None
        prompt = prompt.strip()
        correct_answer = correct_answer.strip()

        # 가드 5 (길이): prompt 30자 초과 → 절단
        if len(prompt) > _MAX_SENTENCE_LEN:
            logger.warning("문장 길이 초과로 절단 (원본 %d자)", len(prompt))
            prompt = prompt[:_MAX_SENTENCE_LEN]

        # 가드 4 (금칙어): prompt/correct_answer/choices 어디든 금칙어 포함 시 제거
        texts_to_check = [prompt, correct_answer]
        if isinstance(choices, list):
            texts_to_check.extend(str(c) for c in choices)
        if self._contains_banned_word(texts_to_check):
            logger.warning("금칙어 포함 문제 제거")
            return None

        # 유형별 정합성 + 가드 3 (부분일치)
        if q_type == "multiple_choice":
            return self._sanitize_multiple_choice(prompt, correct_answer, choices, notes_blob)
        if q_type == "yes_no":
            return self._sanitize_yes_no(prompt, correct_answer)
        return self._sanitize_fill_blank(prompt, correct_answer, hint_first_char, notes_blob)

    def _sanitize_multiple_choice(
        self, prompt: str, correct_answer: str, choices: object, notes_blob: str
    ) -> QuizQuestionOut | None:
        """불변식 I1 + 가드 3 + 오답지 타당성 검증.

        타당성(문항이 '단일 정답'을 갖도록):
          - 선택지 정확히 4개, 중복 없음(중복 보기/정답=오답 무효 문항 차단).
          - 정답이 선택지에 포함 & 메모에 실재(환각 차단).
          - 오답이 메모에 실재하면 폐기 — 그 오답도 사실이라 정답이 2개가 되어
            타당성이 깨진다(프롬프트로만 지시하던 것을 코드로 강제).
          - 정답 위치 편향(LLM이 정답을 앞에 두는 경향) 제거를 위해 셔플.
        """
        if not isinstance(choices, list) or len(choices) != 4:
            return None
        choices_str = [str(c).strip() for c in choices]
        # 중복 보기 = 무효 문항(정답과 동일한 오답 포함). set 크기로 한 번에 차단.
        if len(set(choices_str)) != 4:
            return None
        if correct_answer not in choices_str:
            return None
        # 가드 3: 정답이 메모 합본에 부분 일치해야 함 (환각 방지)
        if not self._answer_in_notes(correct_answer, notes_blob):
            return None
        # 오답이 메모에 실재하면 '두 번째 정답'이 되어 문항이 무효 → 폐기(백필이 보충).
        distractors = [c for c in choices_str if c != correct_answer]
        if any(self._answer_in_notes(d, notes_blob) for d in distractors):
            return None
        # 위치 편향 제거.
        shuffled = choices_str[:]
        random.shuffle(shuffled)
        return QuizQuestionOut(
            type="multiple_choice",
            prompt=prompt,
            choices=shuffled,
            correct_answer=correct_answer,
        )

    def _sanitize_yes_no(
        self, prompt: str, correct_answer: str
    ) -> QuizQuestionOut | None:
        """불변식 I2 적용 (yes_no는 부분일치 검사 면제)."""
        answer = correct_answer.lower()
        if answer not in _YES_NO_ANSWERS:
            return None
        return QuizQuestionOut(
            type="yes_no",
            prompt=prompt,
            choices=None,
            correct_answer=answer,
        )

    def _sanitize_fill_blank(
        self,
        prompt: str,
        correct_answer: str,
        hint_first_char: object,
        notes_blob: str,
    ) -> QuizQuestionOut | None:
        """불변식 I3 + 가드 3 + 빈칸 타당성. hint_first_char 누락 시 정답 첫 글자로 보정."""
        # 가드 3: 정답이 메모 합본에 부분 일치해야 함
        if not self._answer_in_notes(correct_answer, notes_blob):
            return None
        # 타당성: 문장에 빈칸이 실제로 있어야 한다(밑줄 2개 이상). 없으면 풀 수 없는 문항.
        if "__" not in prompt:
            return None
        # 타당성: 정답이 문장에 그대로 노출되면(빈칸 처리 실패) 답이 보이는 무효 문항 → 폐기.
        if correct_answer in prompt:
            return None
        first_char = correct_answer.replace(" ", "")[:1]
        if not first_char:
            return None
        if not isinstance(hint_first_char, str) or not hint_first_char.strip():
            hint_first_char = first_char
        return QuizQuestionOut(
            type="fill_blank",
            prompt=prompt,
            choices=None,
            correct_answer=correct_answer,
            hint_first_char=hint_first_char,
        )

    @staticmethod
    def _contains_banned_word(texts: list[str]) -> bool:
        """주어진 텍스트들 중 하나라도 금칙어를 부분 문자열로 포함하면 True."""
        return any(banned in text for text in texts for banned in BANNED_WORDS)

    @staticmethod
    def _answer_in_notes(correct_answer: str, notes_blob: str) -> bool:
        """정답이 메모 합본에 (공백 제거 후) 부분 문자열로 존재하는지 검사 (가드 3)."""
        normalized_answer = correct_answer.replace(" ", "")
        normalized_blob = notes_blob.replace(" ", "")
        return normalized_answer in normalized_blob

    def _backfill(
        self,
        questions: list[QuizQuestionOut],
        notes_blob: str,
        needed: int,
    ) -> list[QuizQuestionOut]:
        """가드 2: LLM 없이 메모에서 명사 후보를 뽑아 빈칸 문제를 needed개 보충한다."""
        if needed <= 0:
            return []

        used_answers = {q.correct_answer for q in questions}
        candidates = self._extract_candidate_words(notes_blob, used_answers)

        backfilled: list[QuizQuestionOut] = []
        for word in candidates:
            if len(backfilled) >= needed:
                break
            backfilled.append(self._build_fallback_question(word, notes_blob))

        # 후보가 부족하면 최소 보장 문제로 채운다
        while len(backfilled) < needed:
            fallback_word = candidates[0] if candidates else notes_blob.strip()[:2]
            backfilled.append(
                QuizQuestionOut(
                    type="fill_blank",
                    prompt="오늘 무엇을 하셨나요? ___",
                    choices=None,
                    correct_answer=fallback_word,
                    hint_first_char=fallback_word.replace(" ", "")[:1] or "오",
                )
            )

        # 폴백 정답은 _extract_candidate_words 단계에서 금칙어를 배제했고,
        # prompt는 _MAX_SENTENCE_LEN으로 절단되므로 길이/금칙어 불변식을 만족한다.
        return backfilled[:needed]

    def _extract_candidate_words(
        self, notes_blob: str, used_answers: set[str]
    ) -> list[str]:
        """메모 합본에서 한글 2자 이상 토큰을 추출하고 조사를 제거해 후보를 만든다."""
        candidates: list[str] = []
        seen: set[str] = set()
        for raw_token in _KOREAN_TOKEN_RE.findall(notes_blob):
            word = self._strip_particle(raw_token)
            if len(word) < 2:
                continue
            if word in used_answers or word in seen:
                continue
            # 가드 4: 금칙어가 폴백 정답으로 새어 나가지 않도록 후보 단계에서 배제한다.
            if self._contains_banned_word([word]):
                continue
            seen.add(word)
            candidates.append(word)
        return candidates

    @staticmethod
    def _strip_particle(token: str) -> str:
        """토큰 끝의 조사 접미사를 1회 제거한다 (간단 휴리스틱)."""
        for suffix in _PARTICLE_SUFFIXES:
            if token.endswith(suffix) and len(token) - len(suffix) >= 2:
                return token[: -len(suffix)]
        return token

    @staticmethod
    def _build_fallback_question(word: str, notes_blob: str) -> QuizQuestionOut:
        """후보 단어 word로 빈칸 문제를 구성한다.

        word가 포함된 원문 문장을 찾아 word를 ___로 치환하고, 없으면 기본 문형을 쓴다.
        """
        prompt = "오늘 ___을 기억하나요?"
        for line in re.split(r"[.\n]", notes_blob):
            if word in line and line.strip():
                replaced = line.strip().replace(word, "___", 1)
                if replaced.strip("_ ").strip():
                    prompt = replaced[:_MAX_SENTENCE_LEN]
                break
        return QuizQuestionOut(
            type="fill_blank",
            prompt=prompt,
            choices=None,
            correct_answer=word,
            hint_first_char=word.replace(" ", "")[:1],
        )
