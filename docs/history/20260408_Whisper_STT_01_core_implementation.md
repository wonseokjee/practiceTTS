# Whisper STT 서비스 — Part 1: 핵심 구현 계획

> 문서 작성일: 2026-04-08
> 현재 브랜치: LOC_feature_plan
> 관련 문서:
> - [Part 2: LoRA 미세조정](20260408_Whisper_STT_02_lora_finetuning.md)
> - [Part 3: 위험 요소 및 검증](20260408_Whisper_STT_03_risks_and_verification.md)

---

## 1. 개요 및 목표

### 배경
현재 프론트엔드에서는 브라우저 내장 Web Speech API(`useSpeechRecognition.ts`)를 사용하여 STT를 수행하고 있다. 이 방식은 브라우저 의존성이 높고, 뇌졸중 환자의 구음장애(dysarthria) 발화에 대한 인식 정확도가 낮으며, 브라우저/기기별 동작 차이가 크다는 한계가 있다.

### 목표
OpenAI Whisper 모델을 ai-service(FastAPI)에 통합하여 **서버 측 STT 엔드포인트**를 제공한다. 프론트엔드의 녹음 기능을 공통 컴포넌트로 정비하고, 녹음된 오디오를 서버로 전송하여 Whisper가 변환한 텍스트를 받아 활용하는 구조를 구축한다.

### 핵심 가치
- **일관성**: 브라우저/기기 무관하게 동일한 STT 품질 보장
- **확장성**: 모델 크기(base → small → medium) 교체만으로 정확도 향상 가능
- **범용성**: 여러 평가/훈련 화면에서 공통으로 사용 가능한 구조

---

## 2. 확정된 요구사항 요약

| 항목 | 결정 |
|------|------|
| STT 엔진 | OpenAI Whisper (로컬 실행) |
| 실행 환경 | CPU (개발), 추후 GPU 서버 이전 예정 |
| 모델 크기 | `base` (개발 단계, 빠른 응답) |
| 변환 방식 | 녹음 완료 후 일괄 변환 (batch) |
| 사용 화면 | 여러 화면에서 범용 사용 (공통 컴포넌트) |
| 결과 활용 | (1) 텍스트 표시, (2) 정답 비교 채점, (3) AI 대화 입력 |
| 언어 | 한국어 (ko) |

---

## 3. User Review Required

> [!IMPORTANT]
> 1. **통신 경로 결정**: 프론트엔드에서 ai-service로 오디오를 전송할 때 NestJS 백엔드를 프록시로 거칠지, ai-service에 직접 요청할지 확정이 필요하다. 본 Plan에서는 **프론트엔드 → ai-service 직접 통신**을 기본안으로 제안한다. 이유: 대용량 바이너리(오디오) 파일을 NestJS가 중계하면 불필요한 메모리 소비 및 지연이 발생한다. ai-service의 CORS에 프론트엔드 origin이 이미 등록되어 있으므로 직접 통신이 가능하다.
> 2. **기존 Web Speech API 훅 처리**: `useSpeechRecognition.ts`를 Whisper 기반으로 교체할지, 두 방식을 모두 유지(fallback)할지 결정이 필요하다. 본 Plan에서는 기존 훅을 **유지하되 신규 `useWhisperSTT` 훅을 별도 생성**하고, 각 화면에서 선택적으로 사용하는 방식을 제안한다.
> 3. **파일 크기 제한**: Whisper에 업로드할 오디오 파일의 최대 크기/최대 녹음 시간을 확정해야 한다. 본 Plan에서는 **최대 60초, 최대 10MB**를 기본 제한으로 제안한다.
> 4. **ffmpeg 설치 방식**: Whisper는 ffmpeg에 의존한다. 개발 환경(Windows)과 배포 환경(Linux 서버)에서의 설치 방법이 다르므로, 배포 시 Docker 이미지에 ffmpeg를 포함할 것인지 확인이 필요하다.

---

## 4. 아키텍처 설계

### 4.1 서비스 간 통신 흐름

