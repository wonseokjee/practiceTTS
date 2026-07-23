# A단계 설계 — 서버 STT (제약 인식 + phrase hint)

- **작성일**: 2026-07-02
- **선행**: [20260702_STT_tech_debt.md](20260702_STT_tech_debt.md), B단계(음소 유사 채점, 커밋 `1565a9b`)
- **상태**: 설계 (미구현)

## 1. 목표 & 범위

**목표**: 브라우저 Web Speech API를 **서버 STT(Azure)**로 대체하고, 과제의 정답 후보를 **phrase hint**로 넘겨 병리 발화 인식률을 높인다.

**범위 (제약 인식)**: 정답을 아는 발화 과제만 대상.
- 퀴즈 발화 항목: `SpeechInput`(speech), `SpeechCaptureItem`(따라말하기·읽기), `PictureNamingItem`(이름대기)
- **제외**: 대화 모드(`TrainingScreen`) 자유 인식 → 별도 부채(자유 STT).

**원칙**: 인식(엔진)은 서버, **채점은 기존 프론트 도메인 로직 재사용**(B단계 `phoneticDistance`/`speechScore`/`nameMatch`). 서버는 transcript + n-best 후보만 돌려주고 판정은 프론트가 한다 → 변경 최소, 채점 축 유지.

## 2. 아키텍처

```
[프론트] MediaRecorder 녹음(오디오 blob)
   │  POST (audio + lang + 정답후보[])
   ▼
[ai-service] /stt 라우터
   → SttEngine 어댑터  ── Azure Speech (PhraseListGrammar = 정답후보 부스팅)
   → { transcript, confidence, nbest[] }
   ▼
[프론트] 기존 채점(isNameMatch / isSpeechCorrect) 으로 정답 판정
```

**호출 경로 결정 필요** (§9):
- (a) 프론트 → **ai-service 직접**(CORS 이미 허용). 오디오 바이너리라 프록시 부담 없음. 인증 토큰 헤더 전달.
- (b) 프론트 → **backend(NestJS) 프록시** → ai-service. 인증·로깅 일관성. 단 오디오 프록시 부담.
- 권장: 초기엔 (a) 직접(단순), 인증/감사 요구가 커지면 (b)로.

## 3. 엔드포인트 스펙 (ai-service)

```
POST /stt
Content-Type: multipart/form-data
  audio: File            # 녹음 오디오 (§4 포맷)
  lang:  str = "ko-KR"   # 언어 코드
  candidates: str[] = [] # 정답 + 오답 후보(phrase hint). 없으면 자유 인식.

200 →
{
  "transcript": "바다",
  "confidence": 0.72,
  "nbest": [ {"text":"바다","confidence":0.72}, {"text":"파다","confidence":0.41} ],
  "engine": "azure"
}
4xx/5xx → { "error": "..." }  # 프론트는 Web Speech 폴백(§7)
```

- `candidates`는 과제에서 이미 안다: naming/speech은 정답 단어(+유사 오답), 객관식 기반은 보기들.
- 채점은 프론트가 `transcript`(및 필요 시 `nbest`)로 수행.

## 4. 오디오 캡처 & 포맷

- 프론트: `MediaRecorder`로 녹음. 크롬 기본은 `audio/webm;codecs=opus`.
- Azure Speech SDK 입력은 WAV/PCM(16kHz mono) 선호 → **서버에서 변환** 필요.
  - 옵션 1: ai-service에서 `ffmpeg`(pydub)로 webm/opus → 16kHz mono WAV 변환.
  - 옵션 2: 프론트에서 `AudioContext`로 PCM WAV 직접 생성 후 전송(서버 변환 불필요, 프론트 복잡).
  - 권장: **옵션 1**(서버 변환) — 프론트 단순, ffmpeg 의존성은 ai-service에 추가.
- 녹음 길이 제한(예: 최대 10초), 무음 트리밍은 후속 최적화.

## 5. Azure Speech 연동

- SDK: `azure-cognitiveservices-speech` (Python).
- 자격: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (기존 TTS Azure 계정에 Speech 리소스 추가, `.env`).
- **Phrase List(제약 부스팅)**: `PhraseListGrammar.from_recognizer(recognizer)` 에 `candidates` 추가 → 후보 단어 인식 가중. 병리 발화에서 효과 큼.
- 단발 인식: `recognize_once_async()`.
- (후속) **Custom Speech**: 노인/구음장애 오디오로 음향모델 적응 → 리소스에 배포된 endpoint id 사용.

## 6. 엔진 어댑터 계층 (교체 가능성)

부채 문서 원칙대로 엔진을 감춘다.
```
ai-service/
  interfaces/stt_engine.py   # Protocol: recognize(audio_wav, lang, candidates) -> SttResult
  infra/azure_stt.py         # AzureSttEngine (PhraseListGrammar)
  infra/whisper_stt.py       # (후속) WhisperSttEngine — GPU 확보 시
  services/stt_service.py    # 엔진 선택 + 오디오 변환 오케스트레이션
  routers/stt.py             # HTTP 경계
```
→ Azure→Whisper 이전이 `infra/*_stt.py` 교체 + 환경변수 스위치로 끝난다.

## 7. 폴백 전략

- 서버 STT 실패(네트워크·5xx·타임아웃) 시 **Web Speech API로 자동 폴백**(오프라인·저지연).
- 프론트 `ISttService`를 두 구현으로:
  - `ServerSttService`(신규): MediaRecorder → /stt.
  - `WebSpeechSttService`(기존): 폴백/오프라인.
- 조립 지점(Composition Root)에서 서버 우선 + 실패 시 폴백하는 래퍼로 주입.

## 8. 프라이버시 & 동의

- 음성은 **개인 의료정보**. 전송·저장 동의 필요.
- 기본은 **인식 후 즉시 폐기**(저장 안 함). 파인튜닝용 저장은 **별도 명시 동의** + 비식별화 후에만.
- Azure 전송 = 클라우드 이관. 온프레미스 요구가 강하면 Whisper 자체호스팅(부채 문서 참고).

## 9. 미해결 결정 (구현 착수 전 확정)

1. **호출 경로**: ai-service 직접(a) vs backend 프록시(b) → 초기 (a) 권장.
2. **오디오 포맷/변환**: 서버 변환(ffmpeg) 채택 여부 → 권장 채택.
3. **채점 위치**: 프론트 유지(권장) vs 서버 이전(다국어 확장 시 재검토).
4. **Azure 리소스**: Speech 키·리전 준비 여부(미보유면 발급 필요).

## 10. 구현 단계 (A)

1. `ai-service`: `/stt` 라우터 + `SttEngine` 인터페이스 + `AzureSttEngine`(PhraseListGrammar) + 오디오 변환. 유닛 테스트(모킹).
2. 프론트: `ServerSttService`(MediaRecorder) + 폴백 래퍼. 발화 항목 컴포넌트를 서버 STT로 전환하되 `candidates` 전달.
3. 채점 연결: 기존 `isNameMatch`/`isSpeechCorrect`에 `transcript` 투입(그대로 재사용).
4. E2E 확인: 실제 발화로 phrase hint 유무 정확도 비교.
5. (후속) Custom Speech 적응, 대화 자유인식(부채).
