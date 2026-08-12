# Colab T4로 whisper 파인튜닝 (608 공개데이터)

오늘 baseline에서 단어 CER 0.70이 나왔고, prompt-biasing으론 개선 안 됨을 실측했다.
남은 진짜 레버는 **음향 파인튜닝**이고, CPU는 너무 느려 무료 Colab T4 GPU를 쓴다.
608은 공개 연구 데이터라 클라우드 업로드 OK(환자 데이터는 절대 금지).

## 데이터 준비 (로컬, 이 리포)

whisper는 30초 이하 클립으로 학습하므로 긴 원본이 아니라 **문장 세그먼트**가 필요하다.

```bash
# 1) 긴 낭독 → 문장 세그먼트 (whisper word-timestamps, 무거움 → 화자 몇 명씩)
python scripts/align_608.py \
  --manifest ".../608-labels/manifest608_all.jsonl" \
  --audio-root ".../608-audio-work/wav" \
  --out-dir ".../608-audio-work/_segs" --model small

# 2) 세그먼트 → Colab 학습셋 패키지(화자 분리 train/test + wav 복사 + zip)
python scripts/asr_eval/prepare_colab_trainset.py \
  --segments ".../608-audio-work/_segs/segments.jsonl" \
  --seg-root ".../608-audio-work/_segs" \
  --out-dir  ".../608-audio-work/colab_trainset" \
  --test-speaker-frac 0.2 --min-sec 1 --max-sec 30 --zip
```

산출물 `colab_trainset/`:
```
train.jsonl   {"audio":"wav/<화자>/<파일>.wav","text":"정답 전사"}
test.jsonl
wav/<화자>/*.wav   (16kHz mono, 짧은 클립)
```
이 폴더(또는 `colab_trainset.zip`)를 **Google Drive**에 업로드. 전사 포함이라 리포엔 커밋 금지.

> **데이터 양**: 화자 수십 명·수 시간분이면 학습이 의미 있다. 2화자 36세그먼트짜리
> 소형 패키지는 **노트북이 T4에서 도는지 검증(스모크)** 용이지 실제 학습용은 아니다.

## Colab 노트북 (셀 순서대로)

**셀 1 — GPU 확인**
```python
!nvidia-smi
```

**셀 2 — 설치 (torchao 제거 + numpy 정리) → 실행 후 [런타임 → 세션 다시 시작] 필수**
```python
!pip install -q -U transformers datasets peft accelerate evaluate jiwer librosa
!pip uninstall -y torchao   # peft 버전검사와 충돌, LoRA엔 불필요
!pip install -q --force-reinstall --no-cache-dir "numpy==2.0.2"  # Colab 기준 버전 고정(_center 에러 방지)
print("설치 완료 → 런타임 재시작 후 셀 3부터")
```

**셀 3 — 임포트 + 드라이브 마운트**
```python
import torch, os
from google.colab import drive
drive.mount('/content/drive')
BASE = "/content/drive/MyDrive/608-trainset"   # 업로드한 폴더 경로로 수정
print("CUDA", torch.cuda.is_available())
```

**셀 4 — 모델 + LoRA**
```python
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from peft import LoraConfig, get_peft_model
processor = WhisperProcessor.from_pretrained("openai/whisper-small", language="ko", task="transcribe")
model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-small")
model.config.forced_decoder_ids = None; model.config.suppress_tokens = []
model.config.use_cache = False
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32,
        target_modules=["q_proj","v_proj"], lora_dropout=0.05))
model.print_trainable_parameters()
```

**셀 5 — 데이터셋**
```python
from datasets import load_dataset, Audio
ds = load_dataset("json", data_files={"train":f"{BASE}/train.jsonl","test":f"{BASE}/test.jsonl"})
ds = ds.map(lambda b: {"audio": os.path.join(BASE, b["audio"])})
ds = ds.cast_column("audio", Audio(sampling_rate=16000))
def prep(b):
    a=b["audio"]
    b["input_features"]=processor.feature_extractor(a["array"],sampling_rate=16000).input_features[0]
    b["labels"]=processor.tokenizer(b["text"]).input_ids
    return b
ds = ds.map(prep, remove_columns=ds["train"].column_names)
```

**셀 6 — 데이터 콜레이터 (whisper 필수)**
```python
from dataclasses import dataclass
from typing import Any
@dataclass
class Collator:
    processor: Any
    def __call__(self, feats):
        batch = self.processor.feature_extractor.pad(
            [{"input_features": f["input_features"]} for f in feats], return_tensors="pt")
        labels = self.processor.tokenizer.pad(
            [{"input_ids": f["labels"]} for f in feats], return_tensors="pt")
        lab = labels["input_ids"].masked_fill(labels.attention_mask.ne(1), -100)
        if (lab[:,0]==self.processor.tokenizer.bos_token_id).all(): lab = lab[:,1:]
        batch["labels"]=lab; return batch
collator = Collator(processor)
```

**셀 7 — CER 지표 (baseline 0.70 비교용)**
```python
import evaluate
cer_metric = evaluate.load("cer")
def compute_metrics(p):
    lab = p.label_ids; lab[lab==-100]=processor.tokenizer.pad_token_id
    return {"cer": cer_metric.compute(
        predictions=processor.tokenizer.batch_decode(p.predictions, skip_special_tokens=True),
        references =processor.tokenizer.batch_decode(lab, skip_special_tokens=True))}
```

**셀 8 — 학습 (체크포인트는 드라이브)**
```python
from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments
args = Seq2SeqTrainingArguments(
    output_dir=f"{BASE}/whisper-608-lora",
    per_device_train_batch_size=8, learning_rate=1e-3, warmup_steps=50,
    num_train_epochs=5, fp16=True,
    eval_strategy="steps", eval_steps=200, save_steps=200, logging_steps=25,
    predict_with_generate=True, generation_max_length=225,
    remove_unused_columns=False, label_names=["labels"], report_to="none")
trainer = Seq2SeqTrainer(model=model, args=args,
    train_dataset=ds["train"], eval_dataset=ds["test"],
    data_collator=collator, compute_metrics=compute_metrics, processing_class=processor)
trainer.train()   # 끊겼다 재개: trainer.train(resume_from_checkpoint=True)
```

**셀 9 — 저장 + baseline 대비**
```python
model.save_pretrained(f"{BASE}/whisper-608-lora-final")
m = trainer.evaluate()
print(f"파인튜닝 후 test CER {m['eval_cer']:.3f} (baseline 0.70과 비교)")
```

## 무료 티어 주의
- 세션 최대 ~12h, 유휴 끊김 → `output_dir`을 드라이브로(재개 가능)
- "GPU 없음" 뜨면 잠시 후 재시도
- 데이터 크면 subset부터(수 시간분)

## 흔한 에러
- `torchao ... only versions above 0.16.0` → 셀 2에서 `!pip uninstall -y torchao` + 재시작
- `cannot import name '_center' from numpy._core.umath` → pip -U가 numpy를 섞어 깨뜨림.
  `!pip install -q --force-reinstall --no-cache-dir "numpy==2.0.2"` + **재시작 필수**(셀 2에 포함). 최신 numpy로 재설치하면 또 어긋나니 버전을 고정한다.
- 라벨 못 찾음 / 학습 안 돎 → 셀 8의 `remove_unused_columns=False`, `label_names=["labels"]` 확인
- `tokenizer=` deprecated 경고 → 최신 transformers는 `processing_class=processor`
