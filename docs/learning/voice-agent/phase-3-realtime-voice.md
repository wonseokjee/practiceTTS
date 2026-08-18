# Phase 3 — 실시간 음성 코어 (3주) ★ 최중요

**목표**: 사람이 끼어들 수 있고, 800ms 안에 반응하는 대화형 음성 에이전트를 만든다.

**이 단계가 변별력의 대부분입니다.** "LLM에 TTS를 붙여봤다"는 사람은 많지만, 지연을
ms 단위로 분해해 깎아본 사람은 드뭅니다.

---

## 3-1. 지연 예산 — 모든 것의 출발점 (2일)

### 왜 800ms인가

사람 대화에서 화자 전환 간격(turn-taking gap)의 중앙값은 대략 200ms 안팎이고,
1초를 넘기면 "뜸을 들인다"고 인식됩니다. 전화 통화는 시각 신호가 없어 침묵이 더
길게 느껴집니다. **발화 종료 → 첫 오디오 출력 800ms**를 넘기면 사용자는
"응답이 없나?" 하며 말을 겹쳐 시작합니다.

### 예산 분해

| 구간 | 예산 | 무엇이 일어나는가 |
|---|---:|---|
| 종단 감지 (VAD / endpointing) | 200~300ms | "말이 끝났다"고 판정하기까지 |
| STT final 확정 | 100ms | partial을 미리 흘려보내면 대부분 상쇄 |
| LLM 첫 토큰 (TTFT) | 300~400ms | 프롬프트 길이·모델 크기에 비례 |
| TTS 첫 바이트 (TTFB) | 100~150ms | 첫 문장만 나오면 됨 |
| 네트워크·버퍼링 | 100ms | 전화망이면 여기가 더 큼 |
| **합계** | **800~1050ms** | |

**이 표를 외우지 마세요. 자기 시스템에서 직접 재서 자기 표를 만드는 것이 목표입니다.**
Phase 2에서 만든 span이 여기에 쓰입니다.

### 예산을 지키는 3가지 트릭

1. **Partial transcript로 미리 시작** — STT final을 기다리지 말고 partial이 안정되면
   LLM 요청을 투기적으로 시작. final이 다르면 취소.
2. **첫 문장만 먼저 TTS** — LLM이 다 끝나기를 기다리지 않고 첫 문장 경계에서 즉시
   TTS로 흘려보냄. 나머지는 재생 중에 생성.
3. **필러(filler) 재생** — 도구 호출처럼 오래 걸리는 구간에 "네, 확인해 볼게요"를
   사전 생성 캐시에서 즉시 재생. 체감 지연을 크게 줄임.

> 3번은 사전 생성 TTS 캐시가 있으면 공짜로 얻는 이득입니다. 고정 문구를 미리
> 만들어두는 하이브리드 캐싱 전략이 실시간 음성에서 그대로 값어치를 합니다.

---

## 3-2. 파이프라인 구조 (3일)

```
마이크 ──▶ VAD ──▶ STT(스트리밍) ──▶ LLM(스트리밍) ──▶ TTS(스트리밍) ──▶ 스피커
             │                                                            │
             └──────────── barge-in: 사용자 발화 감지 시 ────────────────┘
                            TTS 재생 취소 + LLM 스트림 abort
```

### 코드 골격 (개념 코드)

```python
class VoiceTurn:
    def __init__(self):
        self.llm_task = None
        self.tts_task = None

    async def on_user_speech_start(self):
        """barge-in: 사용자가 말을 시작하면 진행 중인 모든 출력을 죽인다"""
        if self.tts_task:
            self.tts_task.cancel()
            await self.transport.clear_output_buffer()   # ← 핵심
        if self.llm_task:
            self.llm_task.cancel()

    async def on_final_transcript(self, text: str):
        self.llm_task = asyncio.create_task(self.respond(text))

    async def respond(self, text: str):
        buffer = ""
        async for token in llm.stream(text):
            buffer += token
            if sentence_boundary(buffer):          # 문장 경계에서 flush
                sentence, buffer = split_at_boundary(buffer)
                await self.tts_queue.put(sentence)
        if buffer:
            await self.tts_queue.put(buffer)
```

---

