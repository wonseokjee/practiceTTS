# Phase 1 — 에이전트 기반 스택 (2주)

**목표**: 도구를 호출하고, 구조화된 출력을 보장하며, 프롬프트를 버전 관리하는
텍스트 에이전트를 만든다. 음성은 아직 붙이지 않는다.

**왜 먼저인가**: 음성 에이전트의 "두뇌"는 결국 텍스트 에이전트입니다. 실시간 오디오를
붙이기 전에 도구 호출·구조화 출력·상태 관리를 텍스트로 먼저 안정화시켜야, Phase 3에서
지연 문제가 생겼을 때 원인이 오디오인지 LLM인지 구분할 수 있습니다.

---

## 1-1. Vercel AI SDK (4일)

### 배울 것

프로바이더 추상화 위에 스트리밍·도구 호출·구조화 출력을 얹은 TypeScript 라이브러리.
같은 코드로 Claude / GPT / Gemini를 교체할 수 있다는 점이 핵심 가치입니다.

### 기본 호출과 스트리밍

```ts
import { anthropic } from '@ai-sdk/anthropic'
import { generateText, streamText } from 'ai'

// 단발 호출
const { text } = await generateText({
  model: anthropic('claude-sonnet-5'),
  prompt: '통화 요약을 3문장으로 써줘.',
})

// 스트리밍 — 음성에서는 이게 기본이 됩니다
const result = streamText({
  model: anthropic('claude-sonnet-5'),
  messages,
})
for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

> **음성 관점 메모**: Phase 3에서 첫 토큰까지의 시간(TTFT)이 지연 예산의 절반을
> 차지합니다. 지금부터 `generateText`가 아니라 `streamText`를 기본으로 쓰는 습관을
> 들이세요. 문장 단위로 잘라 TTS에 흘려보내는 구조가 그대로 재사용됩니다.

### 도구 호출

```ts
import { tool } from 'ai'
import { z } from 'zod'

const lookupReservation = tool({
  description: '전화번호로 예약을 조회한다. 사용자가 기존 예약을 언급하면 호출할 것.',
  inputSchema: z.object({
    phone: z.string().describe('하이픈 없는 휴대폰 번호'),
  }),
  execute: async ({ phone }) => {
    return await db.reservations.findByPhone(phone)
  },
})

const result = await generateText({
  model: anthropic('claude-sonnet-5'),
  tools: { lookupReservation },
  stopWhen: stepCountIs(5),   // 도구 호출 루프 최대 5스텝
  messages,
})
```

**설명(description)이 성능을 좌우합니다.** "예약을 조회한다"보다 "사용자가 기존 예약을
언급하면 호출할 것"처럼 **언제 부를지**를 명시하는 편이 호출률을 눈에 띄게 올립니다.
이건 프로바이더를 가리지 않는 일반 원칙입니다.

### 구조화 출력

```ts
const { object } = await generateObject({
  model: anthropic('claude-sonnet-5'),
  schema: z.object({
    intent: z.enum(['예약', '변경', '취소', '문의', '기타']),
    date: z.string().nullable(),
    partySize: z.number().nullable(),
    needsHuman: z.boolean(),
  }),
  prompt: transcript,
})
```

### 모델 선택 감각 (2026-07 기준)

| 모델 | 입력 $/1M | 출력 $/1M | 음성 에이전트에서의 역할 |
|---|---|---|---|
| `claude-opus-5` | $5 | $25 | 복잡한 다단계 판단, 오케스트레이터 |
| `claude-sonnet-5` | $3 | $15 | **실시간 대화 턴의 기본값** |
| `claude-haiku-4-5` | $1 | $5 | 인텐트 분류, 종단 감지 보조 |

실시간 음성은 TTFT가 생명이라 무거운 모델을 쓰기 어렵습니다. **큰 모델로 계획을 세우고
작은 모델로 턴을 처리하는 분리**가 흔한 패턴이며, Phase 3에서 다시 다룹니다.

---

## 1-2. Mastra (4일)

### 배울 것

AI SDK 위에 얹힌 프레임워크. Agent / Workflow / Memory / Eval을 제공합니다.
**순서는 반드시 AI SDK → Mastra**입니다. 밑단을 모르고 프레임워크부터 배우면
지연 문제가 생겼을 때 어디를 봐야 할지 알 수 없습니다.

```ts
import { Agent } from '@mastra/core/agent'
import { anthropic } from '@ai-sdk/anthropic'

