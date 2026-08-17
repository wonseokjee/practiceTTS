# asr_eval — 자체 ASR 측정·개인화 평가 하네스 (Stage 0/1)

자체 ASR 모델을 만들기 전, **"지금 얼마나 틀리는가"(베이스라인)** 와
**"화자 발화를 조금 주면 얼마나 나아지는가"(개인화 커브)** 를 정직하게 재기 위한
평가 도구. AI Hub 608 '구음장애 음성인식 데이터' 매니페스트를 입력으로 쓴다.

## 왜 화자 분리가 먼저인가

ASR 평가의 1번 실수는 **같은 화자가 train과 test에 함께 들어가는 것**이다.
모델이 발음이 아니라 그 사람 목소리를 외워 오류율이 실제보다 좋게 나온다.
병리 발화는 화자 편차가 커서 이 왜곡이 특히 크다.

> **실측 감사 결과:** AI Hub 608 기본 Train/Validation split은 **화자 8명을 양쪽에
> 누수**시킨다(`AJH, KJO, KJS, KSH, KSW, KYG, LGS, LMS`). 그대로 쓰면 그 8명에서
> 점수가 부풀려진다. → 이 하네스는 **화자 단위**로 다시 나눈다.

## 실측 결과 (whisper-small, Training TS01 오디오) — 2026-08

첫 실제 baseline. 표본은 작지만(파이프라인 검증 + 규모 확인용) 방향은 뚜렷하다.
집계 수치만 기록한다(환자 전사는 리포에 남기지 않는다).

| 표본 | 전체 CER | 과제유형별 |
|---|---|---|
| n=5 (짧은 것) | 0.285 | — |
| n=10 (과제유형 균형, 36분) | 0.383 | **narrative 0.125 · wordlist 0.70** |

**결정적 발견 — 과제 유형이 CER을 지배한다: 단어나열 0.70 vs 서술문 0.125(5.6배).**
이 앱의 재활 과제는 대부분 단어 수준(그림 이름대기·단어 따라말하기)이라, 앱의 실제
사용 조건이 범용 ASR에 가장 불리하다. 즉 **자체 ASR·개인화의 1순위 타깃은 단어
수준 구음장애 인식**이다. 서술문은 문맥 덕에 whisper가 이미 쓸 만하다.

부수 관찰:
- whisper는 짧은/병리 발화에서 같은 구절을 반복 환각한다 → `condition_on_previous_text=False`로 억제.
- 중증 사례(예: 질환 15 단어나열)는 음소가 무너져 CER 0.8+ — 개인화가 가장 필요한 지점.
- 608은 긴 낭독뿐이라 발화 단위 개인화엔 `align_608` 세그먼트화가 선행돼야 한다.

### 개인화 커브 실측 (prompt-biasing) — 음성 결과

서술문 2화자를 `align_608`로 문장 세그먼트화(KYG 20 + JCJ 16) 후 prompt-biasing
어댑터로 적응 커브를 실측(0/0.5/1분):

| 화자 | 0분 | 0.5분 | 1.0분 |
|---|---|---|---|
| KYG | 0.122 | 0.093 | 0.092 |
| JCJ | 0.333 | 0.373 | **1.013** |
| 평균 | 0.228 | 0.233 | 0.552 |

**적응을 늘릴수록 CER이 나빠진다.** KYG는 소폭 개선됐지만 JCJ는 1분에서 폭발.
원인: whisper `initial_prompt`가 길어지면 모델이 프롬프트를 되뇌는(echo) 취약성 —
짧은 클립에 긴 프롬프트를 넣으면 인식 대신 프롬프트를 토해낸다.

**결론: prompt-biasing은 구음장애 개인화 레버로 부적합**(학습 없는 값싼 레버는
불충분·유해). 진짜 개인화는 음향 fine-tuning(`adapters.FinetuneAdapter`, 미구현)이
필요하다. 이 커브는 그 결론을 실측으로 고정한다.

### 파인튜닝 실측 → **[608 파인튜닝 대장](../../docs/asr/608-finetune-log.md)**

