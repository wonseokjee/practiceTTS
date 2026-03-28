"""
마스킹 entity_map 임시 보관 추상 인터페이스.
entity_map은 보안상 외부로 전달하지 않고 이 스토어에만 보관한다.
구현체(InMemoryMaskingStore, RedisMaskingStore 등)는 이 인터페이스만 상속한다.
"""
from abc import ABC, abstractmethod


class IMaskingStore(ABC):
    """entity_map 임시 보관 추상 인터페이스 (메모리 또는 Redis)."""

    @abstractmethod
    async def save(self, entry_id: str, entity_map: dict[str, str]) -> None:
        """entity_map을 entry_id 키로 저장.

        Args:
            entry_id: memory_entry_id (저장 키)
            entity_map: {"원본값": "익명식별자"} 형식의 매핑
        """
        ...

    @abstractmethod
    async def get(self, entry_id: str) -> dict[str, str] | None:
        """entry_id에 해당하는 entity_map 조회.

        Args:
            entry_id: 조회할 memory_entry_id

        Returns:
            저장된 entity_map 또는 None (미존재 시)
        """
        ...

    @abstractmethod
    async def delete(self, entry_id: str) -> None:
        """entry_id에 해당하는 entity_map 삭제.

        Args:
            entry_id: 삭제할 memory_entry_id
        """
        ...