```
┌─────────────┐     POST /stt/transcribe     ┌───────────────┐
│  Frontend    │  ────── multipart/form ────▶ │  ai-service   │
│  (React)     │                              │  (FastAPI)    │
│              │  ◀──── JSON response ─────── │               │
│  useWhisper  │     { text, confidence,      │  Whisper      │
│  STT hook    │       language, duration }   │  base model   │
└─────────────┘                               └───────────────┘
      │                                              │
      │ 결과 활용                                     │ 모델 로딩
      ▼                                              ▼
 ┌──────────┐                                 ┌──────────────┐
 │ Mode 1:  │  텍스트 표시                      │ whisper.load │
 │ Mode 2:  │  정답 비교 (CER)                  │ _model()     │
 │ Mode 3:  │  AI 대화 (→ /chat)               │ 싱글턴 유지   │
 └──────────┘                                 └──────────────┘
```

### 4.2 데이터 흐름 상세

1. 사용자가 녹음 버튼을 누르면 `useAudioRecorder`로 MediaRecorder 시작
2. 녹음 종료 시 `audio/webm` Blob 생성
3. Blob을 `FormData`에 담아 `POST /stt/transcribe`로 전송
4. ai-service가 Whisper로 변환하여 JSON 응답 반환
5. 프론트엔드에서 결과를 활용 모드에 따라 처리

---

## 5. ai-service STT 모듈 설계

### 5.1 파일 구조

```
ai-service/
├── models/
│   └── stt.py              [NEW] 요청/응답 Pydantic 모델
├── routers/
│   └── stt.py              [NEW] STT 라우터 (엔드포인트)
├── services/
│   └── stt_service.py      [NEW] Whisper 모델 로딩 및 변환 로직
├── dependencies.py          [MODIFY] STT 서비스 DI 추가
├── main.py                  [MODIFY] STT 라우터 등록
└── requirements.txt         [MODIFY] openai-whisper, python-multipart 추가
```

### 5.2 엔드포인트 명세

#### `POST /stt/transcribe`

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `file` (UploadFile, required): 오디오 파일 (webm, wav, mp3, m4a, ogg)
  - `language` (str, optional): 언어 코드, 기본값 `"ko"`
  - `model_size` (str, optional): 모델 크기, 기본값 `"base"` (향후 교체용)

**Response (200 OK):**
```json
{
  "text": "변환된 텍스트",
  "language": "ko",
  "duration": 3.5,
  "model_size": "base"
}
```

**Error Responses:**
- `400 Bad Request`: 지원하지 않는 파일 형식, 파일 크기 초과
- `422 Unprocessable Entity`: 파일 누락
- `500 Internal Server Error`: Whisper 모델 오류
- `503 Service Unavailable`: 모델 로딩 중 (서버 시작 직후)

### 5.3 모델 관리 전략

```python
# services/stt_service.py (핵심 구조)
class SttService:
    def __init__(self, model_size: str = "base"):
        self._model_size = model_size
        self._model = None  # 지연 로딩 (lazy loading)

    def _ensure_model_loaded(self):
        """첫 요청 시 모델 로딩. 이후 싱글턴 재사용."""
        if self._model is None:
            import whisper
            self._model = whisper.load_model(self._model_size)

    async def transcribe(self, audio_path: str, language: str = "ko") -> dict:
        self._ensure_model_loaded()
        result = self._model.transcribe(
            audio_path,
            language=language,
            fp16=False,  # CPU 환경 (GPU 이전 시 True로 변경)
        )
        return {
            "text": result["text"].strip(),
            "language": result.get("language", language),
            "duration": result.get("duration", 0),
        }
```

**모델 교체**: `model_size` 파라미터 변경 또는 환경변수(`WHISPER_MODEL_SIZE`)로 제어. 서비스 재시작 시 새 모델 로딩.

### 5.4 임시 파일 처리

- 업로드된 오디오는 Python `tempfile`로 임시 저장
- Whisper 변환 완료 후 즉시 삭제 (`finally` 블록)
- 디스크 누수 방지를 위한 방어적 cleanup

### 5.5 한국어 인식 최적화

- `language="ko"` 명시적 지정으로 자동 언어 감지 오버헤드 제거
- Whisper는 한국어에 대해 base 모델로도 일상 대화 수준의 인식률 확보
- 구음장애 환자 발화는 추후 `small` 또는 `medium` 모델로 업그레이드하여 개선
- `fp16=False` (CPU 모드) → GPU 이전 시 `fp16=True`로 전환하여 속도 2배 향상

