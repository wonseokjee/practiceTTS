# 데일리 퀴즈 (Daily Quiz) — Phase 2: FastAPI 퀴즈 생성기 Feature Plan

> 작성일: 2026-06-01
> 작성자: Feature Architect 에이전트
> 단계: Phase 2 (FastAPI 퀴즈 생성기) — 설계 전용 (코드 구현 없음)
> 상위 문서:
> - `docs/history/20260517_DailyQuiz_implementation_plan.md` (전체 구현 계획, §7-2/§8/§10/§11/§14-3)
> - `docs/history/20260517_DailyQuiz_Phase1_feature_plan.md` (Phase 1 데이터 모델/DTO 컨벤션)
> - `docs/history/20260322_AIService_feature_plan.md` (기존 ai-service 설계 컨벤션)
> 준수 규칙: 기존 ai-service의 scenario/tagging 계열 코드 컨벤션을 **그대로** 따른다. 인터페이스 우선, 의존성은 안쪽(domain)을 향한다.

---

## 0. 한눈에 보기 (TL;DR)

| 항목 | 결정 |
|---|---|
| 범위 | `ai-service/`에 `POST /quiz/generate` 추가. NestJS/React는 본 Phase 범위 밖 |
| 신규 파일 | `models/quiz.py`, `prompts/quiz_prompt.py`, `services/quiz_service.py`, `routers/quiz.py` |
| 수정 파일 | `main.py` (라우터 등록), `domain/errors.py` (에러 4종 추가), `dependencies.py` (서비스 팩토리 추가) |
| LLM 모델 | `gemini-1.5-flash` 우선 (저비용, 일기 짧음). JSON 파싱 실패 시 동일 모델 `temperature=0` 1회 재시도 |
| 출력 파서 | **기존 컨벤션 우선** — `json.loads` + 코드펜스 제거 수동 파싱. LangChain `PydanticOutputParser`는 **도입하지 않음** (이유 §3-3) |
| 핵심 불변식 | 입력 모델(`QuizGenerateRequest`)에 `mood`/`caregiver_reflection`/`caregiver_wish_message` 필드 자체가 **존재하지 않음** (타입 단계 차단) |
| 안전 가드 | §8-2 코드 레벨 가드 1~5번을 `QuizGeneratorService`에 구현 |
| 테스트 | `tests/test_quiz_service.py` 6케이스 (정상/타임아웃/JSON깨짐/금칙어/길이초과/보호자데이터미포함) |

> **가장 중요한 설계 결정**: 보호자 사적 데이터를 "전달하지 않는" 것을 코드로 방어하지 않고, **애초에 입력 모델 스키마에 필드를 두지 않음**으로써 타입 시스템(Pydantic) 단계에서 구조적으로 차단한다. 추가 필드는 Pydantic 기본 동작상 무시되며, 본 모델은 이를 더 명시적으로 강제하기 위해 `model_config = ConfigDict(extra="ignore")`를 사용한다 (§4-1).

---

## 1. 목표 및 배경

### 1-1. 목표
보호자가 작성한 **환자 관련 카테고리별 메모(`patient_notes`)만**을 입력받아, Gemini LLM으로 뇌졸중 후 실어증 환자가 풀 수 있는 **5문제(4지선다 2 + 예/아니오 2 + 빈칸 1)** 를 생성하는 FastAPI 엔드포인트 `POST /quiz/generate`를 구현하기 위한 상세 설계를 확정한다.

### 1-2. 배경 / 제약
- 상위 plan §7-2가 API 계약을, §8이 프롬프트 + 안전 가드를, §10이 에러/타임아웃을 규정한다.
- 본 엔드포인트는 NestJS `QuizGenerationClient`가 호출하는 **내부 서비스**다 (브라우저 직접 호출 아님).
- 보호자 사적 데이터(무드, 자기 리플렉션, "지금 듣고 싶은 한마디")는 **LLM 경로에 절대 진입 불가**해야 한다 (§14-3 보안/프라이버시).

### 1-3. Phase 2 In Scope (plan §11)
- `models/quiz.py` — Pydantic 요청/응답 모델 + `PatientNoteIn[]` 입력 모델
- `prompts/quiz_prompt.py` — Gemini 프롬프트(§8-1 골격) + 출력 파서 안정화
- `services/quiz_service.py` — 검증·폴백(§8-2 가드 1~5번) + 정답 부분일치 검사
- `routers/quiz.py` + `main.py` include + `dependencies.py` 팩토리
- pytest 6케이스

### 1-4. Out of Scope
- NestJS `QuizGenerationClient` 화이트리스트 직렬화(§8-2 가드 6·7번) → Phase 3
- Gemini Vision 사진 분석(`photo_tags` 자동 추출) → plan R7(b), Phase 후순위. **단 `photo_tags`를 입력으로 받아 프롬프트에 끼워 넣는 것까지는 본 Phase에 포함** (NestJS가 보내주면 사용, 안 보내면 무시)
- Phase 6 `/wish/to-practice` 엔드포인트 (별도 프롬프트 파일)
- LLM 호출 throttle/rate-limit (plan §14-2, Phase 3 NestJS Guard에서 처리)

---

## 2. 기존 코드 패턴 분석 결과 (반드시 준수)

본 Phase는 신규 기능이지만, **scenario 계열을 그대로 따른다.** 정독 결과 확정된 컨벤션:

