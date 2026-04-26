# Whisper STT 서비스 — Part 2: LoRA 미세조정 전략

> 문서 작성일: 2026-04-08
> 현재 브랜치: LOC_feature_plan
> 관련 문서:
> - [Part 1: 핵심 구현 계획](20260408_Whisper_STT_01_core_implementation.md)
> - [Part 3: 위험 요소 및 검증](20260408_Whisper_STT_03_risks_and_verification.md)

---

## 1. LoRA 도입 배경 및 목적

Whisper base/small/medium 모델은 범용 음성 인식에 최적화되어 있으며, 뇌졸중 환자의 구음장애(dysarthria) 발화에 대해서는 인식률이 현저히 떨어진다. 구음장애 환자의 발화 특성은 다음과 같다:

- **불명확한 자음/모음 발음**: 조음 기관의 운동 장애로 인한 왜곡
- **비정상적인 운율(prosody)**: 발화 속도 불균일, 비정상적 강세 패턴
- **비음 과다(hypernasality)**: 연인두 기능 장애로 인한 비강 공명 증가
- **음량 저하**: 호흡 지지 부족으로 인한 약한 발성

이러한 특성에 대응하기 위해 Whisper 모델 전체를 재학습하는 것은 비용과 시간이 과다하다. **LoRA(Low-Rank Adaptation)**를 적용하면 모델의 핵심 가중치를 동결한 채 소규모 어댑터 파라미터만 학습하여, **적은 데이터와 연산 자원으로 구음장애 음성에 특화된 인식 성능**을 확보할 수 있다.

---

## 2. LoRA 아키텍처 개요

LoRA는 사전학습된 대규모 모델의 가중치 행렬 `W`에 저차원(low-rank) 행렬 분해를 삽입하는 기법이다.

```
기존:    h = W * x
LoRA:   h = W * x + (B * A) * x
         여기서 W는 동결(freeze), A와 B만 학습
```

- **W** (d x k): 원본 가중치 행렬 (동결)
- **A** (d x r): 다운 프로젝션 행렬 (학습 대상)
- **B** (r x k): 업 프로젝션 행렬 (학습 대상)
- **r**: LoRA 랭크 (차원 축소 크기, 기본값 8)

Whisper의 Transformer 블록 내 **어텐션 레이어의 Query(q_proj)와 Value(v_proj) 프로젝션**에 LoRA를 부착한다. 이 두 레이어가 입력 음성 특징에 대한 주의(attention) 패턴을 결정하므로, 구음장애 특유의 음향 특성을 학습하기에 가장 효과적이다.

**파라미터 효율성 예시 (Whisper small 기준):**
- 전체 파라미터: ~244M
- LoRA 학습 파라미터 (r=8, q_proj+v_proj): ~0.6M (전체의 약 0.25%)
- 어댑터 파일 크기: 약 2~5MB

---

## 3. 필수 라이브러리 및 의존성

```txt
# ai-service/requirements.txt에 추가
transformers>=4.36        # HuggingFace Whisper 모델 로딩 (WhisperForConditionalGeneration)
peft>=0.7                 # LoRA 어댑터 생성, 부착, 저장, 로딩
datasets>=2.16            # 학습 데이터셋 구성 및 전처리
accelerate>=0.25          # 혼합 정밀도(FP16) 학습 및 GPU 활용 최적화
soundfile                 # 오디오 파일 읽기/쓰기 (WAV, FLAC 등)
librosa>=0.10             # 오디오 리샘플링 (16kHz 변환), 특징 추출
evaluate                  # WER/CER 메트릭 계산 (학습 중 평가용)
jiwer                     # WER/CER 계산 라이브러리 (evaluate 백엔드)
```

> **참고**: LoRA 학습은 GPU 환경(CUDA)에서 수행하는 것을 강력히 권장한다. CPU 환경에서는 추론(inference)만 지원한다.

---

## 4. 학습 파이프라인 설계

### 4.1 모델 로드 및 가중치 동결

```python
# ai-service/scripts/train_whisper_lora.py (핵심 구조)
from transformers import WhisperForConditionalGeneration, WhisperProcessor

MODEL_ID = "openai/whisper-base"  # 추후 whisper-small, whisper-medium으로 교체 가능

# 모델 및 프로세서 로드
processor = WhisperProcessor.from_pretrained(MODEL_ID)
model = WhisperForConditionalGeneration.from_pretrained(MODEL_ID)

# 전체 가중치 동결
for param in model.parameters():
    param.requires_grad = False
```

