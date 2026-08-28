import hashlib
import re
from typing import ClassVar

from sqlalchemy.orm import Session

from app.core.text_utils import sanitize_surrogates
from app.models.document import Document
from app.schemas.models import (
    ClaimFlagSchema,
    ClaimVerificationRequest,
    ClaimVerificationResponse,
)


class ClaimVerificationService:
    """
    8.1 Claim Verification Engine (Roadmap 8.1):
    Mechanical check for zero-citation detection, confidence deferred.
    """

    CLAIM_MARKERS: ClassVar[list[str]] = [
        "improve",
        "increase",
        "decrease",
        "reduce",
        "achieve",
        "outperform",
        "show",
        "demonstrate",
        "state",
        "indicate",
        "require",
        "propose",
        "leads to",
        "resulting in",
        "accuracy",
        "latency",
        "benchmark",
        "model",
        "transformer",
        "neural",
        "dataset",
        "percent",
        "%",
        "faster",
        "higher",
        "lower",
        "significant",
        "superior",
    ]

    CITATION_PATTERN: ClassVar[re.Pattern] = re.compile(
        r"(\[\d+\]|\([A-Za-z\s]+(?:et\sal\.)?,?\s*\d{4}\)|@citation|\b(?:Vaswani|Devlin|Brown|He)\set\sal\.)"
    )

    STOP_WORDS: ClassVar[set[str]] = {
        "this",
        "that",
        "these",
        "those",
        "their",
        "which",
        "there",
        "where",
        "about",
        "could",
        "would",
        "should",
    }

    def verify_claims(
        self, db: Session, project_id: str, request: ClaimVerificationRequest
    ) -> ClaimVerificationResponse:
        text = ""
        dismissed_set = set(request.dismissed_claim_ids or [])

        if request.document_id:
            doc = db.query(Document).filter(Document.id == request.document_id).first()
            if doc:
                text = doc.plain_text or ""
        elif request.text:
            text = request.text

        text = sanitize_surrogates(text)

        if not text.strip():
            return ClaimVerificationResponse(
                total_claims_analyzed=0,
                unsupported_claims_count=0,
                dismissed_claims_count=0,
                claims=[],
                confidence_scoring_status="deferred",
            )

        raw_sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", text)
            if sentence.strip()
        ]

        claims: list[ClaimFlagSchema] = []
        unsupported_count = 0
        dismissed_count = 0

        char_offset = 0
        for sent in raw_sentences:
            start_char = text.find(sent, char_offset)
            end_char = start_char + len(sent) if start_char != -1 else None
            if start_char != -1 and end_char is not None:
                char_offset = end_char

            if len(sent.split()) < 4 or sent.startswith("#") or sent.endswith(":"):
                continue

            sent_lower = sent.lower()
            is_potential_claim = any(marker in sent_lower for marker in self.CLAIM_MARKERS)

            if is_potential_claim:
                has_citation = bool(self.CITATION_PATTERN.search(sent))

                if not has_citation:
                    claim_id = hashlib.md5(sent.encode("utf-8")).hexdigest()[:12]
                    is_dismissed = claim_id in dismissed_set

                    words = [
                        w.strip(".,;:()\"'")
                        for w in sent.split()
                        if len(w) > 3 and w.lower() not in self.STOP_WORDS
                    ]
                    suggested_query = " ".join(words[:5])

                    flag = ClaimFlagSchema(
                        claim_id=claim_id,
                        text=sent,
                        flag_type="no_supporting_citation",
                        message="No supporting citation detected",
                        suggested_query=suggested_query,
                        start_char=start_char,
                        end_char=end_char,
                        is_dismissed=is_dismissed,
                    )
                    claims.append(flag)

                    if is_dismissed:
                        dismissed_count += 1
                    else:
                        unsupported_count += 1

        return ClaimVerificationResponse(
            total_claims_analyzed=len(claims),
            unsupported_claims_count=unsupported_count,
            dismissed_claims_count=dismissed_count,
            claims=claims,
            confidence_scoring_status="deferred",
        )


claim_verification_service = ClaimVerificationService()
