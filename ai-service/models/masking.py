"""텍스트 마스킹 엔드포인트 요청/응답 Pydantic 모델."""
from pydantic import BaseModel


class MaskRequest(BaseModel):
    """POST /mask 요청 모델."""

    raw_text: str  # 원본 텍스트 (보호자 입력 에피소드)
    memory_entry_id: str  # entity_map 저장 키로 사용
    # 메모 언어(보호자 로케일). 기본 ko-KR — 호출부 배선(backend fastApiClient.mask)은
    # 영어 문이 열릴 때 lang을 항상 보내도록 바꾸고 이 기본값을 없앤다(§17 D8).
    lang: str = "ko-KR"


class MaskResponse(BaseModel):
    """POST /mask 응답 모델.

    보안 규칙: entity_map은 이 모델에 절대 포함 금지.
    """

    memory_entry_id: str
    masked_text: str
    entity_count: int
    # True면 3계층(Gemini 이름 탐지)이 실패해 **실명이 남아 있을 수 있다**.
    # 호출자는 이 결과를 "마스킹 완료"로 저장하면 안 된다.
    degraded: bool = False