## 3-3. 턴 감지 — 가장 과소평가된 부분 (4일)

### 단순 침묵 VAD의 한계

```python
# 흔한 첫 구현 — 그리고 사용자를 화나게 하는 구현
if silence_duration > 500:  # ms
    finalize_turn()
```

이 구현이 깨지는 실제 상황:

| 발화 | 문제 |
|---|---|
| "음... 그러니까... 다음 주에" | 생각하느라 쉰 걸 끝난 걸로 오인 → 말 끊음 |
| "제 번호는 010" (숫자 읽는 중) | 숫자 사이 간격에서 끊김 |
| "네." (짧은 대답) | 500ms 대기가 통째로 낭비됨 |
| "어... (2초) ...아니 취소할게요" | 앞부분만 듣고 잘못 처리 |

### Semantic endpointing

**침묵 길이 + 문장이 의미적으로 완결되었는가**를 함께 봅니다.

```
"다음 주 화요일에"        → 미완결 → 더 기다림 (침묵 1200ms까지 허용)
"다음 주 화요일에 4명이요" → 완결   → 즉시 종료 (침묵 300ms면 충분)
```

구현 방식 두 가지:

1. **작은 분류 모델** — partial transcript를 받아 완결/미완결을 이진 분류.
   Haiku급 모델이나 전용 endpointing 모델. 추가 지연 50~100ms.
2. **동적 침묵 임계값** — 문장이 조사/접속사로 끝나면 임계값을 늘리고, 종결어미로
   끝나면 줄임. 한국어는 어미가 명확해서 규칙 기반도 꽤 잘 동작합니다.

> **한국어 특수성**: "~인데요", "~하고요"처럼 종결어미로 끝나면서도 말이 이어지는
> 패턴이 많습니다. 영어 기준으로 튜닝된 endpointing 모델이 한국어에서 잘 안 맞는
> 흔한 이유이고, 면접에서 이야기하기 좋은 주제입니다.

---

## 3-4. Barge-in — 대화 품질의 절반 (4일)

사용자가 끼어들었을 때 해야 할 일은 4가지이고, **하나라도 빠지면 티가 납니다.**

| # | 할 일 | 빠뜨렸을 때 증상 |
|---|---|---|
| 1 | TTS 생성 중단 | 비용 낭비 (증상은 안 보임) |
| 2 | **이미 전송된 오디오 버퍼 폐기** | 끼어들었는데 봇이 1~2초 더 말함 |
| 3 | LLM 스트림 abort | 다음 턴에 이전 응답이 섞임 |
| 4 | **어디까지 말했는지 대화 기록에 반영** | 봇이 안 한 말을 했다고 착각 |

4번이 가장 자주 빠집니다.

```python
# 나쁜 예: 생성한 전체를 기록
messages.append({"role": "assistant", "content": full_response})

# 좋은 예: 실제로 재생된 부분까지만
spoken = full_response[:chars_actually_played]
messages.append({"role": "assistant", "content": spoken + " (사용자가 끼어듦)"})
```

이걸 안 하면 사용자가 "아까 뭐라고 했죠?"라고 물었을 때 봇이 **재생되지도 않은 문장을
방금 말한 것처럼** 대답합니다.

### 에코 문제

스피커 출력이 마이크로 되돌아와 자기 목소리를 사용자 발화로 오인하는 문제.

- **브라우저**: `getUserMedia({ audio: { echoCancellation: true } })` — WebRTC AEC가
  대부분 처리
- **전화망**: 캐리어단 에코 제거에 의존. 그래도 새면 half-duplex(TTS 재생 중
  마이크 게이트)로 회피 — 단 barge-in을 포기하게 되므로 최후 수단
- **공통 안전장치**: TTS로 방금 말한 텍스트와 STT 결과가 높은 유사도면 무시

---

## 3-5. 두 가지 아키텍처 (2일)

### 캐스케이드 vs Speech-to-Speech