파인튜닝 배치별 CER·데이터 규모·정렬 이력은 전부 대장에 있다. 여기 적지 않는다 —
두 곳에 적으면 갈라지고, 실제로 갈라졌었다(README에는 40분짜리 첫 실험 결론만
남아 "파인튜닝은 암기만 한다"로 끝나 있었는데, 그 사이 6차까지 훨씬 큰 데이터로
돌아 있었다).

대장을 읽을 때 **맨 앞의 경고 절을 먼저 봐라.** 1~6차 CER은 dev 스플릿 없이
test로 체크포인트를 골라 낸 값이라 홀드아웃 성능이 아니다. 7차부터 기준이 바뀐다.

이 README가 맡는 건 **어떻게 돌리는가**(아래 구성표·실행법)다.

## 데이터 예산 (매니페스트 기준, 오디오 라벨)

- 발화(파일) **1,632** · 고유 화자 **188**
- 화자당 발화: 최소 1 / 중앙 **7** / 최대 35
- 질환별 화자 수: 중풍11=24, 뇌부상12=25, 뇌성마비13=12, 기타/복합15=68, 언어25=28, 청각26=31
- 화자 분리 스플릿(seed 42, test 0.15 / dev 0.10): **train 140 / dev 19 / test 29명**

## 구성

| 파일 | 역할 | 오디오 필요 |
|---|---|---|
| `metrics.py` | CER/WER (마이크로평균, 한국어 기본 CER) | ✕ 순수함수 |
| `split_speakers.py` | 화자 분리 스플릿 + 누수 감사 + 예산 분석 | ✕ 매니페스트만 |
| `baseline_asr.py` | 스플릿을 whisper로 인식 → CER/WER | ○ (`--smoke`는 ✕) |
| `personalization_curve.py` | 적응 분량↑ → 홀드아웃 CER 커브 | ○ (`--adapter sim`은 ✕) |
| `adapters.py` | 교체 가능한 개인화 적응기(프롬프트 바이어싱/LoRA/가상) | 구현별 |
| `refine_segments.py` | 정렬 세그먼트를 오디오 에너지로 재정렬(단어/문장) | ○ 부모 wav |
| `app_scorer.py` | **앱과 같은 잣대**로 채점(음소 가중 거리 + 통과율) | ✕ 순수함수 |
| `build_training_set.py` | 보존 발화(app) → 라벨 품질 필터 → 화자 분리 학습셋 | 오디오 존재확인만 |
| `prepare_colab_trainset.py` | align_608 세그먼트 → Colab 파인튜닝 패키지(zip) | 세그먼트 wav |
| `COLAB_FINETUNE.md` | 무료 Colab T4로 whisper LoRA 파인튜닝 가이드(셀 전체) | — |
| `test_asr_eval.py` | 지표·스플릿·커브·어댑터·학습셋·Colab 불변식 (개수는 세지 말 것 — 늘어난다) | ✕ |

### 학습셋 빌더(`build_training_set.py`)

동의로 모인 앱 발화(`speech_recordings`)를 자체 ASR 학습셋으로 만든다. 핵심은
**라벨 오염 제거**(target_text는 '목표'라, 환자가 다르게 발화하면 오디오≠라벨):
- pronunciation: `score ≥ --min-score`(기본 70)면 clean.
- stt/naming/repeat/reading: `CER(recognized_text, target) ≤ --max-label-cer`(기본 0.2)면 clean.
- 그 외는 `weak.jsonl`로(버리지 않고 사람 검수/후처리). clean만 화자 분리 train/dev/test.

입력은 `speech_recordings`의 JSONL export(DB 결합 없이 오프라인). 출력 전사는 PII라
`_trainset/`은 커밋 금지(.gitignore).

### 개인화 적응기(`adapters.py`)

`adapt_and_eval(adapt, holdout, minutes) -> CER` 하나만 구현하면 커브에 꽂힌다.
adapt/holdout은 절대 겹치지 않는다(누수 방지, curve가 보장).