---

## 6. 프론트엔드 설계

### 6.1 파일 구조

```
frontend/src/shared/
├── hooks/
│   ├── useAudioRecorder.ts      [기존] 변경 없음 — Blob 반환 기능 이미 구현됨
│   ├── useWhisperSTT.ts         [NEW] Whisper API 호출 + 상태 관리 훅
│   ├── useSpeechRecognition.ts  [기존] 유지 (브라우저 STT fallback)
│   └── useVAD.ts                [기존] 유지
├── components/
│   ├── RecordButton.tsx         [NEW] 공통 녹음 버튼 UI 컴포넌트
│   └── RecordButton.test.tsx    [NEW] 컴포넌트 테스트
└── infrastructure/
    └── SttApi.ts                [NEW] ai-service STT 엔드포인트 호출 클래스
```

### 6.2 `useWhisperSTT` 훅 설계

```typescript
// 인터페이스 설계
interface UseWhisperSTTOptions {
  language?: string;          // 기본값 "ko"
  maxDurationMs?: number;     // 최대 녹음 시간 (기본 60000ms)
  onTranscribed?: (text: string) => void;  // 변환 완료 콜백
}

interface UseWhisperSTTReturn {
  // 상태
  isRecording: boolean;       // 녹음 중
  isTranscribing: boolean;    // 서버 변환 중
  transcript: string;         // 변환된 텍스트
  error: string | null;       // 에러 메시지
  // 액션
  startRecording: () => Promise<void>;
  stopAndTranscribe: () => Promise<string | null>;
  reset: () => void;
}
```

**내부 동작:**
1. `startRecording`: `useAudioRecorder.startRecording()` 위임
2. `stopAndTranscribe`: 녹음 중지 → Blob 획득 → `SttApi.transcribe(blob)` 호출 → 텍스트 반환
3. 상태 전이: `idle` → `recording` → `transcribing` → `idle`

### 6.3 `RecordButton` 공통 컴포넌트

```typescript
interface RecordButtonProps {
  onTranscribed: (text: string) => void;  // 변환 완료 시 콜백
  disabled?: boolean;
  maxDurationMs?: number;
  className?: string;
  // 시각적 변형
  size?: 'sm' | 'md' | 'lg';
  showTranscript?: boolean;   // 변환 결과 텍스트 표시 여부
}
```

**UI 상태별 표시:**
- `idle`: 마이크 아이콘 + "녹음" 텍스트 (세이지 그린 테두리)
- `recording`: 빨간 점 펄스 애니메이션 + "녹음 중..." + 경과 시간
- `transcribing`: 로딩 스피너 + "변환 중..."
- `error`: 에러 메시지 + 재시도 버튼

**디자인 시스템 준수:**
- Warm Clinical 테마 (세이지 그린 `#2D6A56` 액센트)
- 모서리: `rounded-xl` (16px)
- 모션: 180ms ease 상태 전환
- 폰트: Pretendard

### 6.4 `SttApi` 인프라 클래스

```typescript
// infrastructure/SttApi.ts
class SttApi {
  private static BASE_URL = import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8000';
  
  static async transcribe(audioBlob: Blob, language = 'ko'): Promise<SttResponse> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('language', language);
    
    const response = await fetch(`${this.BASE_URL}/stt/transcribe`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) throw new SttApiError(response.status, await response.text());
    return response.json();
  }
}
```

---

## 7. Backend(NestJS) 연동

### 7.1 결정: 직접 통신 (프론트엔드 → ai-service)

NestJS 백엔드를 프록시로 사용하지 않는다. 이유:
- 오디오 바이너리 중계는 불필요한 메모리/네트워크 비용
- ai-service CORS에 프론트엔드 origin이 이미 등록됨
- STT는 인증이 필요 없는 순수 변환 기능

### 7.2 향후 확장 시 NestJS 연동 포인트

- STT 결과를 DB에 저장해야 하는 경우 → 프론트엔드가 STT 결과를 NestJS API로 별도 전송
- 평가 결과 제출 시 STT 텍스트를 포함하여 NestJS에 전달 (기존 평가 결과 저장 API 활용)