| 관점 | 기존 패턴 (scenario/tagging) | Phase 2 적용 |
|---|---|---|
| **레이어** | `domain`(errors, entities) / `interfaces`(추상) / `infra`(구현) / `models`(Pydantic req·res) / `prompts` / `services`(유스케이스) / `routers` | 동일 — `models/quiz.py` + `prompts/quiz_prompt.py` + `services/quiz_service.py` + `routers/quiz.py` |
| **DI** | `dependencies.py` 모듈 수준 싱글턴 + `get_xxx_service()` 팩토리, 라우터에서 `Depends(get_xxx_service)` | `get_quiz_generator_service()` 추가, `GeminiClient` 싱글턴 재사용 |
| **서비스 의존성** | 생성자에 `ILlmClient`만 주입 (tagging은 `ILlmClient` 단독) | `QuizGeneratorService(llm_client: ILlmClient)` — vector_store 불필요 (RAG 미사용) |
| **LLM 호출** | `await self._llm.complete(messages=[{role, content}], model=...)`. `system` role은 GeminiClient가 `system_instruction`으로 변환 | 동일. `messages = [{"role":"system",...},{"role":"user",...}]` |
| **temperature 전달** | `complete(..., **kwargs)` 로 전달 (`generate_content(**kwargs)`로 흘러감) | 재시도 시 `complete(..., temperature=0)` 사용. **주의**: 현 GeminiClient는 `**kwargs`를 `generate_content`에 직접 넘기므로 `generation_config` 래핑이 필요 — §6-2 호환성 노트 참조 |
| **JSON 파싱** | `raw.strip()` → ```` ``` ```` 코드펜스 제거(`lines[1:-1]`) → `json.loads` → 필드 `.get(...)` | **동일 헬퍼 재사용 패턴**. LangChain 파서 미사용 |
| **응답 길이 보정** | scenario가 `context_summary`를 100자 패딩 / 500자 절단 | 동일 사상으로 문장 30자 초과 절단 (§8-2 가드 5) |
| **에러** | `domain/errors.py`의 `AiServiceError` 계층 상속. 서비스는 도메인 에러 raise, 라우터가 `HTTPException`으로 매핑 | `QuizGenerationError` 계열 4종 신규 추가 |
| **에러 매핑** | 라우터에서 `try/except`로 도메인 에러 → `HTTPException(status, detail)` (`from exc`) | 동일 패턴. 422/502/504 매핑 |
| **모델 명명** | Pydantic은 snake_case (`masked_context`, `target_words`). req=`XxxRequest`, res=`XxxResponse` | `QuizGenerateRequest`, `QuizGenerateResponse`, `PatientNoteIn`, `QuizQuestionOut` |
| **값 검증** | `field_validator`로 도메인 불변식 (`object_tags 1~10개` 등) | `PatientNoteIn.category` Literal, `answer_text` 비어있지 않음 등 |
| **보안 필드 격리** | scenario `guardrail_words`/masking `entity_map`을 **응답 모델에서 제외** | 본 Phase는 한 단계 더 강하게: **요청 모델에서 보호자 필드 자체를 부재시킴** |
| **타임아웃** | (기존 코드에는 명시적 타임아웃 없음) | 신규 도입 — `asyncio.wait_for(timeout=25)` 로 `LLM_TIMEOUT` 구현 (§8-2 / §10) |

> **결론**: 기존 코드에 명시적 LLM 타임아웃과 temperature 재호출이 없으므로, 이 두 가지는 Phase 2에서 **scenario 컨벤션을 깨지 않는 방식으로** 신규 도입한다 (`asyncio.wait_for` 래핑, `complete(**kwargs)` 그대로 사용). GeminiClient 자체는 수정하지 않는 것을 1순위로 하되, `generation_config` 미적용 이슈가 확인되면 §6-2의 최소 수정안을 따른다.

---

## 3. 도메인 모델링

### 3-1. 값 객체 (Value Object)

본 Phase의 "도메인 엔티티"는 식별자 없는 **불변 값 객체**다 (DB 비저장, 1회 생성 후 응답으로 반환). 기존 `domain/entities.py`의 `ScenarioResult`/`TagResult`와 동일한 위상.

```
QuizQuestion (값 객체)         — 생성된 1개 문제
  - type            : 'multiple_choice' | 'yes_no' | 'fill_blank'
  - prompt          : str (문제 텍스트, 1자 이상, 30자 이하)
  - choices         : list[str] | None  (multiple_choice일 때 정확히 4개)
  - correct_answer  : str (비어있지 않음)
  - hint_first_char : str | None  (fill_blank일 때 정답 첫 글자)

  [불변식]
  I1. type == 'multiple_choice' ⇒ choices 길이 == 4 AND correct_answer ∈ choices
  I2. type == 'yes_no'          ⇒ correct_answer ∈ {'yes','no'} AND choices is None
  I3. type == 'fill_blank'      ⇒ hint_first_char == correct_answer의 첫 비공백 글자 AND choices is None
  I4. 모든 type: prompt, correct_answer 비어있지 않음
  I5. prompt 길이 <= 30 (가드 5에서 강제 절단 후 보장)
```

> **설계 판단**: `QuizQuestion`을 별도 `domain/entities.py` 클래스로 둘지, 응답 Pydantic 모델(`QuizQuestionOut`)로 통합할지 검토. 기존 scenario는 `ScenarioResult`(domain) 와 `ScenarioResponse`(models)를 분리한다. 그러나 본 Phase의 문제 객체는 검증 로직이 무겁고(가드 1~5), 응답 형태와 거의 동일하다. **결정**: 단순성을 위해 `models/quiz.py`의 `QuizQuestionOut` Pydantic 모델 하나로 통합하되, 불변식 I1~I5는 `QuizGeneratorService` 내부 검증 + `field_validator`로 강제한다. (scenario도 `ScenarioResult`의 `field_validator`에 핵심 불변식을 둠 → 일관성 유지)

### 3-2. 유스케이스 (Use Case)

```
유스케이스명: GenerateDailyQuiz
  - Actor     : NestJS QuizGenerationClient (시스템)
  - 사전 조건 : patient_notes 1개 이상 AND 합본 글자 수 >= 10
  - 정상 흐름 :
      (1) 입력 검증 — note 0개 또는 합본<10자면 INVALID_PATIENT_NOTES
      (2) distribution 정규화 (없으면 기본값 {mc:2, yn:2, fb:1})
      (3) 프롬프트 구성 (patient_notes/photo_tags?/target_words?/distribution)
      (4) Gemini 호출 (timeout 25s, model=gemini-1.5-flash)
      (5) 응답 JSON 파싱 — 실패 시 temperature=0 1회 재시도 (가드 1)
      (6) 안전 가드 적용 (가드 3·4·5)
      (7) 문제 수 보정 (가드 2: 5개 미만 ⇒ 규칙 기반 빈칸 폴백 보충)
      (8) QuizGenerateResponse 반환
  - 예외 흐름 :
      E1. 입력 부족        → InvalidPatientNotesError → 422
      E2. Gemini 25s 초과  → QuizGenerationTimeoutError → 504
      E3. Gemini 호출 실패 → GeminiApiError (기존) → 502
      E4. 2회 파싱 실패    → 폴백 빈칸 5문제로 정상 200 응답 (실패 아님, R10 (a)+(b) 혼합)
  - 사후 조건 : 응답 questions 길이 == sum(distribution) (기본 5), 모든 문제 불변식 I1~I5 충족,
                보호자 사적 데이터가 입력/프롬프트/로그 어디에도 존재하지 않음
