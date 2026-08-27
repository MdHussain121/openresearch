# Legal Review Checklist (Hosted Public Launch Blocker)

**Governing Section:** `OpenResearch_Spec.md` §34b, §35a, Roadmap 1.1

> [!WARNING]
> This checklist tracks mandatory legal review items that are **STRICT LAUNCH BLOCKERS** before any official multi-tenant hosted public SaaS offering of OpenResearch can be launched. Self-hosted instances operate under operator jurisdiction, but hosted services require full legal sign-off.

---

## Mandatory Pre-Launch Legal Reviews

- [ ] **Terms of Service (ToS)**:
  - Clear delineation of user-uploaded copyright liability.
  - Express warranty disclaimers regarding AI generation accuracy and academic citation validity.
  - Acceptable use policy prohibiting unlawful dissemination of copyrighted works.

- [ ] **Privacy Policy & GDPR/CCPA Compliance**:
  - Legal basis for data processing.
  - Explicit data sub-processor disclosures (for hosted LLM endpoints e.g. Anthropic/OpenAI).
  - Data Subject Access Request (DSAR) automation for export and deletion within the 30-day window (§34a).

- [ ] **AGPL-3.0 Compliance Audit**:
  - Verification that all network service modifications are published in compliance with AGPLv3 (§35a).
  - Clean separation between core AGPL network code and any client-side plugins/extensions.

- [ ] **Publisher Terms & DMCA Safe Harbor**:
  - Designated DMCA agent registration.
  - Takedown request handling workflow and notice-and-takedown procedure.
  - Confirmation that extracted snippet caching complies with scholarly indexing precedents.
