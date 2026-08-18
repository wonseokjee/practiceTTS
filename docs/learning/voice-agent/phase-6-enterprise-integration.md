# Phase 6 — 엔터프라이즈 시스템 연동 (2주)

**목표**: 조회만 하는 봇이 아니라 **실제로 뭔가를 처리하는** 에이전트를 만든다.

**왜 중요한가**: "예약 현황을 알려드릴게요"까지만 하는 봇은 파일럿에서 죽습니다.
고객이 돈을 내는 건 "예약을 변경해 드렸습니다"입니다. 그리고 쓰기 작업이 들어가는
순간 난이도가 한 단계 올라갑니다.

---

## 6-1. 연동 대상 (4일)

무료로 실습 가능한 것 위주로 고릅니다.

| 시스템 | 실습 방법 | 배울 것 |
|---|---|---|
| **CRM** | Salesforce Developer Org (무료), HubSpot 무료 API | 고객 조회, 케이스 생성 |
| **스케줄링** | Google Calendar API, Cal.com | 예약 생성/변경/취소, 가용 시간 조회 |
| **ERP** | SAP는 실습 어려움 → 개념과 연동 패턴 위주 | 재고·주문 조회, 배치 동기화 |
| **메시징** | Twilio SMS | 확인 문자 발송 |

### 도구로 노출하기

```ts
const rescheduleAppointment = tool({
  description: `기존 예약의 날짜/시간을 변경한다.
    반드시 lookupCustomer로 고객을 먼저 확인한 뒤 호출할 것.
    변경 전에 사용자에게 새 일시를 복창해 확인받을 것.`,
  inputSchema: z.object({
    reservationId: z.string(),
    newStartsAt: z.string().describe('ISO 8601, 타임존 포함'),
    idempotencyKey: z.string().describe('통화ID + 요청순번'),
  }),
  execute: async (input) => {
    // 아래 안전장치들이 여기 들어감
  },
})
```

**설명(description)에 사전 조건과 확인 절차를 명시**하는 것이 쓰기 도구의 핵심입니다.
스키마만으로는 "먼저 고객 확인" 같은 순서를 강제할 수 없습니다.

---

## 6-2. ★ 쓰기 작업의 안전장치 (5일)

여기가 이 phase의 진짜 알맹이입니다. 읽기는 누구나 하지만, 쓰기를 안전하게 하는 건
설계가 필요합니다.

### 1. 멱등성 (Idempotency)

통화가 끊겼다 재연결되거나 네트워크 재시도가 발생하면 **같은 요청이 두 번 갈 수
있습니다.** 예약이 2건 생기면 사고입니다.

```python
async def create_reservation(payload, idempotency_key: str):
    existing = await db.get_by_idempotency_key(idempotency_key)
    if existing:
        return existing          # 재실행이 아니라 이전 결과 반환
    result = await crm.create(payload)
    await db.save_idempotency(idempotency_key, result)
    return result
```

키 생성 규칙: `f"{call_id}:{tool_name}:{turn_index}"` — 같은 턴의 재시도는 같은 키,
사용자가 진짜로 두 번 예약하면 다른 키.

### 2. Human-in-the-loop 승인 게이트

위험한 액션(취소, 환불, 금액 변경)은 사람 승인을 거칩니다.
Phase 1의 Mastra `suspend/resume`이 정확히 이 용도입니다.

```
봇: "예약을 취소하시는 게 맞을까요? 취소 수수료 1만원이 발생합니다."
사용자: "네"
  → suspend: 슈퍼바이저 대시보드에 승인 요청
  → 승인 → resume → 실제 취소 실행
```

**어디까지 자동화할지는 비즈니스 결정**이지 기술 결정이 아닙니다. 설정으로
빼두고 고객사가 정하게 하는 게 정답입니다.

### 3. 도구 실패 시 폴백 — 통화는 계속되고 있다

이게 텍스트 챗봇과 결정적으로 다른 점입니다. API가 500을 뱉어도 **사용자는 전화를
들고 기다리고 있습니다.**

```python
try:
    result = await crm.update(payload)
except TimeoutError:
    # 성공했는지 실패했는지 모르는 상태 — 가장 위험
    await say("확인이 조금 지연되고 있습니다. 상담원에게 연결해 드릴게요.")
    await escalate_to_human(context=collected_info)
except ValidationError as e:
    # 입력 문제 — 봇이 스스로 고칠 수 있음
    return {"error": str(e), "retryable": True}
except Exception:
    await say("시스템에 문제가 있어 지금은 처리가 어렵습니다. 상담원 연결해 드릴게요.")
    await escalate_to_human(context=collected_info)
```

