# 기억 기반 데일리 퀴즈 — 개인화가 재활 효과로 이어지지 않는다

> 발견일: 2026-08-16
> 상태: 미해결 (부채 기록)
> 관련 코드: `ai-service/prompts/quiz_prompt.py`,
> `backend/src/quiz/quiz.service.ts` (`diversifyRecallQuestions`),
> `backend/src/quiz/services/tile-builder.ts`,
> `frontend/src/memory-link/patient/quiz/presentation/components/TileArrangeInput.tsx`

두 가지가 겹쳐 있다. 하나는 문항 유형의 난이도가 고정이라는 것, 다른 하나는
**개인화의 단위를 잘못 잡았다**는 것이다. 두 번째가 더 근본적이다.

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

## 2. 음절 타일(`tile_arrange`) 난이도가 고정이다

### 지금 구조

백엔드가 LLM의 `fill_blank` 문항을 번갈아 `tile_arrange`/`speech`로 변환한다
(`diversifyRecallQuestions`). 타일은 이렇게 만들어진다.

```typescript
const DEFAULT_DISTRACTOR_COUNT = 3;   // 항상 3개
buildTiles(q.correctAnswer)           // 레벨 인자가 없다
```

### 과제 유형 자체는 근거가 있다

음절/철자 조합은 실어증 치료에 실재하는 기법이다(**ACT**, Beeson 1999 이후).
다만 조건이 다르다.

| | ACT | 우리 앱 |
|---|---|---|
| 목표 | 쓰기(written naming)·실서증 | 기억 회상 |
| 기전 | 조합 → **베껴쓰기 → 회상** 반복 | 조합 1회 |
| 전이 | **말하기로는 전이되지 않음**(연구에서 확인) | 말하기 개선을 기대 |

ACT의 효과는 조합 단계가 아니라 copy+recall 반복에서 온다. 우리는 그 부분이 없다.

### 문제

- **방해 타일이 늘 3개.** 상용 치료 도구는 이 과제를 단어 길이(3·4·5·6+) ×
  방해 글자(**0 / 2 / 4개**)로 12단계 등급화한다. 우리에겐 방해 0개짜리 진입
  단계가 없다.
- **적응 레벨링이 안 걸린다.** QAB 문항은 `buildControlledChoices(target, level)`로
  보기 수를 조절하는데 `tile_arrange`는 레벨 없이 만들어진다.
- **두 과제가 겹쳐 있다.** 기억 회상 + 음절 조합이 한 문항에 섞여, 틀렸을 때
  기억을 못 떠올린 건지 조합을 못 한 건지 분리되지 않는다.
- **방해 음절이 랜덤이다.** `가·나·다·라…` 같은 정답 무관 음절이라, 음운 유사
  방해자였다면 얻을 수 있는 진단 정보(음운 오류 여부)가 없다.

조작 부담은 문제 없다 — 탭 방식에 최소 높이가 확보돼 있다(고령 접근성 고려).
**운동이 아니라 인지 부하가 문제다.**

### 고칠 방향

1. **`buildTiles`에 레벨을 넘긴다** — 레벨 1~2는 방해 0개(정답 음절 재배열만),
   3~4는 2개, 5는 4개. 인자 하나 추가이고, 이미 있는 적응 레벨링에 편입시키는
   것이라 새 개념을 만들지 않는다. **가장 먼저 할 것.**
2. **방해 음절을 음운 유사로** — 정답 음절과 초성/중성이 가까운 음절. 레벨 4~5용.
   오답이 진단 정보가 된다. `phoneticDistance`를 재사용할 수 있다.
3. **단서 위계** — 못 하면 첫 글자 → 음절 수 → 방해 타일 제거 순으로 도움을 주고,
   도움받은 것은 `assisted`로 기록한다(그 필드는 이미 있다). 실어종 단어 인출의
   표준 접근이 cueing hierarchy다.

---

## 우선순위

**1절(개인화 단위)이 근본이고 2절(타일 난이도)이 국소적이다.** 다만 1절은 커리큘럼
문항 풀과 목표 단어 관리라는 새 구조가 필요해 크다. 2절 1번은 인자 하나라 오늘
당장 가능하다.

순서는 **2절 1번 → 1절** 을 권한다. 작은 것으로 적응 레벨링의 적용 범위를 넓혀
두고, 개인화 구조는 별도 설계로 다룬다.

## 아직 안 한 측정

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
