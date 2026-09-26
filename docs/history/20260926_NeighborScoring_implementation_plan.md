# 이웃 비교 채점 — 구현 계획 (2026-09-26)

> 설계·실측: [`20260926_NeighborScoring_design.md`](20260926_NeighborScoring_design.md)
> (팔 C 채택, 해석 범위 10절, 미결 항목 11절). 이 문서는 11절의 결정을 반영한 구현 계획이다.

## 0. 확정한 결정 (사용자, 2026-09-26)

| 11절 항목 | 결정 | 근거 |
|---|---|---|
| 1. 따라말하기 적용 | **이름대기에만 적용.** 따라말하기는 현행(v1) 유지 | 부분 명칭 통과는 이름대기의 정의다. 따라말하기 정의로는 팔 C가 6.4%로 목표 미달 |
| 2. 영어 | **ko-KR에만 적용.** en-US는 현행 유지 | 한국어만 검증했다 |
| 3. 재시도와 단서 위계 | **단서 단계 유지, 재시도는 도움 아님**(`assisted` 안 붙임) | 틀려서가 아니라 채점기가 확신하지 못해서 다시 묻는 것이다 |

## 1. 범위

**하는 것:** 이름대기(`naming`) × `ko-KR` × 기능 플래그 켬 → 목표 + 이웃 3 + 후보 없는 STT 전사로
3값 판정(정답·모호·오답). 모호면 1회 재시도, 다시 모호면 채점 불가(사유 `ambiguous`).

**안 하는 것:** 따라말하기·읽기·문장, en-US, 연습 모드(Azure를 안 쓴다), 자체 ASR 경쟁자.
이 경로들은 지금 채점 그대로이고 `scorer_version`만 `azure-pa-v1`로 찍힌다.

## 2. 데이터 흐름

```
PictureNamingItem ─녹음─▶ SpeechCaptureService.tryAssess
   form: audio, lang, reference_text, competitors=["사자","낙타","수달"], stt_competitor=true
        │   (competitors는 프론트 정적 자산 neighborManifest.ko-KR.json에서)
        ▼
backend /ai/pronunciation  (필드 검증·전달, 사용자별 한도 12/분 그대로 — 요청 1개)
        ▼
ai-service /pronunciation
   1차(병렬): PA(목표) ‖ STT(후보 목록 없이)
   목표 accuracy < 60 또는 NoMatch → 여기서 끝(경쟁자 안 부름)
   2차(병렬): PA(이웃 3) ‖ PA(STT 전사 — 비어 있지 않고 목표와 다를 때만)
   응답: 기존 필드 + competitor_scores[] + stt_transcript
        ▼
pronunciationScore.ts  evaluateNamingWithNeighbors(...)   ← 판정의 단일 진실
   → pass | ambiguous | fail | unscored
        ▼
useMixedQuizSession.submitNaming → qab_results
   (scorer_version = azure-pa-nbr-v1, unscored_reason = ambiguous | no_score)
```

**판정 정의는 프론트 도메인 한 곳**(`pronunciationScore.ts`)에 둔다. ai-service는 점수만 낸다.
전사가 "정답으로 보는 변형"(사과요, 부분 명칭)인지도 프론트가 가른다. ai-service는 전사가 비었거나
목표와 문자열이 같을 때만 호출을 건너뛴다. 가끔 쓸모없는 호출이 한 번 더 나가지만, 판정 규칙이
두 곳으로 갈라지는 것보다 싸다.

## 3. PR 단위 (순서대로, **스택 PR 금지** — 앞 PR이 main에 들어간 뒤 다음을 딴다)

각 PR은 기능 플래그가 꺼진 상태에서 앱 동작을 바꾸지 않는다. 그래서 하나씩 머지해도 안전하다.

### PR 1 — 이웃 목록 자산

> **구현됨(2026-09-26).** 이름대기 낱말 89개. 아래 계획에서 달라진 점은 없고, 두 가지를 더했다.
> `--check` 모드(파일이 낡았는지만 본다)와, 낡음을 잡는 pytest(`scripts/asr_eval/test_neighbor_manifest_asset.py`)다.
> CI가 없어서(TODOS `ci-pipeline`) 낡음은 두 테스트를 손으로 돌릴 때 드러난다.

