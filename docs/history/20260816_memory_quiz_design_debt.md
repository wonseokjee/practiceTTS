# 기억 기반 데일리 퀴즈 — 개인화의 단위가 잘못 잡혀 있다

> 발견일: 2026-08-16 (같은 날 2절 해결)
> 상태: **1절 미해결 · 2절 해결(PR #44)**
> 관련 코드(1절): `ai-service/prompts/quiz_prompt.py`,
> `backend/src/quiz/quiz.service.ts` (`diversifyRecallQuestions`)
> 관련 코드(2절, 해결): `frontend/.../infrastructure/QabItemBank.ts`
> (`buildSpellTiles`·`distractorCountForLevel`),
> `frontend/.../presentation/components/SpellTileItem.tsx`
> (`backend/src/quiz/services/tile-builder.ts`는 삭제됐다)

두 가지가 겹쳐 있었다. 문항 유형의 난이도가 고정이라는 것과, **개인화의 단위를
잘못 잡았다**는 것이다.

**2절(타일 난이도)은 2026-08-16 해결됐다**(PR #44). 남은 부채는 1절이다.

---

## 1. 개인화의 단위가 "문항"이 아니라 "목표 단어"여야 한다

### 지금 구조

```
보호자 메모(하루 기록)  →  LLM  →  그 메모의 사실을 묻는 문항  →  하루치 퀴즈
```

`quiz_prompt.py`는 "보호자가 작성한 짧은 메모를 바탕으로 사실 확인 퀴즈"를 만든다.
자기검증(critique) 패스로 정답 유일성·오답 타당성·자연스러움까지 심사한다.
**품질 관리는 이미 있는데도 결과물이 약하다** — 그래서 프롬프트 문제가 아니라
구조 문제로 본다.

### 왜 약한가

| 문제 | 설명 |
|---|---|
| **문항이 메모 품질에 종속** | 보호자가 두 줄 쓰면 물어볼 게 두 줄어치뿐이다. 재활 난이도가 아니라 기록량이 그날 난이도를 정한다 |
| **반복이 없다** | 매일 새 메모 → 매일 새 문항. 어제 틀린 단어가 오늘 다시 나오지 않는다 |
| **난이도 통제 불가** | LLM 생성 문항은 길이·음절 수·빈도·음운 복잡도가 제각각이다. 오늘 만든 적응 레벨링(1~5단계)이 붙을 자리가 없다 |
| **재활 목표와 느슨함** | "사실 확인 퀴즈"는 기억 확인이지 이름대기·따라말하기 훈련이 아니다 |

### 근거가 가리키는 방향

실어증 이름대기 치료에서 **개인적으로 의미 있는 자극**은 효과가 확인돼 있다 —
같은 스크립트 안에서도 개인 관련 항목이 일반 항목보다 이득이 크다. 다만 문헌이
말하는 개인화의 단위는 **훈련하는 목표 단어(item)**다. "개인적으로 의미 있고
소통 가치가 있는 항목을 훈련해야 한다"는 표현이 반복된다.

그리고 결정적으로, **치료 효과는 훈련한 그 단어를 크게 넘어가지 않는다**
(limited transfer beyond targeted words). PPA 사례 연구에서 139개 단어를 20개월
유지한 것도 그 단어들을 반복 훈련했기 때문이다.

즉 이득을 얻으려면 **같은 목표 단어가 여러 세션에 걸쳐 반복**돼야 한다.
지금 구조는 매일 다른 메모에서 매일 다른 문항을 만들어 정확히 그 반대로 간다.

### 제안 — 메모는 문항 재료가 아니라 **앵커**

```
보호자 메모  →  목표 단어 추출·연관  →  커리큘럼 문항 풀에서 그 단어의 문항 선택
                                        (난이도는 적응 레벨이 결정)
```

- 메모에 "손자와 공원 산책" → 목표 단어 `공원`·`산책`·`나무`를 **개인 목표 목록**에
  올린다. 문항 자체는 검증된 커리큘럼 풀에서 온다.
- 같은 목표 단어가 며칠에 걸쳐 반복된다(간격 반복). 문헌이 말하는 이득 조건이다.
- 문항의 음절 수·빈도·보기 수가 통제되므로 **적응 레벨링이 그대로 붙는다.**
- 개인화는 "왜 이 단어인가"의 맥락으로 남는다 — 동기부여는 유지된다.
  ("손자분과 다녀오신 공원이에요")

LLM의 역할이 **문항 생성**에서 **메모 → 목표 단어 연관**으로 바뀐다. 훨씬 좁은
작업이라 품질 관리도 쉽다. 이미 `TARGET_WORDS` 입력이 프롬프트에 있으니 방향을
뒤집는 셈이다.

> 주의: 커리큘럼 풀에 없는 개인 단어(가족 이름, 지역 지명)는 여전히 필요하다.
> 그 경우에만 문항을 생성하되, 생성된 문항도 **여러 날 반복**돼야 의미가 있다.

---

## 2. ~~음절 타일 난이도가 고정이다~~ → 해결 (2026-08-16, PR #44)

타일 과제를 **보호자 메모에서 떼어내 커리큘럼 단어 풀 위에 다시 세웠다.**

### 무엇이 문제였나

백엔드가 LLM의 `fill_blank`를 번갈아 `tile_arrange`/`speech`로 바꿨고, 타일은
`buildTiles(q.correctAnswer)` — **레벨 인자 없이 방해 타일 항상 3개**였다.

- 상용 치료 도구는 단어 길이(3·4·5·6+) × 방해 글자(**0/2/4개**)로 12단계
  등급화한다. 우리에겐 **방해 0개 진입 단계가 없었다**
- QAB 문항은 `buildControlledChoices(target, level)`로 조절되는데 타일은 레벨이
  안 걸렸다
- 기억 회상 + 음절 조합이 한 문항에 겹쳐, 틀렸을 때 원인이 분리되지 않았다
- 방해 음절이 정답 무관 랜덤이라 오답에 진단 정보가 없었다

과제 유형 자체는 근거가 있다(**ACT**, Beeson 1999~). 다만 ACT는 **쓰기** 치료이고,
효과는 조합이 아니라 **copy+recall 반복**에서 오며, 연구에서 **말하기로는 전이되지
않았다**. 이 점은 아래 「남은 것」과 이어진다.

### 어떻게 고쳤나

| | 전 | 후 |
|---|---|---|
| 출처 | 보호자 메모 → LLM 변환 | 커리큘럼 단어 풀(단어이해와 동일) |
| 난이도 | 방해 3개 고정 | **레벨 연동** 1~2: 0개 / 3~4: 2개 / 5: 4개 |
| 분류 | 기억 퀴즈에 묻힘 | **새 subtest `spell`** (별도 레벨·회복 추이) |
| 단서 | 없음 | **그림** — 없으면 다시 회상 과제가 된다 |
| 반복 | 없음 | 단어 풀에서 반복 출제 가능 |

`word`(듣고 고르는 **이해**)에 합치지 않았다. 타일은 **산출** 과제라 한 레벨로
묶으면 두 능력의 신호가 섞인다.

### 남은 것

- **방해 음절을 음운 유사로**(레벨 4~5) — 지금은 랜덤이라 오답이 진단 정보가
  되지 않는다. `phoneticDistance` 재사용 가능
- **단서 위계** — 못 하면 음절 수 → 방해 타일 제거 순으로 도움을 주고 `assisted`로
  기록. 실어증 단어 인출의 표준 접근이 cueing hierarchy다
- **copy+recall 단계** — ACT의 효과가 실제로 나오는 지점. 지금은 조합 1회뿐이라
  이 과제가 쓰기 회복으로 이어질지는 미지수다
- **문항 수 배분** — `spell` 1개 고정. "결손 비율 ≤40% 배분"과 함께 볼 것

## 우선순위

2절은 끝났다. **남은 부채는 1절(개인화 단위)이고, 이게 근본이다.**

다만 1절은 커리큘럼 문항 풀과 목표 단어 관리라는 새 구조가 필요해 크다. 별도
설계로 다루되, 아래 「아직 안 한 측정」을 먼저 하는 게 순서다 — 오늘 발화 등급
부채에서 실측이 분석을 뒤집은 전례가 있다.

## 아직 안 한 측정

1절을 고치기 전에 재야 할 것들이다.

- 실제 생성된 문항의 품질을 사람이 표본 평가한 적이 없다. "약하다"는 인상이지
  수치가 아니다. `quiz_sets`에서 30~50문항을 뽑아 정답 유일성·자연스러움·재활
  관련성을 평가하면 1절의 근거가 단단해진다.
- 같은 목표 단어가 실제로 며칠에 걸쳐 반복되는지 — `quiz_questions`에서
  `correct_answer` 재등장 빈도를 세면 "반복이 없다"는 주장이 확인된다.

## 관련

- `docs/history/20260816_speech_grade_threshold_debt.md` — 문장 발화 채점 등급 문제
- `docs/asr/608-finetune-log.md` — 자체 ASR 진행. 대화 모드는 자유 발화 STT 대기 중

## 참고 문헌

- Personalization of Words in Anomia Treatment for People With Aphasia: A Scoping
  Review (AJSLP) — https://pubs.asha.org/doi/10.1044/2026_AJSLP-25-00512
- Relearning and Retaining Personally-Relevant Words using Computer-Based Flashcard
  Software in PPA (Frontiers) — https://pmc.ncbi.nlm.nih.gov/articles/PMC5110537/
- What do people with aphasia want to be able to say? (PLOS One) —
  https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0174065
- Anagram Copy and Recall Treatment for Writing (Tactus Therapy) —
  https://tactustherapy.com/anagram-copy-recall-treatment-writing/
- The Use of Written Naming and Repetition to Treat Naming Deficits in Aphasia
  (AJSLP) — https://pubs.asha.org/doi/10.1044/2019_AJSLP-19-00046
- Cueing Hierarchy Treatment for Word Finding in Aphasia (Tactus Therapy) —
  https://tactustherapy.com/cueing-hierarchy-word-finding-aphasia/
