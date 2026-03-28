"""
벡터 스토어 추상 인터페이스 (RAG용).
구현체(InMemoryVectorStore, PgVectorStore 등)는 이 인터페이스만 상속한다.
"""
from abc import ABC, abstractmethod


class IVectorStore(ABC):
    """벡터 검색 추상 인터페이스 (RAG용)."""

    @abstractmethod
    async def upsert(self, doc_id: str, text: str, metadata: dict) -> None:
        """문서를 임베딩하여 저장하거나 기존 문서를 업데이트.

        Args:
            doc_id: 문서 고유 식별자 (memory_entry_id 등)
            text: 임베딩할 텍스트 (context_summary 등)
            metadata: 문서와 함께 저장할 메타데이터

        Raises:
            Exception: 저장 실패 시
        """
        ...

    @abstractmethod
    async def search(self, query: str, top_k: int = 3) -> list[dict]:
        """쿼리 텍스트와 유사한 문서를 검색하여 반환.

        Args:
            query: 검색할 텍스트 쿼리
            top_k: 반환할 최대 결과 수

        Returns:
            [{"doc_id": str, "text": str, "score": float, "metadata": dict}] 형식
        """
        ...

    @abstractmethod
    async def delete(self, doc_id: str) -> None:
        """저장된 문서 삭제.

        Args:
            doc_id: 삭제할 문서의 고유 식별자
        """
        ...
