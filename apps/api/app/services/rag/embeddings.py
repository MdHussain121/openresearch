import hashlib
import logging
import math
import re

from app.core.constants import STOP_WORDS

logger = logging.getLogger("openresearch.rag.embeddings")

# Vector dimension for feature-hash vectors
EMBEDDING_DIM = 128


class EmbeddingGenerator:
    """
    BLAKE2b feature-hash vector generator (NOT a learned embedding model).

    Produces L2-normalized 128-dim vectors via character n-gram hashing for
    cosine similarity. This is a lexical overlap approximation, not semantic
    similarity. A real embedding model (e.g. sentence-transformers via Ollama)
    is required for true semantic search — tracked as a migration item
    (architecture.md:101, audit-11 H-4).

    Uses BLAKE2b so embeddings remain stable across processes, restarts, and
    workers (builtin hash() is salted per process and must not be used).
    """

    @staticmethod
    def _stable_hash(value: str) -> int:
        return int.from_bytes(hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest(), "big")

    @classmethod
    def _compute_word_projections(cls, word: str, position_index: int, vector: list[float]) -> None:
        """Compute feature hashing across n-gram and subword projections for a single token."""
        h1 = cls._stable_hash(word) % EMBEDDING_DIM
        h2 = cls._stable_hash(f"{word}\x1f{len(word)}") % EMBEDDING_DIM

        # Positional weight and term frequency
        weight = 1.0 / (1.0 + 0.05 * math.log(1 + position_index))
        vector[h1] += weight * 1.5
        vector[h2] += weight * 0.8

        # Subword 3-gram character features
        if len(word) >= 3:
            for j in range(len(word) - 2):
                sub = word[j : j + 3]
                h_sub = cls._stable_hash(sub) % EMBEDDING_DIM
                vector[h_sub] += 0.35

    @classmethod
    def generate_embedding(cls, text: str) -> list[float]:
        if not text or not text.strip():
            return [0.0] * EMBEDDING_DIM

        # Clean text & filter stop words
        clean = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = [t for t in clean.split() if len(t) > 1 and t not in STOP_WORDS]
        if not tokens:
            # Fallback to non-empty tokens if all were stop words
            tokens = [t for t in clean.split() if len(t) > 1]
            if not tokens:
                return [0.0] * EMBEDDING_DIM

        vec = [0.0] * EMBEDDING_DIM

        for position_index, word in enumerate(tokens):
            cls._compute_word_projections(word, position_index, vec)

        # L2-normalization
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 1e-9:
            vec = [round(x / norm, 6) for x in vec]
        else:
            vec = [0.0] * EMBEDDING_DIM

        return vec

    @staticmethod
    def cosine_similarity(v1: list[float], v2: list[float]) -> float:
        if not v1 or not v2 or len(v1) != len(v2):
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2, strict=True))
        return max(0.0, min(1.0, dot))