- `scripts/build_neighbor_manifest.py`: `scripts/asr_eval/neighbor_manifest.py`(0단계와 **같은 함수**)로
  이름대기 대상 단어(`pickNamingItems`가 낼 수 있는 전 단어: 낱말 풀 중 사진 있는 것 + 이름대기 전용)
  마다 이웃 3개를 만든다.
- 산출: `frontend/src/assets/data/neighborManifest.ko-KR.json` (`{version, k, neighbors: {단어: [..]}}`).
- 테스트
  - Python: 결정성, 자신·포함관계 제외(기존 `test_neighbor_scoring.py` 재사용).
  - **Vitest 소비자 테스트:** 이름대기에 나올 수 있는 모든 `targetWord`에 목록이 있다. 낱말을 추가하고
    목록을 다시 안 만들면 여기서 깨진다(`WORD_CATEGORY`↔`namingCue` 회귀의 교훈).

### PR 2 — ai-service `competitors` · `stt_competitor`

> **구현됨(2026-09-26).** 계획에서 달라지거나 더해진 것:
>
> - 응답에 **`stt_status`**(`ok` | `empty` | `error`)와 **`competitors_skipped: "no_match"`**를 더했다. 인식 호출이
>   실패한 것(`error`)과 인식 결과가 없는 것(`empty`)은 판정이 달라서(전자는 채점 불가, 후자는 경쟁자 없음)
>   `stt_transcript: null`만으로는 가를 수 없었다.
> - 경쟁자 항목에 **`source`**(`neighbor` | `stt`)를 실었다. 전사가 이웃 하나와 같으면 그 점수를 재사용하되
>   **`source: "stt"` 항목은 항상 하나 있다**(프론트가 "STT 경쟁자 있음/없음"을 한 규칙으로 읽는다).
> - `competitors` 검증: 원본 개수 5개·항목 30자 상한(정리 전 기준), 형식 오류 400. 빈 항목·목표와 같은 항목·중복은
>   조용히 버린다. `stt_competitor`는 불리언(그 밖의 값은 422).
> - 한도: 라우터가 요청 1건을 먼저 차감한 뒤 `최대 호출 수 - 1`을 더 차감한다(거절되면 추가분은 차감 안 함).
>   `SlidingWindowRateLimiter.allow(key, cost=1)`. **`PRONUNCIATION_RATE_LIMIT_PER_MIN`의 단위가 요청에서 호출로 바뀌었다**
>   (`.env.example` 갱신). 기본 240이면 경쟁자 요청은 전역 40건/분이다 — PR 6에서 실사용을 보고 조정한다.
> - 경쟁자 서비스는 `CompetitorService`(`services/competitor_service.py`)로 분리했다. STT 서비스는 지연 생성이라
>   경쟁자를 안 쓰는 요청은 STT 설정 누락에 영향받지 않는다.
> - `COMPETITOR_SKIP_BELOW`(60)는 프론트 정답선(`pronunciationScore.ts`의 `good`)과 같아야 해서 테스트가 두 값을
>   대조한다.
> - **실제 Azure 스모크**(608 test 단어 20개): 인식 결과가 0단계 실측 때와 **20/20 일치**, 목표 점수 차이 0,
>   경쟁자 오류 0건, 항목당 지연 평균 1.5초·최대 2.6초. 이웃 점수는 57쌍 중 56쌍이 같았고 1쌍이 달랐다
>   (날개←물개 41점 → 0점, Azure의 호출 간 변동).

- 요청(multipart, 선택): `competitors` = JSON 배열 문자열(최대 5개, 각 30자 이하), `stt_competitor` = `"true"`.
  둘 다 없으면 **지금과 바이트 단위로 같은 응답**(하위 호환).