```

### 3-3. 출력 파서 결정 — LangChain PydanticOutputParser 미도입

plan §8-3은 `PydanticOutputParser` "권장"이지만, 사용자 지시는 **"기존 gemini_client 패턴과 일관성 우선 — 기존 코드가 어떻게 하는지 먼저 확인"**. 정독 결과:

- 기존 4개 서비스(tagging/masking/scenario/chat) **전부** 수동 `json.loads` + 코드펜스 제거를 사용. LangChain 파서 사용처 0건.
- `requirements.txt`에 langchain은 있으나, ai-service는 LLM 호출을 자체 `ILlmClient`/`GeminiClient`로 추상화했고 LangChain Runnable 체인을 쓰지 않음.
- PydanticOutputParser를 도입하면 (a) GeminiClient의 `complete()` 반환(raw str) 위에 별도 파서 레이어를 얹어야 하고, (b) 기존 코드와 이질적 패턴이 1개만 생겨 유지보수 비용↑.

**결정**: 기존과 동일하게 수동 파싱 헬퍼(`_strip_code_fence` + `json.loads`)를 사용한다. 단, Phase 2는 안정성 요구가 높으므로 다음을 추가:
1. 코드펜스 제거를 정규식 기반으로 견고화 (` ```json ... ``` ` / ` ``` ... ``` ` / 펜스 없음 모두 처리).
2. `json.loads` 실패 시 본문에서 첫 `{` ~ 마지막 `}` 슬라이스 재시도 (LLM이 앞뒤 설명을 붙인 경우 구제).
3. 그래도 실패하면 가드 1(temperature=0 재호출), 그래도 실패하면 가드 2(폴백 5문제).

---

## 4. 레이어별 인터페이스 명세

의존성 방향: `routers/quiz.py` → `services/quiz_service.py` → `interfaces/llm_client.py`(추상) ← `infra/gemini_client.py`(구현). `models`·`prompts`·`domain.errors`는 안쪽에 위치. **역방향 의존 없음.**

### 4-1. `models/quiz.py` (Pydantic 요청/응답 모델) — [NEW]

```python
"""데일리 퀴즈 생성 엔드포인트 요청/응답 Pydantic 모델.

보안 불변식: 본 요청 모델에는 보호자 사적 데이터 필드
(mood, caregiver_reflection, caregiver_wish_message)가 존재하지 않는다.
Pydantic extra="ignore"로 알 수 없는 필드는 무시되어, 상위(NestJS)가 실수로
보호자 데이터를 보내더라도 모델로 진입조차 하지 못한다.
"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

QuizType = Literal["multiple_choice", "yes_no", "fill_blank"]
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
        return self.multiple_choice + self.yes_no + self.fill_blank


class QuizGenerateRequest(BaseModel):
    """POST /quiz/generate 요청 모델.

    중요: mood / caregiver_reflection / caregiver_wish_message 필드는
    의도적으로 존재하지 않는다 (§14-3 보안 가드).
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


class QuizGenerateResponse(BaseModel):
    """POST /quiz/generate 응답 모델."""
    questions: list[QuizQuestionOut]
    model: str            # 실제 사용 모델명 (예: "gemini-1.5-flash")
    elapsed_ms: int
```

> **명명 주의**: 상위 plan §7-2 예시 응답의 `"model": "gemini-1.5-pro"`는 예시값일 뿐, 본 Phase 기본은 `gemini-1.5-flash`다. 응답 `model` 필드에는 **실제 호출에 성공한 모델명**을 담는다.

### 4-2. `prompts/quiz_prompt.py` (프롬프트 상수) — [NEW]

scenario_prompt.py와 동일하게 **모듈 상수 + `.format()` 플레이스홀더** 패턴. plan §8-1 골격을 `str.format` 호환으로 변환 (Handlebars `{{#each}}`는 코드에서 루프로 문자열을 미리 만들어 `{PATIENT_NOTES}`에 주입).

```python
"""데일리 퀴즈 생성 프롬프트 상수."""

QUIZ_SYSTEM_PROMPT = """당신은 한국어 언어재활 보조 도구의 문제 출제자입니다.
보호자가 작성한 짧은 카테고리별 메모(환자분의 하루)를 바탕으로,
뇌졸중 후 실어증 환자가 풀 수 있는 간단한 사실 확인 퀴즈를 만듭니다.

[안전 가드 — 필수]
- 의학적 진단/조언/예후 언급 금지
- 죽음, 사고, 병명 등 환자에게 정서적 부담을 주는 표현 금지
- 입력 메모에 명시되지 않은 사실을 추측·창작 금지 (반드시 본문에서만 추출)
- 부정형/이중부정 문장 지양
- 모든 문장은 12자 이하 권장, 최대 20자
- 입력에는 보호자의 개인적·정서적 답변(무드, 자기 리플렉션, 한마디 등)이
  절대 포함되어서는 안 됩니다. 만약 그런 텍스트가 보이면 무시하십시오.

[문제 분포]
- 4지선다 {N_MULTIPLE_CHOICE}개
- 예/아니오 {N_YES_NO}개
- 빈칸 채우기 {N_FILL_BLANK}개

[유형별 규칙]
- multiple_choice: 정답 1개 + 메모에 없는 오답 3개(동일 카테고리, 장소↔장소). choices 정확히 4개.
- yes_no: 메모 본문 사실이면 정답 "yes", 본문과 모순이면 "no".
- fill_blank: 메모 핵심 명사 1개를 ___ 로 빈칸 처리. hint_first_char = 정답의 첫 글자(공백 제외).

[입력 — 환자 관련 메모만]
환자분의 하루(카테고리별 답변):
{PATIENT_NOTES}

사진 태그(선택): {PHOTO_TAGS}
목표 단어(선택, 가능하면 포함): {TARGET_WORDS}

[출력 형식 — JSON만, markdown/설명 금지]
{{"questions": [
  {{"type": "multiple_choice", "prompt": "...", "choices": ["..","..","..",".."], "correct_answer": ".."}},
  {{"type": "yes_no", "prompt": "...", "correct_answer": "yes"}},
  {{"type": "fill_blank", "prompt": "오늘 ___을 만났어요.", "correct_answer": "..", "hint_first_char": ".."}}
]}}
추가 설명 없이 JSON만 반환하세요."""

QUIZ_RETRY_INSTRUCTION = (
    "위 조건에 맞는 퀴즈를 생성하세요. 반드시 유효한 JSON 객체 하나만 출력하고, "
    "코드펜스(```)나 설명 문장을 절대 붙이지 마세요."
)
```

> `{{ }}` 이스케이프: `str.format` 충돌 방지를 위해 출력 예시 JSON의 중괄호는 `{{`/`}}`로 이스케이프 (scenario_prompt.py와 동일 기법).

### 4-3. `services/quiz_service.py` (유스케이스) — [NEW]

```python
class QuizGeneratorService:
    """데일리 퀴즈 생성 서비스 (UC: GenerateDailyQuiz).

    ILlmClient에만 의존. 구현체는 생성자 주입. (scenario/tagging과 동일)
    """
    def __init__(self, llm_client: ILlmClient) -> None: ...

    async def generate_quiz(self, request: QuizGenerateRequest) -> QuizGenerateResponse:
        """plan §8-2 가드 1~5 + 폴백을 적용해 5문제를 생성한다.

        Raises:
            InvalidPatientNotesError  : note 0개 또는 합본<10자 → 라우터 422
            QuizGenerationTimeoutError: Gemini 25s 초과 → 라우터 504
            GeminiApiError            : 호출 실패 → 라우터 502
        """

    # --- 내부 헬퍼 (모두 private) ---
    def _validate_notes(self, notes: list[PatientNoteIn]) -> str:
        """합본 텍스트 반환. note 0개/합본<10자면 InvalidPatientNotesError."""

    async def _call_llm(self, prompt: str, *, temperature: float) -> str:
        """asyncio.wait_for(timeout=25)로 self._llm.complete 래핑.
        TimeoutError → QuizGenerationTimeoutError, 그 외 → GeminiApiError(기존)."""

    def _parse_questions(self, raw: str) -> list[dict]:
        """코드펜스 제거 + json.loads + {..} 슬라이스 폴백. 실패 시 ValueError."""

    def _sanitize(self, questions: list[dict], notes_blob: str) -> list[QuizQuestionOut]:
        """가드 3(부분일치)·4(금칙어)·5(30자 절단)를 통과한 문제만 반환."""

    def _backfill(self, questions: list[QuizQuestionOut], notes_blob: str,
                  needed: int) -> list[QuizQuestionOut]:
        """가드 2: 규칙 기반 빈칸 문제로 needed개까지 보충."""
