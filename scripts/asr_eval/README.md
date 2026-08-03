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
| `test_asr_eval.py` | 지표·스플릿·커브·어댑터 불변식 23개 | ✕ |

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

# 3) 테스트
python -m pytest scripts/asr_eval/test_asr_eval.py
```

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
