# Whisper STT 서비스 — Part 3: 위험 요소 및 검증 계획

> 문서 작성일: 2026-04-08
> 현재 브랜치: LOC_feature_plan
> 관련 문서:
> - [Part 1: 핵심 구현 계획](20260408_Whisper_STT_01_core_implementation.md)
> - [Part 2: LoRA 미세조정](20260408_Whisper_STT_02_lora_finetuning.md)

---

## 1. 위험 요소 및 완화 전략

### 1.1 핵심 STT 관련 위험

| 위험 | 영향 | 완화 |
|------|------|------|
| Whisper base 모델의 구음장애 발화 인식률 저하 | 채점 정확도 하락 | Phase 5에서 인식률 평가 후 small/medium 모델 업그레이드 |
| CPU 환경에서 Whisper 변환 지연 (base: 약 2~5초) | 사용자 대기 시간 | "변환 중..." 로딩 UI + 추후 GPU 이전 |
| ffmpeg 미설치로 인한 서버 실행 실패 | 개발 환경 셋업 장애 | README에 ffmpeg 설치 가이드 명시 |
| webm 포맷 호환성 (일부 브라우저 차이) | 특정 기기에서 녹음 실패 | MediaRecorder mimeType 협상 로직 추가 |
| ai-service 메모리 사용량 증가 (Whisper 모델 상주) | base 모델 약 1GB RAM | 모니터링 + medium 이상은 GPU 환경에서만 |

### 1.2 LoRA 관련 위험

| 위험 | 영향 | 완화 |
|------|------|------|
| LoRA 학습 데이터 부족 (구음장애 음성 데이터 희소) | 미세조정 효과 미미 | 데이터 증강(augmentation) 기법 적용 + 외부 데이터셋 탐색 (예: TORGO, UA-Speech) |
| LoRA 학습 시 CPU 환경의 한계 | 학습 시간 과다 (수 시간~수일) | GPU 환경에서만 학습 수행, 추론은 CPU에서도 가능 |
| LoRA 어댑터 과적합(overfitting) | 특정 화자에만 최적화되어 범용성 저하 | 다양한 화자 데이터 확보 + 검증 셋 분리 + early stopping 적용 |
| HF Whisper와 openai-whisper 호환성 | 두 라이브러리의 모델 포맷 차이로 혼동 발생 | LoRA는 HF transformers 기반으로 통일, 기본 STT는 openai-whisper 유지하되 전환 계획 수립 |
| LoRA 어댑터 파일 크기 관리 | 다수 버전 축적 시 디스크 사용량 증가 | 최신 N개 버전만 유지하는 정책 수립 + 성능 기준 미달 어댑터 자동 정리 |

---

## 2. Verification Plan

### 2.1 Automated Tests

```bash
# ai-service 테스트 (수동 — pytest 구조 추가 시)
cd ai-service
python -m pytest tests/test_stt_service.py -v

# 프론트엔드 훅 테스트
cd frontend
npx vitest run src/shared/hooks/useWhisperSTT.test.ts

# 프론트엔드 컴포넌트 테스트
npx vitest run src/shared/components/RecordButton.test.ts
```

### 2.2 Manual Verification

1. **ai-service 단독 테스트**
   - ai-service 서버 시작 (`uvicorn main:app --reload`)
   - curl로 오디오 파일 업로드:
     ```bash
     curl -X POST http://localhost:8000/stt/transcribe \
       -F "file=@test_audio.webm" \
       -F "language=ko"
     ```
   - 반환된 JSON에서 `text` 필드 확인

2. **프론트엔드 통합 테스트**
   - 브라우저에서 RecordButton 클릭 → 마이크 권한 허용
   - 한국어 발화 후 녹음 종료
   - 변환된 텍스트가 화면에 정상 표시되는지 확인
   - 네트워크 탭에서 `/stt/transcribe` 요청/응답 확인

3. **에러 시나리오 테스트**
   - ai-service 미실행 상태에서 녹음 → "서버 연결 실패" 메시지 확인
   - 매우 짧은 녹음 (0.3초) → 전송 차단 또는 빈 결과 처리 확인
   - 마이크 권한 거부 → 안내 메시지 확인

### 2.3 LoRA 모델 검증

1. **인식률 비교 테스트**
   - 동일 테스트셋(구음장애 발화 20~50개)으로 base vs LoRA 모델 CER 비교
   - 목표: LoRA 적용 후 CER 20% 이상 개선

2. **LoRA 어댑터 로딩 테스트**
   - `WHISPER_LORA_ADAPTER_PATH` 설정/미설정 시 각각 정상 동작 확인
   - 잘못된 어댑터 경로 → 적절한 에러 메시지 출력 확인

3. **A/B 테스트 절차**
   - 환경변수 전환으로 기본 모델 ↔ LoRA 모델 간 전환
   - 동일 입력에 대한 결과 비교 리포트 생성

---

## 3. 기술 스택 전체 의존성 요약

### ai-service (Python) — 전체 신규 패키지

| 패키지 | 버전 | 용도 | Phase |
|--------|------|------|-------|
| `openai-whisper` | latest | Whisper STT 모델 | Phase 1 |
| `python-multipart` | latest | FastAPI 파일 업로드 지원 | Phase 1 |
| `ffmpeg` (시스템) | 6.x+ | Whisper 오디오 전처리 의존성 | Phase 1 |
| `transformers` | >=4.36 | HuggingFace Whisper 모델 로딩 | Phase 6 |
| `peft` | >=0.7 | LoRA 어댑터 생성/관리 | Phase 6 |
| `datasets` | >=2.16 | 학습 데이터셋 로딩/전처리 | Phase 6 |
| `accelerate` | >=0.25 | 혼합 정밀도 학습/GPU 최적화 | Phase 6 |
| `soundfile` | latest | 오디오 파일 읽기/쓰기 | Phase 6 |
| `librosa` | >=0.10 | 오디오 리샘플링/특징 추출 | Phase 6 |
| `evaluate` | latest | WER/CER 메트릭 계산 | Phase 6 |
| `jiwer` | latest | WER/CER 계산 백엔드 | Phase 6 |