- 응답 추가 필드:
  - `competitor_scores: [{text, accuracy_score, recognized_text, status}] | null`
    — `status`는 `ok` | `no_match` | `error`
  - `stt_transcript: string | null`, `competitors_skipped: "target_below_pass" | null`
- `PronunciationService`에 `assess_with_competitors(...)`를 추가한다. 엔진(`IPronunciationAssessor`,
  `ISttEngine`)은 그대로 주입받는다. STT는 `candidates=[]`로 부른다. 앱의 `/stt` 폴백처럼 목표를
  후보로 넣으면 경쟁자가 목표 쪽으로 끌려간다.
- 병렬: `asyncio.gather(to_thread(...))`. 1차(목표 ‖ STT), 2차(경쟁자들)로 **왕복 두 번**이다.
- 속도 제한: `PRONUNCIATION_RATE_LIMIT_PER_MIN`(240)이 **Azure 호출 수로 세도록** 가중치를 준다
  (요청 1개 = 최대 6). 직접 노출 방어가 목적이라 호출 수가 맞는 단위다.
- 테스트(pytest, 가짜 엔진): 하위 호환, 목표 < 60이면 경쟁자 미호출, 전사가 비었거나 목표와 같으면
  전사 PA 미호출, 경쟁자 하나가 예외면 `status=error`로 싣고 **전체는 200**(판정은 프론트가 채점
  불가로), 입력 상한, 병렬 호출 수.

### PR 3 — 백엔드: 전달 · 기록

> **구현됨(2026-09-26).** 계획에서 달라지거나 더해진 것:
>
> - 마이그레이션은 **M33**(`1786500000000`)이다. 컬럼 둘 다 널 허용·기본값 없음이고 CHECK 제약은 두지 않았다
>   (값 목록은 DTO가 지킨다 — `foil_kind`와 같은 결정). 임시 DB에서 up → down → up 왕복을 확인했다.
> - 요약에 **`scorerChangedAt`**를 더했다(계획에는 `unscoredAmbiguous`·`scorerVersions`만 있었다). 보호자 카드가
>   "채점 방식이 바뀌었어요(날짜)"를 그리려면 전환 **날짜**가 필요하고, 버전 목록만으로는 날짜를 못 준다. 요약에는
>   기간이 없어서 세 값 모두 **검사별 전 기간** 기준이다. 전환 시각은 `MIN(answered_at)`(푼 시각)이다.
> - 값 목록 상수는 `quiz/constants/qab-scorer.ts`, 프록시 검증은 `ai-proxy/competitors.ts`다. 프록시의 상한(5개·30자)은
>   ai-service 소스를 읽어 대조하는 테스트가 지킨다(어긋나면 "받아주지만 반드시 거절되는" 죽은 구간이 생긴다).
> - 시간 축 가드 테스트(`answered_at` 사용 횟수)를 11 → 12로 올렸다. 새 사용은 전환 시각이고 푼 시각이어야 하는 자리다.
> - **알아둘 것 — 사용자별 한도는 요청 단위 그대로다.** 경쟁자 요청도 1건이라, 한 계정이 분당 12건을 보내면 최대
>   72 Azure 호출(예전 12)이 나간다. 기능 플래그가 꺼진 지금은 영향이 없고, PR 6에서 실사용을 보고 조정한다.
> - 프론트 타입(`QabSubtestSummary` 미러)은 PR 5에서 소비하는 자리와 함께 더한다.

- 프록시(`ai-proxy.controller.ts` `pronunciation`): `competitors`·`stt_competitor`를 검증해서 그대로 넘긴다
  (JSON 파싱, 개수·길이 상한). 녹음 보존(`speechData.saveRecording`)은 그대로 둔다.
- `qab_results` 마이그레이션:
  - `scorer_version varchar(24) NULL`. **NULL = 컬럼 이전 기록 = `azure-pa-v1`**이다(`manifest_version`·
    `locale`과 같은 관례). 과거 행은 채우지 않는다.
  - `unscored_reason varchar(16) NULL` — `ambiguous` | `no_score`. unscored가 아닌 행은 NULL.
