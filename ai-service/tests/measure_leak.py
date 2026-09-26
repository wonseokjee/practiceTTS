"""외부 LLM으로 새는 PII 실측 하네스 (테스트 아님, 수동 실행용).

`_detect_pii_with_gemini`에 들어가는 텍스트가 곧 외부로 나가는 것이다.
그 텍스트를 가로채, 심어둔 PII가 몇 개나 남아 있는지 센다.

사용:  ai-service> venv/Scripts/python.exe tests/measure_leak.py
영어:  LANG_CODE=en-US venv/Scripts/python.exe tests/measure_leak.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.masking_service import MaskingService  # noqa: E402
from infra.in_memory_masking_store import InMemoryMaskingStore  # noqa: E402


# (노트, 그 안에 심어둔 PII 목록) — 보호자가 실제로 쓸 법한 문장들
CASES: list[tuple[str, list[str]]] = [
    ("오늘 아들 원석이랑 덕진공원에 산책을 갔어요.", ["원석", "덕진공원"]),
    ("김철수 선생님을 만나서 인사했어요.", ["김철수"]),
    ("영희랑 같이 점심으로 칼국수를 먹었어요.", ["영희"]),
    ("연락처 010-1234-5678도 받았어요.", ["010-1234-5678"]),
    ("어제 강남세브란스병원에 다녀왔습니다.", ["강남세브란스"]),
    ("역삼동 시장에서 과일을 샀어요.", ["역삼동"]),
    ("손녀 지민이가 놀러 왔어요.", ["지민"]),
    ("서울 강남구 사는 조카가 전화했어요.", ["강남구"]),
    ("민수한테 전화가 왔어요.", ["민수"]),
    ("이순신 여사님이랑 화투를 쳤어요.", ["이순신"]),
    ("큰딸 수진이가 미역국을 끓여줬어요.", ["수진"]),
    ("종로3가역에서 만나기로 했어요.", ["종로3가"]),
]


# 영어 보호자 메모. 앵커 없는 맨 이름·지명을 일부러 섞었다 — 로컬 계층이 포기하는
# 부분이라 이 숫자가 곧 "Gemini에 노출되는 양"이다.
CASES_EN: list[tuple[str, list[str]]] = [
    ("Today my son Michael took her to Prospect Park.", ["Michael", "Prospect Park"]),
    ("Dr. Patel said her blood pressure looks better.", ["Patel"]),
    ("Linda came over and they had lunch together.", ["Linda"]),
    ("You can reach me at (212) 555-0123 tonight.", ["555-0123"]),
    ("We went to Mount Sinai Hospital yesterday.", ["Mount Sinai"]),
    ("She bought apples at the market in Flushing.", ["Flushing"]),
    ("Her granddaughter Emma visited after school.", ["Emma"]),
    ("Her nephew from Fort Lee called this morning.", ["Fort Lee"]),
    ("Kevin called to say hello.", ["Kevin"]),
    ("Mrs. Alvarez played cards with her all afternoon.", ["Alvarez"]),
    ("Her oldest daughter Sarah made seaweed soup.", ["Sarah"]),
    ("They met at 34th Street station.", ["34th Street"]),
]

LANG = os.environ.get("LANG_CODE", "ko-KR")


class _Capture:
    """Gemini로 나가는 텍스트를 가로챈다 (실제 호출은 하지 않는다)."""

    def __init__(self) -> None:
        self.sent: list[str] = []

    async def detect(self, text: str):
        self.sent.append(text)
        return []


async def main() -> None:
    service = MaskingService(llm_client=None, masking_store=InMemoryMaskingStore())
    capture = _Capture()
    # 외부로 나가는 지점을 가로챈다
    service._detect_pii_with_gemini = capture.detect  # type: ignore[assignment]

    leaked_total = 0
    pii_total = 0
    leaked_items: list[str] = []

    cases = CASES_EN if LANG == "en-US" else CASES
    for idx, (note, secrets_in_note) in enumerate(cases):
        capture.sent.clear()
        try:
            await service.mask_text(note, f"measure-{idx}", lang=LANG)
        except Exception as exc:  # 잔존 검증 등에서 예외가 나도 계속 측정
            print(f"  (예외: {type(exc).__name__})", end=" ")
        outbound = capture.sent[0] if capture.sent else ""
        leaked = [s for s in secrets_in_note if s in outbound]
        pii_total += len(secrets_in_note)
        leaked_total += len(leaked)
        leaked_items.extend(leaked)
        mark = "누출" if leaked else "차단"
        print(f"[{mark}] {note}")
        if leaked:
            print(f"        → 외부로 나감: {', '.join(leaked)}")

    print()
    print(f"심어둔 PII {pii_total}개 중 {leaked_total}개가 외부 LLM으로 나감")
    print(f"차단율 {(pii_total - leaked_total) / pii_total * 100:.0f}%")
    if leaked_items:
        print("누출 항목:", ", ".join(sorted(set(leaked_items))))


if __name__ == "__main__":
    asyncio.run(main())