```

상수 (모듈 수준, scenario_service.py 컨벤션):
```python
_QUIZ_MODEL = "gemini-1.5-flash"
_LLM_TIMEOUT_SECONDS = 25
_MAX_SENTENCE_LEN = 30
_MIN_NOTES_BLOB_LEN = 10
_BANNED_WORDS = ["사망", "죽음", "사고", "암", "뇌졸중", "치매", ...]  # 사전 정의 리스트
```

### 4-4. `routers/quiz.py` (어댑터) — [NEW]

scenario.py와 1:1 동형. 도메인 에러 → HTTPException 매핑.

```python
router = APIRouter(prefix="/quiz", tags=["quiz"])

@router.post("/generate", response_model=QuizGenerateResponse, status_code=200)
async def generate_quiz(
    body: QuizGenerateRequest,
    service: QuizGeneratorService = Depends(get_quiz_generator_service),
) -> QuizGenerateResponse:
    try:
        return await service.generate_quiz(body)
    except InvalidPatientNotesError as exc:
        raise HTTPException(422, detail=f"INVALID_PATIENT_NOTES: {exc}") from exc
    except QuizGenerationTimeoutError as exc:
        raise HTTPException(504, detail=f"LLM_TIMEOUT: {exc}") from exc
    except GeminiApiError as exc:
        raise HTTPException(502, detail=f"LLM_UPSTREAM_ERROR: {exc}") from exc
```

### 4-5. `domain/errors.py` (도메인 에러) — [MODIFY]

기존 `AiServiceError` 계층에 추가 (scenario의 `EmptyTargetWordsError`/`ScenarioGuardrailError` 옆):

```python
# 데일리 퀴즈 생성 관련 에러
class InvalidPatientNotesError(AiServiceError):
    """patient_notes가 0개이거나 합본 글자 수가 10자 미만."""

class QuizGenerationTimeoutError(AiServiceError):
    """Gemini 응답이 제한 시간(25초)을 초과."""

class QuizParseError(AiServiceError):
    """Gemini 응답을 2회 시도 후에도 JSON으로 파싱 실패 (서비스 내부에서 폴백으로 흡수)."""
```

> `GeminiApiError`(502 매핑)는 기존 것을 재사용. `QuizParseError`는 서비스 내부에서 가드 2 폴백으로 흡수되므로 라우터까지 전파되지 않음(방어적으로 정의만 해 둠).

### 4-6. `dependencies.py` (Composition Root) — [MODIFY]

```python
from services.quiz_service import QuizGeneratorService
_quiz_generator_service: QuizGeneratorService | None = None

def get_quiz_generator_service() -> QuizGeneratorService:
    """QuizGeneratorService 싱글턴 반환 (FastAPI Depends 용)."""
    global _quiz_generator_service
    if _quiz_generator_service is None:
        _quiz_generator_service = QuizGeneratorService(llm_client=_get_gemini_client())
    return _quiz_generator_service
```

### 4-7. `main.py` (앱 엔트리) — [MODIFY]

```python
from routers import tagging, masking, scenario, chat, quiz
...
app.include_router(quiz.router)
```

---

## 5. 의존성 다이어그램

```
POST /quiz/generate
  └── routers/quiz.py  (generate_quiz)
        │  Depends(get_quiz_generator_service)         ← dependencies.py
        ▼
      services/quiz_service.py  (QuizGeneratorService)
        ├── models/quiz.py        (QuizGenerateRequest/Response, PatientNoteIn ...)
        ├── prompts/quiz_prompt.py (QUIZ_SYSTEM_PROMPT, QUIZ_RETRY_INSTRUCTION)
        ├── domain/errors.py      (InvalidPatientNotesError, QuizGenerationTimeoutError, GeminiApiError)
        └── interfaces/llm_client.py (ILlmClient)  ◄──구현── infra/gemini_client.py (GeminiClient)
                                                              └ dependencies._get_gemini_client() 싱글턴 재사용

의존성 규칙 준수:
 - services → interfaces (추상) O      services → infra (구현) X (절대 import 안 함)
 - routers → services O                models/prompts/domain = 최내곽, 외부 import 없음
 - GeminiClient 교체 시 infra/gemini_client.py 만 수정 (서비스 무영향)
```

---

## 6. 안전 가드 / 폴백 알고리즘 상세 (plan §8-2)

### 6-1. 처리 파이프라인 (generate_quiz 본문)

```
1. notes_blob = _validate_notes(request.patient_notes)
     - len(notes)==0 또는 len("".join(answer_text))<10  → raise InvalidPatientNotesError