### 4.2 LoRA 설정 및 어댑터 부착

```python
from peft import LoraConfig, get_peft_model, TaskType

lora_config = LoraConfig(
    r=8,                          # 랭크: 저차원 행렬 크기
    lora_alpha=32,                # 스케일링 팩터 (alpha/r 비율로 학습률 조정)
    target_modules=["q_proj", "v_proj"],  # 어텐션 레이어의 Query, Value에 적용
    lora_dropout=0.05,            # 드롭아웃 (과적합 방지)
    bias="none",                  # 바이어스는 학습하지 않음
    task_type=TaskType.SEQ_2_SEQ_LM,  # Whisper는 시퀀스-투-시퀀스 모델
)

# LoRA 어댑터 부착
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 출력 예시: "trainable params: 0.6M || all params: 74M || trainable%: 0.81%"
```

### 4.3 데이터셋 준비

```python
from datasets import Dataset, Audio
import librosa

def prepare_dataset(batch):
    """오디오를 16kHz로 리샘플링하고 Whisper 입력 형식으로 변환"""
    audio = batch["audio"]
    
    # Whisper는 16kHz 모노 오디오를 요구
    input_features = processor.feature_extractor(
        audio["array"],
        sampling_rate=audio["sampling_rate"],
        return_tensors="pt"
    ).input_features[0]
    
    # 타겟 텍스트를 토큰화
    labels = processor.tokenizer(
        batch["transcription"],
        return_tensors="pt"
    ).input_ids[0]
    
    batch["input_features"] = input_features
    batch["labels"] = labels
    return batch

# 데이터셋 구성 (커스텀 구음장애 데이터)
dataset = Dataset.from_dict({
    "audio": audio_file_paths,        # 오디오 파일 경로 리스트
    "transcription": transcriptions,   # 정답 텍스트 리스트
}).cast_column("audio", Audio(sampling_rate=16000))

# 전처리 적용
dataset = dataset.map(prepare_dataset, remove_columns=dataset.column_names)

# 학습/검증 분할 (80:20)
dataset = dataset.train_test_split(test_size=0.2, seed=42)
```

### 4.4 학습 실행

```python
from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments

training_args = Seq2SeqTrainingArguments(
    output_dir="./models/whisper_lora",
    per_device_train_batch_size=8,        # GPU VRAM에 따라 조정
    gradient_accumulation_steps=2,         # 실효 배치 크기 = 8 * 2 = 16
    learning_rate=1e-3,                    # LoRA는 상대적으로 높은 학습률 사용 가능
    warmup_steps=50,
    num_train_epochs=10,                   # 데이터 규모에 따라 조정
    evaluation_strategy="epoch",
    save_strategy="epoch",
    save_total_limit=3,                    # 최근 3개 체크포인트만 유지
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    fp16=True,                             # GPU 환경에서 혼합 정밀도 학습
    logging_steps=10,
    predict_with_generate=True,
    generation_max_length=225,
    report_to="none",                      # wandb 등 비활성화 (필요 시 활성화)
)

trainer = Seq2SeqTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    tokenizer=processor.feature_extractor,
)

# 학습 시작
trainer.train()
```

### 4.5 어댑터 저장 및 버전 관리

```python
# LoRA 어댑터만 저장 (전체 모델이 아닌 어댑터 가중치만)
model.save_pretrained("./models/whisper_lora/adapter_v1")
# 저장되는 파일: adapter_config.json, adapter_model.bin (약 2~5MB)

# 프로세서도 함께 저장 (추론 시 필요)
processor.save_pretrained("./models/whisper_lora/adapter_v1")
```

**버전 관리 전략:**
- 어댑터 디렉터리 네이밍: `adapter_v{N}_{날짜}_{데이터셋크기}` (예: `adapter_v1_20260410_500samples`)
- 각 버전에 학습 로그 및 평가 결과(CER/WER)를 `metadata.json`으로 함께 저장
- Git LFS 또는 별도 스토리지(S3 등)로 관리 (Git 리포지토리에는 포함하지 않음)
- `.gitignore`에 `ai-service/models/whisper_lora/` 및 `ai-service/data/` 등록