**타임아웃이 가장 위험합니다.** 성공/실패를 모르는 상태에서 재시도하면 중복 처리,
포기하면 미처리. 멱등성 키가 있어야 안전하게 재시도할 수 있습니다 — 1번과 2번이
연결되는 지점입니다.

### 4. 감사 로그

```jsonc
{
  "call_id": "CA123",
  "turn": 7,
  "actor": "ai-agent",
  "tool": "rescheduleAppointment",
  "input": { "reservationId": "R456", "newStartsAt": "2026-08-03T19:00+09:00" },
  "idempotency_key": "CA123:reschedule:7",
  "approved_by": null,
  "result": "success",
  "transcript_excerpt": "네, 8월 3일 저녁 7시로 변경해 드릴게요.",
  "timestamp": "2026-07-29T10:23:11Z"
}
```

"AI가 왜 이 예약을 바꿨나"에 답할 수 없으면 엔터프라이즈에 못 들어갑니다.
Phase 2의 trace와 연결해두면 그대로 재생 가능한 기록이 됩니다.

### 5. PII 마스킹

전사 텍스트와 로그에서 주민번호·카드번호·계좌번호를 마스킹합니다.

정규식만으로는 한계가 있습니다. 특히 **한글 맥락에서 정규식 단어 경계(`\b`)는
제대로 동작하지 않습니다** — 한글은 `\w`에 포함되지 않아 경계 판정이 깨집니다.
완전한 차단에는 로컬 NER이 필요하고, 정규식은 1차 방어선으로 봐야 합니다.

---

## 6-3. MCP로 도구 표준화 (3일)

Model Context Protocol — 도구를 표준 프로토콜로 노출해 여러 에이전트에서 재사용.

```
CRM MCP 서버 ──┐
캘린더 MCP 서버 ├──▶ 음성 에이전트
SMS MCP 서버  ──┘   챗 에이전트
                    내부 운영 도구
```

**언제 쓸 가치가 있나**: 도구가 여러 에이전트/제품에서 재사용될 때. 단일 에이전트만
있으면 그냥 함수로 두는 게 간단합니다. "MCP를 썼다"보다 **"왜 MCP가 필요했는지"**를
말할 수 있는 게 중요합니다.

---

## 실습 과제

### 시나리오: "다음 주 화요일로 예약 옮겨줘"

```
1. 고객 식별      → CRM에서 전화번호로 조회
2. 기존 예약 확인  → 캘린더에서 현재 예약 조회
3. 가용성 확인    → 화요일 빈 슬롯 조회
4. 사용자 확인    → "8월 3일 저녁 7시로 옮길까요?"
5. 변경 실행      → 캘린더 + CRM 동시 갱신 (멱등성 키 포함)
6. 확인 발송      → SMS
```

### 필수 검증

- [ ] 같은 요청을 두 번 보내도 예약이 하나만 변경된다
- [ ] 3번 단계에서 API를 강제로 500 반환시켰을 때 **우아하게 상담원 이관**된다
- [ ] 5번에서 타임아웃을 강제했을 때 중복 처리도 미처리도 발생하지 않는다
- [ ] 통화 전사에 전화번호가 마스킹되어 저장된다
- [ ] 감사 로그만 보고 "무슨 일이 있었는지" 재구성할 수 있다

**강제 실패 주입이 과제의 핵심입니다.** 잘 될 때 되는 건 당연하고, 실패했을 때
어떻게 되는지가 실력입니다.

---

## 자가진단

- [ ] 멱등성 키를 어떻게 생성할지 규칙을 정할 수 있다
- [ ] 타임아웃이 명확한 실패보다 위험한 이유를 설명할 수 있다
- [ ] 도구 실패 시 통화를 어떻게 마무리할지 시나리오를 갖고 있다
- [ ] 어떤 액션에 사람 승인을 붙일지 판단 기준이 있다
- [ ] 감사 로그에 무엇을 남겨야 하는지 열거할 수 있다
- [ ] 정규식 PII 마스킹의 한계를 안다
- [ ] MCP를 쓸 때와 안 쓸 때의 판단 기준이 있다

---

## 참고자료

- Model Context Protocol — `modelcontextprotocol.io`
- Salesforce Developer Org (무료 가입)
- HubSpot API 문서
- Google Calendar API 문서
- Stripe의 멱등성 키 설계 문서 (업계 레퍼런스로 자주 인용됨)

→ 다음: [Phase 7 — 프로덕션 & 0-1](phase-7-production.md)
