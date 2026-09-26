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

- `scripts/build_neighbor_manifest.py`: `scripts/asr_eval/neighbor_manifest.py`(0단계와 **같은 함수**)로
  이름대기 대상 단어(`pickNamingItems`가 낼 수 있는 전 단어: 낱말 풀 중 사진 있는 것 + 이름대기 전용)
  마다 이웃 3개를 만든다.
- 산출: `frontend/src/assets/data/neighborManifest.ko-KR.json` (`{version, k, neighbors: {단어: [..]}}`).
- 테스트
  - Python: 결정성, 자신·포함관계 제외(기존 `test_neighbor_scoring.py` 재사용).
  - **Vitest 소비자 테스트:** 이름대기에 나올 수 있는 모든 `targetWord`에 목록이 있다. 낱말을 추가하고
    목록을 다시 안 만들면 여기서 깨진다(`WORD_CATEGORY`↔`namingCue` 회귀의 교훈).

### PR 2 — ai-service `competitors` · `stt_competitor`

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

### PR 5 — 프론트 흐름: 재시도 · 기록 · 보호자 표시

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
  | 이름대기 모호율(1차) | ≤ 15% | 재시도 부담이 크다 — m·경쟁자 수를 다시 본다 |
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