---

## 5. 추론(Inference) 시 LoRA 어댑터 적용 방식

### 5.1 LoRA 모델 로더

기존 `SttService`는 `openai-whisper` 라이브러리를 사용한다. LoRA 어댑터는 HuggingFace `transformers` + `peft` 기반이므로, **별도의 모델 로더 모듈**을 추가하여 두 방식을 공존시킨다.

```python
# ai-service/services/lora_model_loader.py
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from peft import PeftModel
import torch

class LoraModelLoader:
    """LoRA 어댑터가 적용된 Whisper 모델 로더"""
    
    def __init__(self, base_model_id: str, adapter_path: str):
        self._base_model_id = base_model_id
        self._adapter_path = adapter_path
        self._model = None
        self._processor = None
    
    def load(self):
        """모델 + LoRA 어댑터 로딩 (지연 로딩)"""
        if self._model is not None:
            return
        
        # 1. 기본 HF Whisper 모델 로드
        base_model = WhisperForConditionalGeneration.from_pretrained(
            self._base_model_id
        )
        # 2. LoRA 어댑터 부착
        self._model = PeftModel.from_pretrained(base_model, self._adapter_path)
        self._model.eval()  # 추론 모드
        
        # 3. 프로세서 로드
        self._processor = WhisperProcessor.from_pretrained(self._base_model_id)
    
    def transcribe(self, audio_array, sampling_rate: int = 16000, language: str = "ko") -> str:
        """LoRA 적용 모델로 음성을 텍스트로 변환"""
        self.load()
        
        input_features = self._processor.feature_extractor(
            audio_array,
            sampling_rate=sampling_rate,
            return_tensors="pt"
        ).input_features
        
        forced_decoder_ids = self._processor.get_decoder_prompt_ids(
            language=language, task="transcribe"
        )
        
        with torch.no_grad():
            predicted_ids = self._model.generate(
                input_features,
                forced_decoder_ids=forced_decoder_ids
            )
        
        transcription = self._processor.batch_decode(
            predicted_ids, skip_special_tokens=True
        )[0].strip()
        
        return transcription
```

### 5.2 SttService 수정 방안

```python
# ai-service/services/stt_service.py (수정된 구조)
import os

class SttService:
    def __init__(self, model_size: str = "base"):
        self._model_size = model_size
        self._whisper_model = None      # openai-whisper 기본 모델
        self._lora_loader = None        # LoRA 어댑터 적용 모델
        self._use_lora = bool(os.getenv("WHISPER_LORA_ADAPTER_PATH"))
    
    def _ensure_model_loaded(self):
        if self._use_lora:
            if self._lora_loader is None:
                from services.lora_model_loader import LoraModelLoader
                adapter_path = os.getenv("WHISPER_LORA_ADAPTER_PATH")
                base_model_id = f"openai/whisper-{self._model_size}"
                self._lora_loader = LoraModelLoader(base_model_id, adapter_path)
                self._lora_loader.load()
        else:
            if self._whisper_model is None:
                import whisper
                self._whisper_model = whisper.load_model(self._model_size)
    
    async def transcribe(self, audio_path: str, language: str = "ko") -> dict:
        self._ensure_model_loaded()
        
        if self._use_lora:
            # HF transformers + LoRA 경로
            import librosa
            audio_array, sr = librosa.load(audio_path, sr=16000)
            text = self._lora_loader.transcribe(audio_array, sr, language)
            duration = len(audio_array) / sr
            return {"text": text, "language": language, "duration": duration}
        else:
            # openai-whisper 기본 경로 (기존 로직)
            result = self._whisper_model.transcribe(
                audio_path, language=language, fp16=False
            )
            return {
                "text": result["text"].strip(),
                "language": result.get("language", language),
                "duration": result.get("duration", 0),
            }
```

### 5.3 환경변수 설정

```bash
# .env (ai-service)
# LoRA 어댑터 미적용 (기본 Whisper 사용):
# WHISPER_LORA_ADAPTER_PATH=

# LoRA 어댑터 적용:
WHISPER_LORA_ADAPTER_PATH=./models/whisper_lora/adapter_v1
WHISPER_MODEL_SIZE=base
```