- DTO(`submit-qab-results.dto.ts`)에 두 필드를 선택으로 추가한다. 값 목록을 검증한다.
- 집계는 **바꾸지 않는다.** 채점 불가는 이미 네 곳(정확도·발음 평균·레벨링 윈도우·재출제)에서 빠진다.
  요약(`quiz.service.ts`의 `QabSubtestSummary`)에 `unscoredAmbiguous`와 기간 안의 `scorerVersions`(중복 없는 목록)를 더한다.
  보호자 카드가 전환을 표시하는 데 쓴다.
- 테스트: 마이그레이션 up/down, DTO 검증, 요약 필드, 집계에서 `ambiguous` 행이 빠지는지(통합).

### PR 4 — 프론트 도메인: 판정

> **구현됨(2026-09-26).** 계획에서 달라지거나 더해진 것:
>
> - 판정은 `pronunciationScore.ts`가 아니라 **새 파일 `domain/neighborScoring.ts`**에 뒀다. 규칙이 한 곳에 있어야 한다는
>   원칙은 그대로이고(그 파일이 단일 진실), 이미 큰 채점 파일에 경쟁자 타입·변형 판정을 더 얹지 않으려는 분리다.
>   `evaluateFromAzure`·`UNSCORED`를 그대로 가져다 쓴다.
> - `evaluateNamingWithNeighbors`는 `NamingVerdict = { kind: 'assessed', assessment } | { kind: 'ambiguous' }`를 돌려준다.
>   인식 요청 여부 인자는 없다 — 이웃 비교는 항상 인식 결과를 경쟁자로 함께 요청하므로, 인식 호출 실패·응답 누락은
>   언제나 채점 불가다.
> - `SpeechCaptureService`는 이웃을 **생성자가 아니라 `start(referenceText, { neighbors })`로** 받는다. 목표가 이미 시작
>   때마다 정해지는 값이고 이웃은 그 목표에서 나오므로, 인스턴스에 이전 문항의 이웃이 남는 사고를 구조로 막는다(테스트로 고정).
> - 결과의 `competitors`는 **세 상태**다. `undefined` = 요청 안 함(이전 채점), `null` = 요청했는데 경쟁자 결과를 못 얻음
>   (옛 서버·인식 폴백), 객체 = 서버 결과. 요청한 시도는 실패해도 이웃 비교 채점기의 시도로 기록돼야 해서(`scorer_version`)
>   앞의 둘을 갈라야 한다. PR 5는 `competitors !== undefined`로 경로를 고른다.
> - 판정 골든 벡터(`scripts/asr_eval/golden/neighbor_decisions.json`)는 `speechScoreGolden`과 같은 방식이다 — **TS가 정본**,
>   입력은 테스트 코드에 두고 출력만 얼린다. Python 재현본은 호출 실패·건너뜀·응답 누락을 모델링하지 못해 그 5개 사례는
>   TS만 고정한다(`pythonModelled: false`).
> - **골든 벡터가 실측 코드의 불일치를 잡았다.** `azure_neighbor_eval.is_accepted_variant`가 공백만 정규화해서 앱(NFC·문장부호
>   제거)과 어긋나 있었다(예: "나 무!" ← 통나무). 실측 파이프라인은 전사를 미리 정규화해 결과가 같았고, 캐시로 다시 돌려
>   **0단계 수치가 그대로**(팔 A 20.9%·팔 C 3.5%/13.0%·팔 S 5.2%)임을 확인한 뒤 앱에 맞췄다.
> - `nameMatch.ts`의 `PARTIAL_MIN_RATIO`를 export했다(값 복사 없음). 플래그 `isNeighborScoringEnabled()`(`VITE_ENABLE_NEIGHBOR_SCORING`)와
>   `.env.example` 항목을 더했다. **아직 아무도 이 판정·옵션을 부르지 않는다** — PR 5에서 붙는다.
> - 채점 불가의 이유(`ambiguous` vs `no_score`)는 이 PR의 판정 결과에 싣지 않는다. 2차 모호를 채점 불가로 낼 때의 사유는
>   제출하는 쪽(PR 5)이 붙인다.

