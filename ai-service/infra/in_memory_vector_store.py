"""
인메모리 벡터 스토어 구현체 (MVP 단계).
IVectorStore 인터페이스를 numpy + sklearn TF-IDF 기반으로 구현한다.
sklearn이 없으면 키워드 매칭 방식으로 fallback.

교체 가능성:
  - pgvector 교체 시 이 파일만 수정 (PostgreSQL pgvector 익스텐션)
  - Chroma/Qdrant 교체 시 어댑터 파일 하나 추가

주의: 서버 재시작 시 벡터 데이터 소멸 → 재생성 필요
"""
import math

from interfaces.vector_store import IVectorStore

# sklearn 가용성 확인 (없으면 키워드 매칭 fallback)
try:
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    _SKLEARN_AVAILABLE = True
except ImportError:
    _SKLEARN_AVAILABLE = False


class InMemoryVectorStore(IVectorStore):
    """인메모리 TF-IDF 기반 벡터 스토어 (MVP 단계).

    sklearn 미설치 시 키워드 Jaccard 유사도로 자동 fallback.
    """

    def __init__(self) -> None:
        # doc_id → {"text": str, "metadata": dict} 저장소
        self._documents: dict[str, dict] = {}

    async def upsert(self, doc_id: str, text: str, metadata: dict) -> None:
        """문서를 저장하거나 기존 문서를 업데이트."""
        self._documents[doc_id] = {"text": text, "metadata": metadata}

    async def search(self, query: str, top_k: int = 3) -> list[dict]:
        """쿼리와 유사한 문서를 검색하여 반환.

        Returns:
            [{"doc_id": str, "text": str, "score": float, "metadata": dict}]
        """
        if not self._documents:
            return []

        if _SKLEARN_AVAILABLE:
            return self._search_tfidf(query, top_k)
        else:
            return self._search_keyword(query, top_k)

    async def delete(self, doc_id: str) -> None:
        """저장된 문서 삭제. 미존재 시 무시."""
        self._documents.pop(doc_id, None)

    def _search_tfidf(self, query: str, top_k: int) -> list[dict]:
        """TF-IDF 기반 코사인 유사도 검색."""
        doc_ids = list(self._documents.keys())
        texts = [self._documents[did]["text"] for did in doc_ids]

        vectorizer = TfidfVectorizer()
        # 문서 + 쿼리를 함께 fit 후 변환
        all_texts = texts + [query]
        tfidf_matrix = vectorizer.fit_transform(all_texts)

        doc_matrix = tfidf_matrix[:-1]
        query_vector = tfidf_matrix[-1]

        scores = cosine_similarity(query_vector, doc_matrix).flatten()

        # 점수 내림차순 정렬 후 top_k 반환
        ranked_indices = scores.argsort()[::-1][:top_k]
        return [
            {
                "doc_id": doc_ids[idx],
                "text": self._documents[doc_ids[idx]]["text"],
                "score": float(scores[idx]),
                "metadata": self._documents[doc_ids[idx]]["metadata"],
            }
            for idx in ranked_indices
            if scores[idx] > 0.0
        ]

    def _search_keyword(self, query: str, top_k: int) -> list[dict]:
        """키워드 Jaccard 유사도 기반 fallback 검색."""
        query_tokens = set(query.split())
        results: list[dict] = []

        for doc_id, doc in self._documents.items():
            doc_tokens = set(doc["text"].split())
            if not doc_tokens:
                continue
            # Jaccard 유사도 계산
            intersection = len(query_tokens & doc_tokens)
            union = len(query_tokens | doc_tokens)
            score = intersection / union if union > 0 else 0.0
            results.append(
                {
                    "doc_id": doc_id,
                    "text": doc["text"],
                    "score": score,
                    "metadata": doc["metadata"],
                }
            )

        # 점수 내림차순 정렬 후 top_k 반환
        results.sort(key=lambda x: x["score"], reverse=True)
        return [r for r in results[:top_k] if r["score"] > 0.0]