export const receptionist = new Agent({
  name: 'reservation-receptionist',
  instructions: `
당신은 레스토랑 예약 접수원입니다. 전화 통화 중이므로:
- 한 번에 하나씩만 물어봅니다.
- 답변은 두 문장을 넘기지 않습니다.
- 예약에 필요한 정보(날짜, 시간, 인원, 이름)를 모두 모을 때까지 진행합니다.
- 처리할 수 없는 요청은 즉시 상담원 연결을 제안합니다.
  `,
  model: anthropic('claude-sonnet-5'),
  tools: { lookupReservation, createReservation },
})
```

### 핵심 개념 4가지

| 개념 | 무엇인가 | 음성에서의 쓰임 |
|---|---|---|
| **Agent** | 지시문 + 모델 + 도구 묶음 | 통화 한 건을 담당하는 주체 |
| **Workflow** | 분기·병렬·suspend/resume 가능한 단계 그래프 | 예약 확정 전 사람 승인 대기 |
| **Memory** | working memory + semantic recall | 통화 중 수집한 정보 유지, 재통화 시 이력 |
| **Eval** | 응답 품질 자동 채점 | Phase 7 회귀 테스트의 뼈대 |

`suspend/resume`은 특히 중요합니다. Phase 6의 "위험한 쓰기 작업 전 사람 승인"이
정확히 이 기능으로 구현됩니다.

---

## 1-3. BAML (3일)

### 배울 것

프롬프트를 **타입 있는 함수**로 선언하고, TypeScript/Python 클라이언트를 코드 생성하는 도구.

```baml
// baml_src/extract.baml

class ReservationRequest {
  intent "예약" | "변경" | "취소" | "문의"
  date string?
  time string?
  party_size int?
  customer_name string?
  confidence float
}

function ExtractReservation(transcript: string) -> ReservationRequest {
  client Sonnet
  prompt #"
    다음 통화 내용에서 예약 정보를 추출하세요.
    말끝이 흐려지거나 잡음이 섞였을 수 있습니다. 확신이 없으면 null로 두세요.

    {{ transcript }}

    {{ ctx.output_format }}
  "#
}
```

```bash
baml-cli generate    # → baml_client/ 생성
```

```ts
import { b } from './baml_client'
const parsed = await b.ExtractReservation(transcript)   // 완전한 타입
```

### BAML이 존재하는 진짜 이유: SAP

**Schema-Aligned Parsing.** 모델이 살짝 깨진 JSON(후행 쉼표, 코드펜스로 감싼 출력,
따옴표 누락)을 뱉어도 스키마에 맞춰 복구합니다. 일반 `JSON.parse`는 여기서 터집니다.

전화 통화는 STT 결과가 지저분하기 때문에 추출 실패율이 텍스트 입력보다 훨씬 높습니다.
파싱 실패 한 번이 통화 한 건을 날리는 환경에서 이 차이는 큽니다.

### 부가 가치

- 프롬프트가 **파일**이라 git diff와 코드 리뷰 대상이 됨
- `.baml` 안에 테스트 케이스를 함께 선언 → `baml-cli test`
- VSCode 확장에서 프롬프트를 즉석 실행

---

## 실습 과제

**같은 기능을 두 방식으로 구현하고 실패율을 비교합니다.**

기능: 통화 스크립트(한글, 구어체, 잡음 섞임) 30건에서 예약 정보를 추출.

1. **A안**: AI SDK `generateObject` 단독
2. **B안**: BAML + AI SDK

측정:

| 항목 | A안 | B안 |
|---|---|---|
| 파싱 실패 건수 / 30 | | |
| 필드 정확도 (정답 대비) | | |
| 평균 토큰 비용 | | |
| 평균 지연 (ms) | | |

> **이 표를 채우는 것이 과제의 핵심입니다.** "왜 BAML을 쓰는가"에 남의 블로그가 아니라
> 자기 데이터로 답할 수 있어야 합니다. 면접에서 그대로 쓸 수 있는 근거가 됩니다.

**보너스**: 일부러 STT가 망가진 입력("어 그 다음주 화요일 아니 수요일 네 명이요")을
넣어 두 방식의 회복력을 비교하세요. Phase 3에서 실제로 마주칠 입력입니다.

---

## 자가진단

- [ ] `streamText`의 스트림을 문장 단위로 잘라 다른 함수에 흘려보낼 수 있다
- [ ] 도구 설명을 "무엇을 하는가"가 아니라 "언제 부를 것인가"로 쓴다
- [ ] 도구 호출 루프의 최대 스텝을 제한하는 이유를 설명할 수 있다
- [ ] Mastra의 suspend/resume이 어떤 실무 요구를 푸는지 안다
- [ ] BAML의 SAP가 일반 JSON 파싱과 무엇이 다른지 예를 들어 설명할 수 있다
- [ ] 실시간 대화 턴에 Opus급 모델을 쓰기 어려운 이유를 안다

---

## 참고자료

- Vercel AI SDK 공식 문서 — `ai-sdk.dev`
- Mastra 공식 문서 — `mastra.ai/docs`
- BAML 공식 문서 — `docs.boundaryml.com`
- Anthropic 도구 사용 가이드 — `platform.claude.com/docs/en/agents-and-tools/tool-use/overview`

→ 다음: [Phase 2 — LLM 관측성](phase-2-observability.md)