|  | 캐스케이드 (STT→LLM→TTS) | Speech-to-Speech |
|---|---|---|
| 지연 | 높음 (누적) | 낮음 |
| 각 단계 제어 | 자유롭게 개입 가능 | 제한적 |
| 텍스트 로그 | 완비 | 별도 전사 필요 |
| 도구 호출 | 자유로움 | 지원하나 제약 있음 |
| 목소리 교체 | TTS만 바꾸면 됨 | 모델에 종속 |
| 감정·억양 표현 | 약함 | 강함 |
| 비용 | 조합 최적화 가능 | 오디오 토큰이 비쌈 |

대표 S2S: OpenAI Realtime API, Gemini Live API. 둘 다 직접 만져보되,
**엔터프라이즈 컨택센터는 여전히 캐스케이드가 주류**라는 점을 이해하세요. 이유:

- 감사 로그·컴플라이언스 — 모든 턴의 텍스트가 남아야 함
- 결정성 — 특정 문구를 반드시 말해야 하는 규제 요건(녹취 고지 등)
- 비용 통제 — 구간별로 저렴한 조합을 선택 가능
- 벤더 락인 회피

**면접 답변 감각**: "S2S가 빠르니까 무조건 좋다"가 아니라, 위 표를 근거로
"이 요건에서는 캐스케이드"라고 말할 수 있어야 합니다.

---

## 3-6. 프레임워크 (3일)

### Pipecat — 학습용 최고

파이프라인이 명시적이라 데이터가 어디로 흐르는지 눈에 보입니다.

```python
pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    tts,
    transport.output(),
    context_aggregator.assistant(),
])
```

각 단계가 프레임을 주고받는 구조라 **barge-in이 어떤 프레임으로 전파되는지**를
직접 볼 수 있습니다. 개념 학습에는 이만한 게 없습니다.

### LiveKit Agents — 실무 표준

WebRTC 인프라와 통합되어 있고, Phase 4의 SIP 연동까지 한 번에 커버합니다.

```python
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(language="ko"),
        llm=openai.LLM(model="..."),      # 프로바이더 교체 가능
        tts=azure.TTS(voice="ko-KR-SunHiNeural"),
        turn_detection=MultilingualModel(),
    )
    await session.start(room=ctx.room, agent=Agent(instructions="..."))
```

**추천 순서**: Pipecat으로 개념을 익히고 → LiveKit으로 옮겨 실전 데모를 만든다.

---

## 실습 과제

**브라우저에서 대화 가능한 음성 에이전트 + 지연 계기판.**

필수 요구사항:

1. 마이크 → 대화 → 스피커 루프가 동작한다
2. **barge-in이 동작한다** (말하는 중에 끼어들면 즉시 멈춤)
3. 화면에 구간별 지연이 **실시간 ms로 표시**된다
   ```
   VAD 240ms | STT 80ms | LLM TTFT 390ms | TTS TTFB 130ms | 총 840ms
   ```
4. barge-in 시 실제 재생된 부분까지만 대화 기록에 남는다
5. 도구 호출 중에는 필러 음성이 재생된다

**심화**: 초기 구현의 지연을 측정해 기록해두고, 다음 3가지를 순서대로 적용하며
각각 몇 ms를 줄였는지 표로 만드세요.

- partial transcript 투기적 시작
- 첫 문장 조기 TTS flush
- semantic endpointing

이 표가 **포트폴리오 3번(지연 최적화 기록)의 원재료**입니다.

---

## 자가진단

- [ ] 자기 시스템의 구간별 지연을 ms 단위로 말할 수 있다
- [ ] barge-in에서 해야 할 4가지를 빠짐없이 댈 수 있다
- [ ] 단순 침묵 VAD가 깨지는 실제 발화 예시를 3개 이상 안다
- [ ] "첫 문장 조기 flush"가 왜 지연을 줄이는지 설명할 수 있다
- [ ] 캐스케이드와 S2S 중 하나를 고르고 그 이유를 요건 기반으로 말할 수 있다
- [ ] 에코 문제의 원인과 3가지 대응책을 안다
- [ ] 필러 음성이 체감 지연에 미치는 영향을 실측해봤다

---

## 참고자료

- Pipecat — `docs.pipecat.ai`
- LiveKit Agents — `docs.livekit.io/agents`
- Silero VAD (GitHub)
- OpenAI Realtime API / Google Gemini Live API 공식 문서

→ 다음: [Phase 4 — 텔레포니](phase-4-telephony.md)