2. dist = request.distribution (기본 mc2/yn2/fb1), need = dist.total (기본 5)

3. prompt = build_prompt(notes, photo_tags, target_words, dist)
     - PATIENT_NOTES = "\n".join(f"- [{n.category}] {n.answer_text}" for n in notes)
     - PHOTO_TAGS = json.dumps(photo_tags) if photo_tags else "없음"
     - TARGET_WORDS = ", ".join(target_words) if target_words else "없음"

4. [가드 1] 1차 호출 → 파싱:
     raw = await _call_llm(prompt, temperature=0.7)
     try: parsed = _parse_questions(raw)
     except ValueError:
         raw2 = await _call_llm(prompt, temperature=0.0)   # 재시도 1회
         try: parsed = _parse_questions(raw2)
         except ValueError: parsed = []                    # → 가드 2 폴백이 전량 보충

5. [가드 3·4·5] questions = _sanitize(parsed, notes_blob)

6. [가드 2] if len(questions) < need:
        questions += _backfill(questions, notes_blob, need - len(questions))
   questions = questions[:need]   # 초과분 절단

7. return QuizGenerateResponse(questions=..., model=_QUIZ_MODEL, elapsed_ms=...)
```

> 타임아웃(`_call_llm` 내부 `asyncio.wait_for`)은 4단계의 어느 호출에서든 발생 가능하며, 그 즉시 `QuizGenerationTimeoutError`로 전파되어 504가 된다 (폴백으로 흡수하지 않음 — plan §10).

### 6-2. `_call_llm` 타임아웃 + temperature 구현 (GeminiClient 호환성 노트)

```python
async def _call_llm(self, prompt: str, *, temperature: float) -> str:
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": QUIZ_RETRY_INSTRUCTION},
    ]
    try:
        return await asyncio.wait_for(
            self._llm.complete(
                messages=messages,
                model=_QUIZ_MODEL,
                generation_config={"temperature": temperature},
            ),
            timeout=_LLM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise QuizGenerationTimeoutError(
            f"Gemini 응답이 {_LLM_TIMEOUT_SECONDS}초를 초과했습니다"
        ) from exc
    # GeminiApiError는 _llm.complete가 이미 raise → 그대로 전파
```

> **호환성 노트 (중요)**: 현 `GeminiClient.complete(**kwargs)`는 kwargs를 `genai...generate_content(**kwargs)`에 **직접** 넘긴다. google-generativeai에서 temperature는 `generation_config={"temperature": ...}` 인자로 전달해야 하므로, 위처럼 `generation_config=...`를 kwargs로 넘기면 그대로 동작한다. 별도 GeminiClient 수정 불필요. (`temperature=0.0`을 직접 넘기면 `generate_content`가 모르는 인자라 에러가 날 수 있으므로 반드시 `generation_config`로 래핑.) 실제 SDK 동작이 다르면 GeminiClient에 `generation_config` 처리만 1줄 추가하는 최소 수정으로 대응한다.

### 6-3. `_parse_questions` (출력 파서 안정화)

```
1. cleaned = raw.strip()
2. 코드펜스 제거: ```json\n...\n```  또는  ```\n...\n```  →  내부만 추출 (정규식)
3. try json.loads(cleaned)
4. 실패 시: cleaned[ cleaned.find("{") : cleaned.rfind("}")+1 ] 로 슬라이스 후 재시도
5. data["questions"]가 list 아니면 ValueError
6. 반환: list[dict]  (각 문제는 아직 미검증 raw dict)
```

### 6-4. `_sanitize` (가드 3·4·5)

문제 dict 하나씩 순회하며 다음을 적용, 통과한 것만 `QuizQuestionOut`으로:

```
가드 5 (길이): prompt 30자 초과 → prompt[:30] 절단 + logging.warning("문장 절단", ...)
가드 4 (금칙어): prompt 또는 correct_answer 또는 choices 안에 _BANNED_WORDS 포함 → 문제 제거(스킵)
가드 3 (부분일치, multiple_choice·fill_blank만):
     correct_answer가 notes_blob에 부분 문자열로 존재하지 않으면 → 문제 제거(스킵)
     (yes_no는 correct_answer가 'yes'/'no'라 부분일치 검사 면제)
유형별 정합성:
     multiple_choice: choices 길이 != 4 또는 correct_answer ∉ choices → 제거 (불변식 I1)
     yes_no:          correct_answer ∉ {'yes','no'} → 제거 (I2)
     fill_blank:      hint_first_char 없으면 correct_answer 첫 비공백 글자로 보정 (I3)
```

> **부분일치 기준**: plan §8-2-3 "합본에 존재하는지 부분 일치 검사". 구현은 `correct_answer in notes_blob` (공백 제거 후). R4(빈칸 채점 띄어쓰기·받침 무시)는 NestJS 채점 단계 정책이며, 본 생성 단계는 단순 부분 문자열 포함으로 충분 (생성기는 "환각 방지"가 목적).

### 6-5. `_backfill` (가드 2: 규칙 기반 폴백)

LLM 결과가 부족할 때, **LLM 없이** notes에서 명사 후보를 뽑아 빈칸 문제를 만든다.

```
1. 후보 단어 추출: notes의 answer_text를 공백/조사 기준 토큰화 → 2자 이상 단어 수집
   (간단 휴리스틱: 한글 2~5자 토큰, 조사 '을/를/이/가/에서/에' 접미 제거)
2. 이미 생성된 문제의 correct_answer와 중복되지 않는 단어를 needed개 선택
3. 각 단어 w로 빈칸 문제 구성:
     prompt = 해당 단어가 포함된 원문 문장에서 w를 "___"로 치환 (없으면 "오늘 ___을 기억하나요?")
     type="fill_blank", correct_answer=w, hint_first_char=w[0]
4. 후보 부족 시 최소 보장 문제: prompt="오늘 무엇을 하셨나요? ___", correct_answer=후보 or notes 첫 단어
```

> 폴백 문제도 `_sanitize`의 길이/금칙어 가드를 통과시켜 일관성 유지.

### 6-6. 가드 6·7 (NestJS 측) — 본 Phase 범위 밖, 참조용

plan §8-2의 6(화이트리스트 직렬화)·7(페이로드 hash 로깅)은 **NestJS `QuizGenerationClient`**의 책임으로 Phase 3에서 구현. 본 Phase는 그 대신 **Pydantic `extra="ignore"` + 입력 모델 필드 부재**로 동일 목적(보호자 데이터 차단)을 FastAPI 경계에서 한 번 더 보장한다 (다층 방어).

### 6-7. 로깅 정책 (가드 7 사상 적용)
- LLM 입력 원문(notes 본문)을 INFO 이상 로그에 남기지 않는다. 필요 시 `xxhash`로 해시만 기록.
- 절단/금칙어 제거/폴백 발생은 `logging.warning`으로 카운트만 기록 (본문 미포함).

---

## 7. 에러 처리 전략 (계층별)

| 계층 | 에러/상황 | 처리 | 외부 노출 |
|---|---|---|---|
| service | note 0개 / 합본<10자 | `InvalidPatientNotesError` raise | — |
| service | Gemini 25s 초과 | `asyncio.wait_for` → `QuizGenerationTimeoutError` | — |
| service | Gemini 호출 실패 | GeminiClient가 `GeminiApiError` raise (기존) | — |
| service | JSON 2회 파싱 실패 | 내부 흡수 → 가드 2 폴백 5문제 (예외 전파 안 함) | 200 정상 |
| service | 금칙어/길이/부분일치 위반 문제 | `_sanitize`에서 제거 → 가드 2 보충 | 200 정상 |
| router | `InvalidPatientNotesError` | `HTTPException(422, "INVALID_PATIENT_NOTES: ...")` | 422 |
| router | `QuizGenerationTimeoutError` | `HTTPException(504, "LLM_TIMEOUT: ...")` | 504 |
| router | `GeminiApiError` | `HTTPException(502, "LLM_UPSTREAM_ERROR: ...")` | 502 |
| router | Pydantic 검증 실패 (patient_notes 누락 등) | FastAPI 기본 422 (RequestValidationError) | 422 |

> detail 문자열에 `INVALID_PATIENT_NOTES`/`LLM_TIMEOUT`/`LLM_UPSTREAM_ERROR` 코드 prefix를 둬, NestJS가 에러 코드를 파싱해 처리할 수 있게 한다 (plan §7-2 에러 코드와 일치).

---

## 8. 테스트 전략 (pytest, Given-When-Then)

### 8-1. 테스트 환경 / 더블 전략
- 위치: `ai-service/tests/test_quiz_service.py` (기존 plan §5-1 컨벤션과 동일 위치)
- 더블: `ILlmClient`를 구현한 **FakeLlmClient**(stub) — `complete()`가 미리 지정한 raw 문자열을 반환하거나, 예외를 raise하거나, 지연(timeout 시뮬레이션)하도록 구성. 실제 Gemini/네트워크 미사용 (단위 테스트).
- 비동기: `pytest.mark.asyncio`. (requirements에 pytest-asyncio가 없으면 추가 필요 — §10 의존성)
- 입력 빌더: 정상 `QuizGenerateRequest`를 만드는 헬퍼 fixture (`patient_notes` 3개, 합본 충분).

```python
class FakeLlmClient(ILlmClient):
    def __init__(self, *, raw=None, error=None, delay=0.0, raws=None): ...
    async def complete(self, messages, model, **kwargs) -> str:
        if self.delay: await asyncio.sleep(self.delay)
        if self.error: raise self.error
        # raws가 있으면 호출 순서대로 반환 (재시도 시나리오)
        return self._next_raw()
    async def complete_with_vision(self, *a, **k) -> str: raise NotImplementedError
```

### 8-2. 6개 핵심 케이스

```
[TC-Q1] 정상 생성
  Given: FakeLlmClient가 5문제(mc2/yn2/fb1) 유효 JSON을 반환,
         patient_notes 3개(합본 30자) 요청
  When:  generate_quiz(request) 호출
  Then:  len(response.questions) == 5
         multiple_choice 문제는 choices 길이 4 & correct_answer ∈ choices
         fill_blank 문제는 hint_first_char == correct_answer[0]
         response.model == "gemini-1.5-flash"
         complete가 정확히 1회 호출됨 (재시도 없음)

[TC-Q2] LLM 타임아웃 → 504 매핑 에러
  Given: FakeLlmClient(delay=30)  (>25초 시뮬레이션; 테스트는 _LLM_TIMEOUT_SECONDS를
         monkeypatch로 0.1초로 낮추고 delay=0.5)
  When:  generate_quiz(request) 호출
  Then:  QuizGenerationTimeoutError 발생
         (라우터 레벨 E2E에서는 HTTP 504, detail에 "LLM_TIMEOUT")

[TC-Q3] JSON 깨짐 → temperature=0 재시도 → 그래도 실패 시 폴백 5문제
  케이스 3a: Given FakeLlmClient(raws=["깨진 텍스트", 정상5문제JSON])
            When generate_quiz  Then len==5, complete 2회 호출 (가드 1 재시도 성공)
  케이스 3b: Given FakeLlmClient(raws=["깨진 텍스트", "또 깨짐"])
            When generate_quiz  Then len==5 (전량 규칙기반 빈칸 폴백, 가드 2),
            모든 문제 type=="fill_blank", 예외 미발생(200)

[TC-Q4] 금칙어 필터 (가드 4)
  Given: FakeLlmClient가 5문제 중 1문제 prompt에 "사고" 포함된 JSON 반환
  When:  generate_quiz 호출
  Then:  응답 questions 어디에도 "사고" 미포함
         len == 5 (제거된 1문제는 규칙기반 폴백으로 보충됨)

[TC-Q5] 문장 길이 초과 절단 (가드 5)
  Given: FakeLlmClient가 prompt 45자짜리 문제 포함 JSON 반환
  When:  generate_quiz 호출
  Then:  해당 문제 prompt 길이 <= 30
         (logging.warning 호출 확인 — caplog)

[TC-Q6] 보호자 사적 데이터 미포함 보장 (★ 핵심 보안)
  Given: 요청 dict에 mood=2, caregiver_reflection="오늘 힘들었다",
         caregiver_wish_message="사랑해" 를 추가로 넣어 QuizGenerateRequest(**dict) 생성,
         FakeLlmClient는 complete() 호출 시 전달된 messages를 캡처
  When:  generate_quiz 호출
  Then:  (1) request 객체에 mood/caregiver_reflection/caregiver_wish_message 속성이 없음
             (hasattr == False, extra="ignore"로 무시됨)
         (2) FakeLlmClient가 받은 messages 전체 문자열에
             "오늘 힘들었다", "사랑해" 문자열이 일절 포함되지 않음
         (3) 부분일치 가드(3)는 patient_notes 합본만 기준으로 동작
```

> 추가 권장 케이스(여유 시): 입력 검증 — `patient_notes=[]` 또는 합본<10자 → `InvalidPatientNotesError` (TC-Q7), 부분일치 가드로 환각 문제 제거 검증 (TC-Q8). 6케이스는 필수, 7~8은 보강.

### 8-3. (선택) E2E 라우터 테스트
기존 plan §5-3 `tests/e2e/test_endpoints.py` 컨벤션에 맞춰, `TestClient` + `app.dependency_overrides[get_quiz_generator_service]`로 FakeLlmClient 주입한 `QuizGeneratorService`를 오버라이드하여 HTTP 200/422/504 status 매핑을 검증한다 (Phase 2 필수는 아님, 권장).

---

## 9. SOLID 준수 점검

| 원칙 | 점검 | 결과 |
|---|---|---|
| **S** 단일 책임 | router=HTTP 변환, service=생성·가드, prompt=문구, models=계약, gemini_client=API 통신. 각 1책임 | ✅ |
| **O** 개방-폐쇄 | 새 문제 유형 추가 시 `QuizType` Literal + `_sanitize` 분기 추가로 확장. 금칙어/분포는 상수 교체 | ✅ (유형 추가 시 `_sanitize` 수정은 불가피 — 허용 범위) |
| **L** 리스코프 | `QuizGeneratorService`는 `ILlmClient`에만 의존 → GeminiClient/FakeLlmClient/OpenAIClient 상호 치환 | ✅ |
| **I** 인터페이스 분리 | 기존 `ILlmClient`(complete/complete_with_vision) 재사용. 본 서비스는 `complete`만 사용(vision 미사용)하나 별도 인터페이스 분리는 과설계로 판단, 기존 유지 | ✅ (기존 컨벤션 일관성 우선) |
| **D** 의존성 역전 | service → `interfaces.llm_client.ILlmClient`(추상), 구현은 `dependencies.py`에서 주입. service는 infra를 import하지 않음 | ✅ |

---

## 10. 의존성 / 환경

| 항목 | 현황 | 조치 |
|---|---|---|
| `google-generativeai` | 설치됨 (>=0.8.0) | 그대로 |
| `pydantic` | 2.12.5 | `ConfigDict`/`field_validator` 사용 (v2 OK) |
| `pytest` / `pytest-asyncio` | **requirements.txt에 없음** | 테스트 실행 위해 추가 필요: `pytest`, `pytest-asyncio` (또는 `anyio` 백엔드). 기존 plan이 pytest 사용을 전제하나 미설치 — Phase 2에서 dev 의존성으로 추가 (User Review 항목 Q-D) |
| `xxhash` | 설치됨 (3.6.0) | 로깅 해시에 재사용 가능 |
| `GEMINI_API_KEY` | `_get_gemini_client()`가 env에서 로드 | 단위 테스트는 FakeLlmClient라 불필요. E2E도 override로 불필요 |

---

## 11. 위험 요소 및 대응

| 위험 | 가능성 | 영향 | 대응 |
|---|---|:--:|---|
| GeminiClient가 `generation_config` kwarg를 못 받아 temperature 재시도 실패 | 보통 | 높음 | §6-2 호환성 노트대로 `generation_config={"temperature":..}` 전달. 실패 시 GeminiClient에 1줄 처리 추가(최소 수정). 통합 테스트(IT)로 사전 검증 |
| Gemini가 5개 미만/형식 위반 문제를 자주 생성 | 보통 | 보통 | 가드 2 규칙기반 폴백으로 항상 need개 보장. 폴백 품질은 빈칸 위주라 임상상 허용 |
| 규칙기반 폴백의 한글 토큰화(조사 제거) 품질 저하 | 높음 | 낮음 | 단순 휴리스틱으로 시작, 부정확해도 "사실 확인" 목적상 치명적이지 않음. 추후 형태소 분석기(konlpy 등) 도입은 별도 결정 |
| `asyncio.wait_for` 취소 후에도 백그라운드 Gemini 호출이 계속 비용 발생 | 낮음 | 낮음 | 비용 미미(flash). plan §14-2의 throttle은 NestJS에서 별도 처리 |
| 금칙어 리스트가 임상적으로 불충분 | 보통 | 보통 | 초기 리스트 + 임상 자문 1회 리뷰(plan §14-2). 상수 파일이라 교체 용이 |
| 보호자 데이터가 prompt 문자열 빌드 중 실수로 끼어듦 | 낮음 | 매우높음 | prompt 빌더는 `request.patient_notes`/`photo_tags`/`target_words`/`distribution`만 참조. 입력 모델에 보호자 필드 부재 + TC-Q6로 회귀 방어 |

---

## 12. 확장성 시나리오 평가

| 미래 변경 | 현 설계 수용도 |
|---|---|
| LLM 교체 (Gemini → GPT-4o) | ✅ `infra`에 `OpenAIClient(ILlmClient)` 추가 + `dependencies.py` 1줄 교체. 서비스 무변경 |
| 사진 분석 도입 (R7(b)) | ✅ `photo_tags` 입력 이미 수용. NestJS가 `/tag` 결과 병합해 보내면 프롬프트에 자동 반영. 본 Phase 변경 불필요 |
| 문제 유형 추가 (예: 순서 맞추기) | △ `QuizType` Literal + `_sanitize`/`_backfill` 분기 추가 필요 (O 원칙상 일부 수정 불가피) |
| 분포 동적 조정 강화 (R6 (c) 보호자 선택) | ✅ `distribution`이 이미 요청 파라미터. NestJS가 값만 바꿔 전달 |
| Phase 6 `/wish/to-practice` | ✅ 본 프롬프트와 **별도 파일**(`prompts/wish_to_practice_prompt.py` + `routers/wish.py`)로 분리 예정 — 본 §8-1 메인 프롬프트 입력에 보호자 한마디 절대 미포함 |
| 출력 파서를 LangChain으로 전환 | ✅ `_parse_questions`만 교체. 인터페이스 불변 |

---

## 13. 구현 체크리스트 (task.md)

```
## Daily Quiz Phase 2 — FastAPI 퀴즈 생성기

### Domain / Models (최내곽)
- [ ] [쉬움] domain/errors.py: InvalidPatientNotesError / QuizGenerationTimeoutError / QuizParseError 추가
- [ ] [보통] models/quiz.py: PatientNoteIn, PhotoTagsIn, QuizDistribution,
            QuizGenerateRequest(보호자 필드 부재 + extra="ignore"),
            QuizQuestionOut, QuizGenerateResponse + field_validator

### Prompts
- [ ] [어려움] prompts/quiz_prompt.py: QUIZ_SYSTEM_PROMPT(§8-1 골격, {{ }} 이스케이프) + QUIZ_RETRY_INSTRUCTION

### Application (Service)
- [ ] [보통] services/quiz_service.py: 상수(_QUIZ_MODEL=flash, timeout=25, _MAX_SENTENCE_LEN=30, _BANNED_WORDS)
- [ ] [보통]   _validate_notes (합본<10자 → InvalidPatientNotesError)
- [ ] [보통]   _call_llm (asyncio.wait_for 25s + generation_config temperature)
- [ ] [어려움]  _parse_questions (코드펜스 제거 + json.loads + {..} 슬라이스 폴백)
- [ ] [어려움]  _sanitize (가드 3 부분일치 / 4 금칙어 / 5 30자 절단 / 유형 정합성)
- [ ] [보통]   _backfill (가드 2 규칙기반 빈칸 폴백)
- [ ] [보통]   generate_quiz (가드 1 재시도 파이프라인 §6-1)

### Infrastructure (DI / Router / App)
- [ ] [쉬움] dependencies.py: get_quiz_generator_service() 싱글턴 팩토리
- [ ] [쉬움] routers/quiz.py: POST /quiz/generate + 에러→HTTPException(422/502/504) 매핑
- [ ] [쉬움] main.py: include_router(quiz.router)
- [ ] [쉬움] (필요 시) infra/gemini_client.py: generation_config kwarg 처리 1줄 (호환 확인 후)

### Tests
- [ ] [쉬움] requirements: pytest + pytest-asyncio 추가 (User Review Q-D 승인 후)
- [ ] [보통] tests/test_quiz_service.py: FakeLlmClient stub
- [ ] [보통]   TC-Q1 정상 / TC-Q2 타임아웃 / TC-Q3 JSON깨짐(재시도+폴백)
- [ ] [보통]   TC-Q4 금칙어 / TC-Q5 길이초과 / TC-Q6 보호자데이터 미포함(★)
- [ ] [쉬움]   (보강) TC-Q7 입력검증 / TC-Q8 환각 부분일치 제거
- [ ] [쉬움] (선택) tests/e2e/test_endpoints.py: /quiz/generate 200/422/504
```

---

## 14. Proposed Changes (파일 단위)

| # | 파일 | 종류 | 내용 |
|---|---|---|---|
| 1 | `ai-service/models/quiz.py` | NEW | §4-1 Pydantic 모델 (보호자 필드 부재) |
| 2 | `ai-service/prompts/quiz_prompt.py` | NEW | §4-2 프롬프트 상수 |
| 3 | `ai-service/services/quiz_service.py` | NEW | §4-3 QuizGeneratorService + 가드 1~5 + 폴백 |
| 4 | `ai-service/routers/quiz.py` | NEW | §4-4 POST /quiz/generate |
| 5 | `ai-service/domain/errors.py` | MODIFY | §4-5 에러 3종 추가 |
| 6 | `ai-service/dependencies.py` | MODIFY | §4-6 get_quiz_generator_service 팩토리 |
| 7 | `ai-service/main.py` | MODIFY | §4-7 include_router(quiz.router) |
| 8 | `ai-service/infra/gemini_client.py` | MODIFY(조건부) | §6-2 generation_config 처리 (호환 확인 후 필요 시만) |
| 9 | `ai-service/tests/test_quiz_service.py` | NEW | §8 6케이스 + FakeLlmClient |
| 10 | `ai-service/requirements.txt` | MODIFY | pytest, pytest-asyncio dev 의존성 |
| 11 | `ai-service/tests/e2e/test_endpoints.py` | MODIFY(선택) | /quiz/generate E2E |

---

## 15. User Review Required (Phase 2 진입 전 결정)

| # | 항목 | 옵션 / 권장 |
|---|---|---|
| Q-A | **기본 모델** | (a) `gemini-1.5-flash` 고정 / (b) flash 시도 후 품질 미달 시 pro 폴백(plan §8-3) — **권장 (a)** 우선, (b)는 Phase 후속. 응답 `model` 필드엔 실제 모델명 |
| Q-B | **출력 파서** | (a) 기존 수동 json.loads 컨벤션 유지(본 plan 채택) / (b) LangChain PydanticOutputParser 도입 — **권장 (a)** (기존 일관성, §3-3) |
| Q-C | **금칙어 리스트 출처** | (a) 본 plan 인라인 상수 / (b) 별도 `constants/banned_words.py` 파일 — **권장 (b)** (교체 용이, 임상 자문 반영) |
| Q-D | **테스트 의존성 추가** | requirements.txt에 `pytest`+`pytest-asyncio` 추가 필요 (현재 미설치). 승인 요청 |
| Q-E | **GeminiClient 수정 허용 여부** | temperature 전달 위해 `generation_config` 처리 1줄 추가가 필요할 수 있음. (a) 호환되면 무수정 / (b) 최소 수정 허용 — **권장 (b) 허용** (§6-2) |
| Q-F | **폴백 5문제도 정상 200으로 반환** vs **실패 표기** | plan R10은 (a)재시도+알림 확정이나, §8-2-2는 폴백 보충을 규정. 본 plan은 **"파싱 2회 실패 시에도 규칙기반 폴백으로 200 반환"** 채택. NestJS가 폴백 여부를 알 필요가 있으면 응답에 `fallback_used: bool` 추가 검토 — **권장: 응답에 `fallback_used` 메타 추가** (NestJS가 generation_error 기록 판단 가능) |

---

## 16. 승인 요청

본 Phase 2 Feature Plan은 **설계 전용**이며 코드 변경을 포함하지 않습니다. 다음을 검토 후 승인해 주세요.

1. §3-3 / Q-B: 출력 파서를 **기존 수동 json.loads 컨벤션 유지**로 결정 (LangChain 미도입).
2. §6-2 / Q-E: temperature 재시도를 위한 GeminiClient 최소 수정 허용 여부.
3. §10 / Q-D: 테스트 실행을 위한 pytest 의존성 추가 승인.
4. Q-F: 파싱 실패 시 폴백 5문제를 200으로 반환 + 응답 `fallback_used` 메타 추가 여부.

승인 시 다음 순서로 실행 준비 완료입니다: `clean-code-developer`(§13 체크리스트 Domain→Service→Infra→Tests 순) → `unit-test-runner`(§8 6케이스).
```