- **PromptBiasingAdapter** — **학습 불필요.** whisper `initial_prompt`에 그 화자의
  적응 전사를 넣어 디코딩을 화자 어휘 쪽으로 편향. GPU·파인튜닝 없이 오늘 되는
  1차 개인화. `--adapter prompt --audio-root <오디오>` 로 실행(오디오 필요).
- **FinetuneAdapter** — LoRA/파인튜닝 스캐폴드(학습 백엔드 필요, 명시적 미구현).
- **SimAdapter**(`simulated_adapter`) — 오디오 없이 커브 형태만(`--adapter sim`, 기본).

## 실행

```bash
# 1) 스플릿 + 예산/누수 리포트 (오디오 불필요)
python scripts/asr_eval/split_speakers.py \
  --manifest ".../608-labels/manifest608_all.jsonl" \
  --out-dir  ".../608-labels/_splits" --seed 42

# 2) 파이프라인 스모크 (오디오 불필요)
python scripts/asr_eval/baseline_asr.py --split ".../_splits/test.jsonl" --smoke
python scripts/asr_eval/personalization_curve.py --test-split ".../_splits/test.jsonl" --adapter sim

# 2b) 실제 개인화(학습 불필요, 오디오 필요): whisper initial_prompt 바이어싱
python scripts/asr_eval/personalization_curve.py \
  --test-split ".../_splits/test.jsonl" --adapter prompt \
  --audio-root ".../608-audio" --model small --minutes 0,1,3,5,10

# 3) 테스트 — 두 방법 중 하나
```

**(a) 전용 venv (권장, 이 폴더만 있어도 된다)**

```bash
python -m venv scripts/asr_eval/.venv
scripts/asr_eval/.venv/Scripts/python.exe -m pip install -r scripts/asr_eval/requirements-dev.txt   # Windows
# source scripts/asr_eval/.venv/bin/activate && pip install -r scripts/asr_eval/requirements-dev.txt  # macOS/Linux

scripts/asr_eval/.venv/Scripts/python.exe -m pytest scripts/asr_eval/ -q
```

**(b) 이미 있는 ai-service venv 재사용 (설치 없이 바로)**

```bash
ai-service/venv/Scripts/python.exe -m pytest scripts/asr_eval/ -q     # Windows
# ai-service/venv/bin/python -m pytest scripts/asr_eval/ -q           # macOS/Linux
```

맨 파이썬(`python -m pytest`)은 pytest가 전역에 없으면 실패한다. 둘 중 하나를 써라.
테스트는 오디오도 whisper도 필요 없다 — 실제 인식은 전부 지연 임포트라 테스트
경로에 걸리지 않는다.

## 실측(진짜 숫자)에 필요한 것

현재 라벨(전사)·매니페스트만 있고 **오디오 원천데이터는 없다**(`_segments` 비어 있음).
실제 CER/개인화 곡선을 내려면:

1. **608 원천데이터(오디오, VS01/TS01 등) 다운로드 → 압축해제** → `--audio-root` 지정
2. (권장) `scripts/align_608.py`로 긴 낭독 wav을 문장 세그먼트로 정렬
3. `baseline_asr.py`에서 `--smoke` 제거 → whisper 실측 CER
4. 개인화 커브:
   - **바로 가능**: `--adapter prompt --audio-root <오디오>` (학습 불필요, initial_prompt 바이어싱)
   - **더 강한 개인화**: `adapters.FinetuneAdapter`에 LoRA/파인튜닝 학습 루프 구현

`--smoke`/`--adapter sim`은 오디오·적응기 없이 **집계·스플릿·리포트 경로가 도는지**만
검증한다(숫자는 가상).

## 프라이버시

매니페스트·스플릿(`_splits/*.jsonl`)에는 **환자 발화 전사(민감정보)** 가 들어간다.
리포 밖(다운로드 폴더 등)에 두고 **절대 커밋하지 않는다**. 이 폴더의 스크립트에는
전사가 포함되지 않는다.