- `WHISPER_LORA_ADAPTER_PATH`가 설정되어 있으면 LoRA 모델 사용, 비어있거나 미설정이면 기본 openai-whisper 사용
- 환경변수 전환만으로 LoRA 적용 여부를 제어할 수 있어 A/B 테스트 용이

---

## 6. ai-service 파일 구조 변경사항

```
ai-service/
├── config/
│   └── lora_config.py              [NEW] LoRA 하이퍼파라미터 설정 관리
├── data/
│   └── dysarthria/                 [NEW] 구음장애 학습 데이터 (Git 추적 제외)
│       ├── audio/                         오디오 파일 (.wav)
│       └── transcriptions.csv             정답 텍스트 매핑
├── models/
│   ├── stt.py                      [기존] Pydantic 모델
│   └── whisper_lora/               [NEW] 학습된 어댑터 저장소 (Git 추적 제외)
│       └── adapter_v1/
│           ├── adapter_config.json
│           └── adapter_model.bin
├── routers/
│   └── stt.py                      [기존] STT 엔드포인트
├── scripts/
│   ├── train_whisper_lora.py       [NEW] LoRA 학습 스크립트
│   └── prepare_dataset.py          [NEW] 데이터 전처리 스크립트
├── services/
│   ├── stt_service.py              [MODIFY] LoRA 분기 로직 추가
│   └── lora_model_loader.py        [NEW] LoRA 모델 로더
├── dependencies.py                  [기존]
├── main.py                          [기존]
└── requirements.txt                 [MODIFY] LoRA 관련 패키지 추가
```

---

## 7. 학습 데이터 전략

구음장애 음성 데이터는 범용 음성 데이터에 비해 수집이 어렵다. 다음 전략을 단계적으로 적용한다.

### 7.1 외부 공개 데이터셋 활용

| 데이터셋 | 언어 | 규모 | 특징 |
|----------|------|------|------|
| TORGO | 영어 | 약 23시간 | 뇌성마비/뇌졸중 구음장애 화자 8명 |
| UA-Speech | 영어 | 약 9시간 | 구음장애 심각도별 4단계 분류 |
| QoLT (한국) | 한국어 | 비공개 | 한국전자통신연구원(ETRI) 장애 음성 |

> **한계**: 영어 데이터셋이 대부분이며, 한국어 구음장애 데이터는 극히 제한적이다. 따라서 자체 데이터 수집이 필수적이다.

### 7.2 자체 데이터 수집 방안

1. **임상 현장 협업**: 언어치료사와 협력하여 치료 세션 중 환자 동의 하에 발화 녹음 수집
2. **앱 내 데이터 수집 (opt-in)**: 사용자 동의 시 STT 결과와 함께 원본 오디오를 익명화하여 저장
3. **최소 데이터 목표**: 초기 LoRA 학습에 약 100~500개 음성-텍스트 쌍 확보
4. **데이터 형식**: WAV 16kHz 모노, 1~10초 길이의 짧은 발화 단위

### 7.3 데이터 증강(Augmentation) 기법

학습 데이터가 부족한 경우 다음 증강 기법을 적용하여 데이터량을 2~5배 확대한다:

- **시간 스트레칭(Time Stretching)**: 발화 속도를 0.9~1.1배로 변환
- **피치 시프트(Pitch Shifting)**: 음높이를 -2~+2 반음 범위로 변환
- **배경 노이즈 추가**: 병원 환경 소음을 낮은 SNR(20~30dB)로 합성
- **볼륨 변동**: 음량을 0.8~1.2배로 랜덤 조정 (구음장애 환자의 음량 불균일 모사)

---

## 8. LoRA 하이퍼파라미터 가이드

### 주요 파라미터 설명 및 선택 기준