---

## 8. STT 결과 활용 패턴 (3가지 모드)

### Mode 1: 단순 텍스트 표시
- **사용 화면**: 자유 발화 연습, 대화 훈련 등
- **흐름**: `useWhisperSTT` → `transcript`를 화면에 표시
- **추가 로직**: 없음

### Mode 2: 정답 비교 (채점)
- **사용 화면**: Repetition(따라말하기), ReadingAloud(소리내어읽기) 등
- **흐름**: `useWhisperSTT` → `transcript`를 기존 `cerCalculator`에 전달 → CER 점수 산출
- **기존 코드 재사용**: `frontend/src/assessments/repetition/domain/cerCalculator.ts`
- **교체 포인트**: 현재 `useRepetitionViewModel`에서 Web Speech API를 직접 사용 중 → `useWhisperSTT`로 교체 가능 (선택적)

### Mode 3: AI 대화 입력
- **사용 화면**: Memory Link 대화 훈련
- **흐름**: `useWhisperSTT` → `transcript`를 `/chat` 엔드포인트의 `user_message`로 전달
- **기존 코드 연동**: NestJS → ai-service `/chat` API 호출 시 `user_message` 필드에 STT 텍스트 삽입

---

## 9. 에러 처리 및 타임아웃 전략

### 9.1 프론트엔드

| 에러 상황 | 처리 방식 |
|----------|----------|
| 마이크 권한 거부 | "마이크 권한이 필요합니다" 안내 + 설정 가이드 |
| 녹음 실패 | 에러 메시지 표시 + 재시도 버튼 |
| 네트워크 오류 (ai-service 연결 불가) | "서버 연결 실패" + 재시도 (최대 2회) |
| 변환 타임아웃 (30초 초과) | AbortController로 요청 취소 + "시간 초과" 안내 |
| 빈 오디오 (무음 녹음) | 최소 0.5초 미만 녹음 시 전송하지 않고 안내 |

### 9.2 ai-service

| 에러 상황 | HTTP 코드 | 처리 방식 |
|----------|----------|----------|
| 지원하지 않는 파일 형식 | 400 | 허용 확장자 목록 안내 |
| 파일 크기 초과 (>10MB) | 400 | 최대 크기 안내 |
| Whisper 모델 미로딩 | 503 | "모델 로딩 중, 잠시 후 재시도" |
| ffmpeg 미설치 | 500 | 서버 로그 기록 + 일반 에러 응답 |
| Whisper 변환 실패 | 500 | 에러 상세 로깅 + 일반 에러 응답 |

### 9.3 타임아웃 설정

- **프론트엔드 → ai-service 요청**: 30초 (AbortController)
- **Whisper 변환 내부**: base 모델 기준 10초 이내 예상 (60초 오디오 기준)
- **최대 녹음 시간**: 60초 (useWhisperSTT에서 자동 종료)

---

## 10. 구현 순서 (Phase별)

### Phase 1: ai-service STT 엔드포인트 (백엔드 우선)
> 예상 소요: 중간 난이도

- [ ] [쉬움] 1-1. `requirements.txt`에 `openai-whisper`, `python-multipart` 추가
- [ ] [쉬움] 1-2. `models/stt.py` — Pydantic 요청/응답 모델 작성
- [ ] [보통] 1-3. `services/stt_service.py` — Whisper 모델 로딩 + transcribe 로직
- [ ] [보통] 1-4. `routers/stt.py` — POST /stt/transcribe 엔드포인트
- [ ] [쉬움] 1-5. `dependencies.py` — SttService DI 팩토리 추가
- [ ] [쉬움] 1-6. `main.py` — STT 라우터 등록
- [ ] [보통] 1-7. 수동 테스트 — curl/Postman으로 오디오 파일 업로드 확인

### Phase 2: 프론트엔드 인프라 및 공통 훅
> 예상 소요: 중간 난이도

- [ ] [쉬움] 2-1. `shared/infrastructure/SttApi.ts` — API 호출 클래스
- [ ] [보통] 2-2. `shared/hooks/useWhisperSTT.ts` — Whisper STT 훅 구현
- [ ] [보통] 2-3. `shared/hooks/useWhisperSTT.test.ts` — 훅 단위 테스트
- [ ] [쉬움] 2-4. 환경변수 설정 — `VITE_AI_SERVICE_URL` 추가 (.env.example)