- `pronunciationScore.ts`:
  - `isAcceptedNamingVariant(said, target)` — 목표를 품는 말 · 부분 명칭(연속 부분, 길이 ≥ 60%).
    60%는 `nameMatch.ts`의 `PARTIAL_MIN_RATIO`를 **export해서 가져다** 쓴다(지금은 모듈 내부 상수다. 값을 복사하지 않는다).
  - `evaluateNamingWithNeighbors(azure, transcript, competitorScores, sttTranscript)` →
    `SpeechAssessment | { kind: 'ambiguous' }`.
    - 규칙: 설계 3-1절과 8·9절. m = 0, 동점은 정답. 경쟁자 `status=error`면 채점 불가(`no_score`).
      `no_match`는 0점. 전사가 정답으로 보는 변형이면 경쟁자에서 뺀다.
- **골든 테스트:** `scripts/asr_eval/golden/neighbor_decisions.json`에 입력과 기대 판정을 두고 Vitest와
  pytest(`azure_neighbor_eval.decide`·`is_accepted_variant`)가 **같은 파일**을 읽는다. 0단계 실측
  코드와 앱 판정이 어긋나면 양쪽 중 하나가 깨진다. 사례에는 0단계 오통과 사례(고래←노래,
  통나무←나무, 비행기←비)를 넣는다.
- `SpeechCaptureService`: 생성자 옵션 `neighbors?: string[]`. 있으면 `competitors`와 `stt_competitor`를
  폼에 싣는다. 응답에서 새 필드를 읽어 `SpeechCaptureResult`에 싣는다.
- `featureFlags.ts`: `isNeighborScoringEnabled()` ← `VITE_ENABLE_NEIGHBOR_SCORING`.

### PR 5-0 — 백엔드: 재시도 횟수 기록 (계획에 없던 것, PR 5를 읽다가 찾았다)

> **구현됨(2026-09-26).** PR 5를 준비하며 세션 훅을 읽다가 계획의 빈틈을 찾았다. 결과는 **최종 시도만** 저장된다.
> 1차에 모호했다가 재시도에서 풀린 경우는 어느 행에도 남지 않아, PR 6에서 볼 핵심 지표인 **1차 모호율**("한 번 더"를 얼마나
> 자주 듣는가 — 채택 기준 ≤ 15%와 직접 비교할 값)을 잴 수 없다. 재시도 후에도 못 가른 것(`unscored_reason = 'ambiguous'`)만
> 보이고, 그건 그 지표의 일부일 뿐이다. 이미 있는 범용 `events` 테이블은 프론트 전송 코드가 없어서 이것 하나에 쓰기엔 무겁다.
>
> - **M34** `qab_results.ambiguous_retries SMALLINT NULL`. **NULL = 이웃 비교를 거치지 않음, 0 = 거쳤고 안 시킴, 1 = 한 번 다시
>   시킴.** NULL과 0을 가르는 것이 요점이다(0으로 채우면 안 거친 행이 분모에 섞여 비율이 낮게 나온다).
> - 이름대기 밖의 검사에서 오면 서버가 지운다(`cue_level`과 같은 이유). DTO는 0~3 정수(쓰레기만 막고, 정책 상한은 프론트가 지킨다).
> - 요약에 `neighborAttempts`(NULL이 아닌 행 수, 분모)와 `neighborRetried`(≥ 1, 분자)를 더했다.
>   **1차 모호율 = `neighborRetried / neighborAttempts`**, 재시도 후에도 못 가른 몫은 `unscoredAmbiguous`다.
> - 실제 Postgres 통합 테스트로 NULL이 분모에서 빠지는 것(7이 아니라 5)을 확인했고, up → down → up 왕복을 확인했다.

### PR 5 — 프론트 흐름: 재시도 · 기록 · 보호자 표시