| 파라미터 | 기본값 | 범위 | 선택 기준 |
|----------|--------|------|-----------|
| `r` (랭크) | 8 | 4~64 | 데이터 적을 때 4~8, 많을 때 16~32. 높을수록 표현력 증가하나 과적합 위험 |
| `lora_alpha` | 32 | 8~64 | 일반적으로 `r`의 2~4배. alpha/r 비율이 실효 학습률 스케일링에 영향 |
| `target_modules` | `["q_proj", "v_proj"]` | — | Whisper 어텐션의 Q, V가 기본. K, O 추가 시 성능 소폭 향상 가능하나 파라미터 증가 |
| `lora_dropout` | 0.05 | 0.0~0.1 | 데이터 적을 때 0.05~0.1로 과적합 방지 |
| `learning_rate` | 1e-3 | 1e-4~3e-3 | LoRA는 전체 미세조정보다 높은 학습률 사용 가능 |
| `num_train_epochs` | 10 | 3~30 | 데이터 100개 미만이면 20~30, 500개 이상이면 5~10 |
| `per_device_train_batch_size` | 8 | 4~16 | GPU VRAM에 따라 조정 (base: 4GB 이상, small: 8GB 이상) |

### 권장 설정 시나리오

**시나리오 1: 소규모 데이터 (100개 미만)**
```python
LoraConfig(r=4, lora_alpha=16, lora_dropout=0.1)
# 학습: num_train_epochs=20, learning_rate=5e-4
```

**시나리오 2: 중규모 데이터 (100~500개)**
```python
LoraConfig(r=8, lora_alpha=32, lora_dropout=0.05)
# 학습: num_train_epochs=10, learning_rate=1e-3
```

**시나리오 3: 대규모 데이터 (500개 이상)**
```python
LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05)
# 학습: num_train_epochs=5, learning_rate=1e-3
```

### 성능 평가 지표

- **CER (Character Error Rate)**: 한국어는 음절 단위 오류율 측정에 적합. 목표: 구음장애 발화에서 CER 30% 이하
- **WER (Word Error Rate)**: 어절 단위 오류율. 참고 지표로 활용
- **비교 기준**: LoRA 적용 전후 동일 테스트셋에서의 CER 개선율 측정

---

## 9. 구현 순서 (Phase 6)

> Part 1의 Phase 1~5 완료 후 진행

- [ ] [보통] 6-1. LoRA 관련 Python 패키지 설치 (`transformers`, `peft`, `datasets`, `accelerate`, `soundfile`, `librosa`)
- [ ] [보통] 6-2. 구음장애 음성 데이터셋 수집 및 전처리 파이프라인 구축
- [ ] [어려움] 6-3. LoRA 학습 스크립트 작성 (`ai-service/scripts/train_whisper_lora.py`)
- [ ] [보통] 6-4. LoRA 어댑터 로딩 모듈 구현 (`ai-service/services/lora_model_loader.py`)
- [ ] [보통] 6-5. 기존 `SttService`에 LoRA 어댑터 적용 분기 로직 추가
- [ ] [보통] 6-6. 환경변수 기반 어댑터 경로 설정 (`WHISPER_LORA_ADAPTER_PATH`)
- [ ] [어려움] 6-7. base vs LoRA 모델 인식률 비교 평가 (구음장애 음성 기준)
- [ ] [쉬움] 6-8. LoRA 어댑터 버전 관리 전략 수립 (Git LFS 또는 별도 저장소)

---

## 10. Proposed Changes (파일 단위)

| 파일 | 상태 | 설명 |
|------|------|------|
| `ai-service/scripts/train_whisper_lora.py` | [NEW] | LoRA 미세조정 학습 스크립트 (데이터 로딩, 학습, 저장) |
| `ai-service/scripts/prepare_dataset.py` | [NEW] | 구음장애 음성 데이터 전처리 스크립트 |
| `ai-service/services/lora_model_loader.py` | [NEW] | LoRA 어댑터 로딩 및 HF Whisper 모델 관리 |
| `ai-service/services/stt_service.py` | [MODIFY] | LoRA 어댑터 적용 분기 로직 추가 |
| `ai-service/config/lora_config.py` | [NEW] | LoRA 하이퍼파라미터 및 학습 설정 관리 |
| `ai-service/requirements.txt` | [MODIFY] | transformers, peft, datasets, accelerate, soundfile, librosa 추가 |
| `ai-service/models/whisper_lora/` | [NEW] | 학습된 LoRA 어댑터 저장 디렉터리 (Git 추적 제외, .gitignore 등록) |
| `ai-service/data/dysarthria/` | [NEW] | 구음장애 음성 학습 데이터 디렉터리 (Git 추적 제외) |
