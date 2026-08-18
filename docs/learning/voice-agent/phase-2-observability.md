# Phase 2 — LLM 관측성 (1.5주)

**목표**: 통화 한 건을 구간별로 분해해서 "어디가 느린가"와 "건당 얼마인가"를
숫자로 답할 수 있게 만든다.

**왜 필요한가**: Phase 3에서 지연을 깎으려면 먼저 **측정**해야 합니다. 감으로
"LLM이 느린 것 같다"고 말하는 사람과 "p95에서 TTS TTFB가 340ms로 예산을
2배 초과한다"고 말하는 사람은 완전히 다른 엔지니어입니다.

---

## 2-1. Langfuse 기본 개념 (2일)

### 데이터 모델

```
Trace  (통화 한 건 = 하나의 trace)
 ├─ Span   "turn-1"
 │   ├─ Span       vad-endpoint      210ms
 │   ├─ Span       stt-final          95ms
 │   ├─ Generation llm-response      380ms   ← 토큰/비용 기록
 │   └─ Span       tts-first-byte    140ms
 ├─ Span   "turn-2"
 └─ Span   "tool: lookupReservation"
```

- **Trace** — 최상위 단위. 음성에서는 **통화 한 건**을 trace로 잡는 것이 정석
- **Span** — 임의의 작업 구간. 지연 분해의 단위
- **Generation** — LLM 호출 전용 span. 모델명·토큰·비용이 자동 기록됨
- **Session** — 여러 trace를 사용자 세션으로 묶음
- **User** — 사용자 단위 집계

### 셀프호스팅

```yaml
# docker-compose.yml (개념도 — 실제 구성은 공식 저장소 참조)
services:
  langfuse:
    image: langfuse/langfuse:latest
    environment:
      DATABASE_URL: postgresql://...
      NEXTAUTH_SECRET: ...
    ports: ["3000:3000"]
  postgres:
    image: postgres:16
  clickhouse:      # v3부터 이벤트 저장소로 사용
    image: clickhouse/clickhouse-server
```

엔터프라이즈 컨택센터는 통화 내용이 민감정보라 **셀프호스팅이 사실상 요구사항**입니다.
SaaS만 써본 경험보다 직접 띄워본 경험이 면접에서 더 유효합니다.

---

## 2-2. 계측 (3일)

### Python (FastAPI 계열)

```python
from langfuse import observe, get_client

langfuse = get_client()

@observe(name="voice-turn")
def handle_turn(audio_chunk, call_id: str):
    langfuse.update_current_trace(session_id=call_id)

    with langfuse.start_as_current_span(name="stt") as span:
        transcript = stt.transcribe(audio_chunk)
        span.update(output={"text": transcript})

    with langfuse.start_as_current_span(name="llm") as span:
        reply = agent.respond(transcript)

    with langfuse.start_as_current_span(name="tts-ttfb") as span:
        first_byte_at = tts.stream(reply).first_byte_time
        span.update(metadata={"ttfb_ms": first_byte_at})

    return reply
```

### TypeScript (AI SDK / Mastra)

AI SDK와 Mastra 모두 **OpenTelemetry**로 텔레메트리를 내보냅니다. Langfuse v3는
OTel 수집기이므로 별도 SDK 없이 붙습니다.

```ts
const result = await generateText({
  model: anthropic('claude-sonnet-5'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'voice-turn',
    metadata: { callId, turnIndex },
  },
})
```

> **가장 중요한 계측 습관**: 모든 span에 `callId`를 메타데이터로 붙이세요.
> 나중에 "그 이상한 통화"를 재현할 때 이것만이 유일한 실마리입니다.

---

## 2-3. 지연 분해 대시보드 (2일)

이 phase의 실질적 산출물입니다. Phase 3의 지연 예산을 검증할 계기판을 미리 만듭니다.

측정해야 할 값:

| 지표 | 정의 | 목표 |
|---|---|---|
| `turn_latency_p50` | 발화 종료 → 첫 오디오 출력 | 700ms |
| `turn_latency_p95` | 상동 | 1200ms |
| `llm_ttft` | LLM 요청 → 첫 토큰 | 400ms |
| `tts_ttfb` | TTS 요청 → 첫 오디오 바이트 | 150ms |
| `cost_per_call` | 통화당 총 원가 | Phase 7에서 사용 |
| `tool_error_rate` | 도구 호출 실패율 | 1% 미만 |

**p50이 아니라 p95를 봅니다.** 통화는 열 번 중 한 번만 어색해도 "이거 로봇이네"가
됩니다. 평균값 최적화는 음성에서 특히 함정입니다.

---

## 2-4. 프롬프트 관리와 평가 (2일)

### Prompt Management

프롬프트를 코드 배포와 분리해 Langfuse에서 버전 관리 → 배포 없이 롤백.

```python
prompt = langfuse.get_prompt("receptionist-system", label="production")
compiled = prompt.compile(business_name="가마솥 식당", hours="11:00-21:00")
```

BAML(Phase 1)과 역할이 겹쳐 보이지만 다릅니다.

- **BAML** — 프롬프트를 *코드*로 취급. 타입 안전성과 리뷰가 목적
- **Langfuse Prompt Management** — 프롬프트를 *설정*으로 취급. 무배포 변경이 목적

둘을 섞기보다 **하나를 정해서 일관되게** 쓰는 편이 낫습니다. 왜 그 선택을 했는지
설명할 수 있으면 충분합니다.

### Dataset + Evaluation

```python
dataset = langfuse.get_dataset("reservation-golden-set")

for item in dataset.items:
    with item.run(run_name="v2-shorter-prompt") as root:
        output = agent.respond(item.input)
        root.score_trace(name="intent_correct",
                         value=1 if output.intent == item.expected_output["intent"] else 0)
```

**LLM-as-a-judge**로 정성 항목도 채점합니다.

```
아래 응답을 평가하세요.
- 두 문장 이내인가? (전화 통화이므로 길면 감점)
- 한 번에 하나만 물어보는가?
- 처리 불가한 요청에 상담원 연결을 제안했는가?
0~1 점수와 근거를 함께 출력하세요.
```

---

## 실습 과제

1. Langfuse를 도커로 셀프호스팅한다.
2. Phase 1에서 만든 에이전트의 모든 호출에 trace를 붙인다.
3. 20턴짜리 대화를 10회 실행한다.
4. 대시보드에서 **가장 느린 span**을 찾아 이름을 댄다.
5. 골든셋 20건을 만들고 `intent_correct` 점수를 자동 채점한다.
6. 프롬프트를 한 줄 바꾼 뒤 두 버전의 점수를 비교한다.

**제출물**: "가장 느린 구간은 X였고, 원인은 Y였다"를 한 문단으로 정리.

---

## 자가진단

- [ ] trace / span / generation의 차이를 설명할 수 있다
- [ ] 통화 한 건을 4개 이상의 span으로 쪼개 계측할 수 있다
- [ ] p50이 아니라 p95를 보는 이유를 음성 맥락에서 설명할 수 있다
- [ ] 프롬프트 변경의 효과를 감이 아니라 점수로 비교해봤다
- [ ] 셀프호스팅이 컨택센터에서 요구사항이 되는 이유를 안다

---

## 참고자료

- Langfuse 공식 문서 — `langfuse.com/docs`
- Langfuse 셀프호스팅 — `langfuse.com/self-hosting`
- OpenTelemetry GenAI 시맨틱 컨벤션

→ 다음: [Phase 3 — 실시간 음성 코어](phase-3-realtime-voice.md)