### Phase 3: 공통 RecordButton 컴포넌트
> 예상 소요: 중간 난이도

- [ ] [보통] 3-1. `shared/components/RecordButton.tsx` — UI 컴포넌트 구현
- [ ] [보통] 3-2. `shared/components/RecordButton.test.tsx` — 컴포넌트 테스트
- [ ] [쉬움] 3-3. Warm Clinical 디자인 시스템 적용 확인

### Phase 4: 기존 화면 통합 (선택적)
> 예상 소요: 보통~어려움

- [ ] [보통] 4-1. Repetition 화면에 Whisper STT 옵션 추가 (기존 Web Speech API와 병행)
- [ ] [보통] 4-2. ReadingAloud 화면에 RecordButton 통합
- [ ] [보통] 4-3. PictureNaming 화면에 RecordButton 통합
- [ ] [어려움] 4-4. Memory Link 대화 훈련에 STT → AI 대화 연동

### Phase 5: 품질 및 최적화
> 예상 소요: 보통

- [ ] [보통] 5-1. 한국어 인식 정확도 수동 테스트 및 리포트
- [ ] [보통] 5-2. 에러 처리 경계 케이스 점검 (네트워크 끊김, 대용량 파일 등)
- [ ] [쉬움] 5-3. ffmpeg 설치 가이드 문서 작성 (개발/배포 환경별)

---

## 11. 기술 스택 및 의존성

### ai-service (Python) — 신규 추가 패키지

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `openai-whisper` | latest | Whisper STT 모델 |
| `python-multipart` | latest | FastAPI 파일 업로드 지원 |
| `ffmpeg` (시스템) | 6.x+ | Whisper 오디오 전처리 의존성 |

### Frontend — 신규 추가 없음
- 기존 `useAudioRecorder` 훅 재사용
- `fetch` API 사용 (추가 라이브러리 불필요)

---

## 12. Proposed Changes (파일 단위)

### ai-service

| 파일 | 상태 | 설명 |
|------|------|------|
| `ai-service/requirements.txt` | [MODIFY] | openai-whisper, python-multipart 추가 |
| `ai-service/models/stt.py` | [NEW] | TranscribeRequest, TranscribeResponse 모델 |
| `ai-service/services/stt_service.py` | [NEW] | SttService 클래스 (모델 로딩, 변환) |
| `ai-service/routers/stt.py` | [NEW] | POST /stt/transcribe 엔드포인트 |
| `ai-service/dependencies.py` | [MODIFY] | get_stt_service() 팩토리 추가 |
| `ai-service/main.py` | [MODIFY] | stt 라우터 등록 |

### Frontend

| 파일 | 상태 | 설명 |
|------|------|------|
| `frontend/src/shared/infrastructure/SttApi.ts` | [NEW] | ai-service STT API 호출 |
| `frontend/src/shared/hooks/useWhisperSTT.ts` | [NEW] | Whisper 기반 STT 훅 |
| `frontend/src/shared/hooks/useWhisperSTT.test.ts` | [NEW] | 훅 단위 테스트 |
| `frontend/src/shared/components/RecordButton.tsx` | [NEW] | 공통 녹음 버튼 컴포넌트 |
| `frontend/src/shared/components/RecordButton.test.tsx` | [NEW] | 컴포넌트 테스트 |
| `frontend/.env.example` | [MODIFY] | VITE_AI_SERVICE_URL 추가 |

### 기존 파일 (Phase 4에서 선택적 수정)

| 파일 | 상태 | 설명 |
|------|------|------|
| `frontend/src/assessments/repetition/presentation/useRepetitionViewModel.ts` | [MODIFY] | Whisper STT 옵션 통합 (선택적) |
| `frontend/src/assessments/readingAloud/presentation/useReadingAloudViewModel.ts` | [MODIFY] | RecordButton 통합 (선택적) |
| `frontend/src/assessments/pictureNaming/presentation/usePictureNamingViewModel.ts` | [MODIFY] | RecordButton 통합 (선택적) |