> **5a(환자 흐름·기록)를 구현했다(2026-09-26). 보호자 표시는 5b로 나눴다** — 화면 두 곳(환자·보호자)을 한 PR에 넣기엔
> 커서 환자 쪽을 먼저 머지한다. 5a에서 달라지거나 더해진 것:
>
> - **재시도 정책은 도메인에 있다**(`neighborScoring.ts`의 `resolveNamingAttempt`). 컴포넌트는 결과를 받아 그대로 따른다.
>   "한 번 더"를 청하는 경우는 **가르지 못한(모호) 경우뿐**이다. 경쟁자 결과를 못 얻은 경우(서버 실패·옛 서버·인식 폴백)는
>   다시 말해도 같은 일이 반복되므로 청하지 않고 채점 불가(`no_score`)로 마무리한다.
> - 컴포넌트가 훅에 **`onSubmit(text, azure, cueLevel, scoring?)`**로 넘긴다. **플래그가 꺼져 있으면 인자를 아예 넘기지 않고
>   `start`도 인자 하나로 부른다** — 기존 컴포넌트 테스트 13개가 수정 없이 그대로 통과하는 것이 그 증거다. 플래그가 켜졌는데
>   이웃 목록이 없는 낱말(영어·목록 누락)은 `{ scorerVersion: 'azure-pa-v1' }`만 넘겨 이전 채점 + 버전 표시를 남긴다.
> - 훅은 `scoring.assessment`가 있으면 다시 채점하지 않고 그대로 기록하고, `scorerVersion`·`ambiguousRetries`(이웃 비교를
>   거친 시도만 — 0과 생략을 가른다)·`unscoredReason`(채점 불가일 때만)을 행에 싣는다. 보호자가 정정하면 이유를 지운다.
> - 재시도는 도움이 아니다(설계 11절): `assisted`가 붙지 않고 단서 단계(`cueLevel`)와 받은 힌트가 그대로다(테스트로 고정).
> - 안내 문구(`naming.retryAmbiguous`, ko·en)는 잘잘못을 말하지 않는다. 표시 여부는 별도 상태가 아니라 `ambiguousRetries > 0 && 대기 중`에서
>   **파생**한다 — mutation을 돌리다 별도 상태가 중복임을 발견해 없앴다.
> - `neighborsFor`가 `'constructor'` 같은 상속 속성 이름에 배열이 아닌 `Object` 함수를 돌려주는 결함을 테스트가 잡아 고쳤다.
> - **브라우저 QA는 하지 않았다.** 이 흐름은 마이크 녹음과 실제 Azure 응답이 필요해 헤드리스 브라우저로는 재현할 수 없다.
>   대신 컴포넌트 테스트(RTL)로 화면 흐름(질문 → 인식 → 제출 → 모호 안내 → 재시도 → 제출)을 검증했다. 실제 화면과 마이크
>   흐름은 PR 6의 스테이징 관찰이 첫 확인이다.

- `PictureNamingItem`: 플래그가 켜져 있고 로케일이 `ko-KR`이면 manifest에서 이웃을 찾아 서비스에 준다
  (목록에 없는 단어면 이웃 없이 v1로 채점하고 `scorer_version = azure-pa-v1`로 찍는다).
- 모호 1차 → 문구 "한 번만 더 말씀해 주시겠어요?"를 보여 주고 **같은 문항에서** 다시 녹음한다.
  - 단서 단계 유지, `assisted` 안 붙임(결정 3).
  - 문구는 잘잘못도 원인도 말하지 않는다(`UNSCORED_ENCOURAGEMENT`와 같은 원칙). i18n 키는 ko만 추가하고,
    en은 이 경로를 타지 않는다.
- 모호 2차 → `UNSCORED`로 제출(`unscored_reason: 'ambiguous'`).
- `useMixedQuizSession.submitNaming`: 새 판정 결과를 받아 `scorer_version`·`unscored_reason`을 싣는다.
  **피로 탈출(연속 오답)과 세션 점수 분모에서 모호→채점 불가가 빠지는지** 테스트한다(지금 `isCorrect: null`
  경로를 그대로 탄다).
