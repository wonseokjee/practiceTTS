"""
인메모리 마스킹 스토어 구현체 (MVP 단계).
IMaskingStore 인터페이스를 딕셔너리 기반으로 구현한다.

교체 가능성:
  - Redis 교체 시 RedisMaskingStore 파일 추가 후 의존성 교체

주의:
  - 서버 재시작 시 소멸 → 마스킹 재처리 필요
  - entity_map은 이 스토어 외부로 절대 전달하지 않는다 (보안 규칙)
"""
from interfaces.masking_store import IMaskingStore


class InMemoryMaskingStore(IMaskingStore):
    """dict 기반 인메모리 entity_map 저장소 (MVP 단계)."""

    def __init__(self) -> None:
        # entry_id → entity_map {"원본값": "익명식별자"}
        self._store: dict[str, dict[str, str]] = {}

    async def save(self, entry_id: str, entity_map: dict[str, str]) -> None:
        """entity_map을 entry_id 키로 저장."""
        self._store[entry_id] = entity_map.copy()

    async def get(self, entry_id: str) -> dict[str, str] | None:
        """entry_id에 해당하는 entity_map 조회. 미존재 시 None 반환."""
        stored = self._store.get(entry_id)
        # 외부 수정 방지를 위해 복사본 반환
        return stored.copy() if stored is not None else None

    async def delete(self, entry_id: str) -> None:
        """entry_id에 해당하는 entity_map 삭제. 미존재 시 무시."""
        self._store.pop(entry_id, None)