- 보호자 `QabProgressCard`·`WeeklyReportScreen`: 기간 안에 `scorerVersions`가 둘 이상이면 이름대기 추이에
  "채점 방식이 바뀌었어요(날짜) — 이전과 바로 비교하기 어려워요"를 표시한다. 버전을 넘어 기울기를
  잇지 않는다.
- 테스트: Vitest(재시도 흐름·단서 단계 보존·2차 모호 → 채점 불가·플래그 꺼짐이면 v1), 브라우저 QA
  (`/qa`로 이름대기 화면 흐름).

### PR 6 — 스테이징 켜기 · 관찰

- 스테이징에서만 `VITE_ENABLE_NEIGHBOR_SCORING=true`로 켠다. `observe-unassisted-pair-before-cutover`와
  같은 창에서 본다.
- 볼 지표와 기준(설계 0단계에서 옮김):

  | 지표 | 기대 | 넘으면 |
  |---|---|---|
  | 이름대기 모호율(1차) = `neighborRetried / neighborAttempts` | ≤ 15% | 재시도 부담이 크다 — m·경쟁자 수를 다시 본다 |
  | 모호 → 채점 불가(2차) | 1차의 절반 이하 | 재시도가 안 푼다 — 재시도의 의미를 다시 본다 |
  | 보호자 정정률(v2 행) | v1과 비교 | v2가 더 자주 정정되면 판정이 사람과 어긋난다 |
  | 문항당 지연 p95 | 3초 이하 | 병렬화·타임아웃을 조정한다 |
  | 세션당 Azure 호출 | 예측(단어 문항 × 최대 6)과 일치 | 호출 생략 로직을 점검한다 |

- 되돌리기: 플래그를 끄면 즉시 v1이다. 이미 기록된 v2 행은 `scorer_version`으로 갈라 볼 수 있어서
  데이터를 고칠 필요가 없다.

## 4. 이미 있어서 새로 만들지 않는 것

- **채점 불가 1급 상태**와 집계 제외 네 곳, "못 잰 N회" 표시, 보호자 정정 버튼(음향 채점 계획 5절).
- **동의받은 녹음 보존**(`speechData.saveRecording`) — 발음 평가 프록시가 이미 목표·전사·점수와 함께
  남긴다. TODOS 4번(앱 오디오 수집)과 PR 6 관찰에서 모호 사례를 다시 들어 볼 재료가 된다. 보존 동의와
  보관 기간 정책은 TODOS 4번에서 따로 확인한다.
- **버전 컬럼 관례**(`manifest_version`·`locale`: NULL = 컬럼 이전).

## 5. 위험

| 위험 | 대응 |
|---|---|
| 모호율이 실사용에서 15%를 크게 넘는다(608은 낭독, 실사용은 이름대기) | PR 6 지표. 넘으면 플래그를 끄고 m·경쟁자 수를 다시 실측 |
| 판정 정의가 프론트와 실측 코드에서 갈라진다 | PR 4 골든 파일을 양쪽 테스트가 공유 |
| 이름대기 풀에 낱말을 추가하고 manifest를 다시 안 만든다 | PR 1 소비자 테스트. 목록 없는 단어는 v1로 떨어지되 버전이 찍혀 드러난다 |
| 병렬 6호출로 Azure 동시 호출 한도에 걸린다 | PR 2 가중 속도 제한, PR 6 지연 지표 |
| 보호자가 전환 시점의 정답률 하락을 환자 악화로 읽는다 | PR 5 전환 표시. 설계 3-4절 |

## 6. 규모

| PR | 주 변경 | 크기 |
|---|---|---|
| 1 | 스크립트 + JSON 자산 + 소비자 테스트 | S |
| 2 | ai-service 라우터·서비스·모델 + pytest | M |
| 3 | 프록시·마이그레이션·DTO·요약 + 테스트 | M |
| 4 | 도메인 판정·골든·서비스 폼·플래그 | M |
| 5 | 이름대기 흐름·보호자 표시·QA | M |
| 6 | 스테이징 설정·관찰 | S(사람 몫이 크다) |
