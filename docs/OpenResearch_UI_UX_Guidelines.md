# OpenResearch — UI/UX Guidelines

**Companion to:** `OpenResearch_Spec.md`
**Status:** v1 — binding for all UI work. Any deviation from this document should be a deliberate, written decision, not a drift.

---

## 0. How to Use This Document

This is not a mood board. Every rule here exists to protect one thing: **the researcher's trust that what OpenResearch shows them is real and traceable.** When a design decision is ambiguous, resolve it by asking:

> "Does this make it easier or harder for the user to tell what's verified, what's AI-generated, and where a claim came from?"

If a proposed design makes that harder — even if it looks cleaner — it's the wrong design.

---

## 1. Design Principles (in priority order)

1. **Trust is legible, not implied.** Source-grounded content, AI inference, and general-knowledge content must be *visually distinguishable at a glance*, not just distinguishable if you read carefully. See §5.
2. **Minimal, not empty.** "Low visual noise" (Spec §39) means removing decoration, not removing information the researcher needs to trust the output. A blank-looking screen that hides its sourcing is not minimal — it's evasive.
3. **Keyboard-first, mouse-optional.** Every core action (write, cite, accept/reject AI suggestion, navigate library) must have a keyboard path. See §9.
4. **Never block on AI.** The editor must remain fully usable — typing, saving, formatting — even if the AI service is down, slow, or disabled. AI is an assistant layered on the editor, never a gate in front of it.
5. **Show state, don't hide latency.** PDF processing, embeddings, and AI generation all take real time (Spec §41, §9). The UI must always show *which* stage something is in — never a bare spinner with no label.
6. **Academic, not corporate-SaaS.** Reference the calm density of a well-typeset paper, not the marketing gloss of a dashboard product. Whitespace should feel like margins on a page, not padding on a landing page.

---

## 2. Visual Identity

### 2.1 Overall Character

Notion's structural clarity + Google Docs' familiar editing feel + Zotero's information density where it matters (library, citations) + the restraint of a well-typeset academic paper. Avoid: gradients, drop shadows heavier than a 1px separation cue, illustration-heavy empty states, playful mascot-style icons, or anything that reads as "startup landing page."

### 2.2 Color System

Use CSS custom properties; never hard-code hex values in components.

**Light theme (default)**

| Token | Value | Use |
|---|---|---|
| `--bg-canvas` | `#FAFAF9` | App background |
| `--bg-surface` | `#FFFFFF` | Cards, panels, editor surface |
| `--bg-sunken` | `#F1F0EE` | Sidebar, library list background |
| `--text-primary` | `#1A1A18` | Body text — contrast ratio ≥ 7:1 on `--bg-surface` |
| `--text-secondary` | `#5C5B57` | Metadata, timestamps — contrast ratio ≥ 4.5:1 |
| `--text-tertiary` | `#8A8985` | Disabled, placeholder — decorative only, never load-bearing text |
| `--border-default` | `#E4E2DE` | Dividers, card borders |
| `--accent-primary` | `#2C5F4A` | Primary actions, links, active nav — deep academic green, not SaaS blue |
| `--accent-primary-hover` | `#234B3B` | |

**Dark theme**

| Token | Value | Use |
|---|---|---|
| `--bg-canvas` | `#17171A` | |
| `--bg-surface` | `#1E1E22` | |
| `--bg-sunken` | `#131315` | |
| `--text-primary` | `#EDECE9` | |
| `--text-secondary` | `#A6A4A0` | |
| `--border-default` | `#2C2C30` | |
| `--accent-primary` | `#5FA98A` | Lightened for AA contrast on dark surfaces |

**Semantic / trust colors — these carry meaning and must not be reused for anything else (§5 depends on this):**

| Token | Value (light / dark) | Meaning |
|---|---|---|
| `--source-grounded` | `#2C5F4A` / `#5FA98A` | Content backed by a retrieved passage |
| `--ai-inference` | `#8A5A2B` / `#C99A5F` | AI synthesis not directly attributable to one source (Spec §26a) |
| `--general-knowledge` | `#5C5B57` / `#A6A4A0` | Not source-grounded at all (Spec §33 Rule 4) |
| `--warning` | `#B4522A` / `#E08558` | Unsupported claim flags (Spec §25), extraction-confidence warnings (§11a) |
| `--danger` | `#B33A3A` / `#E06666` | Destructive actions only (delete project, delete paper) |
| `--success` | `#3A7D5C` / `#6BC79A` | Save confirmation, citation-correctness pass |

All semantic colors must be paired with an icon or label — **never color alone** (WCAG 1.4.1). See §5.2.

### 2.3 Typography

- **UI chrome (nav, buttons, labels):** a neutral grotesque sans — Inter or system-ui stack. 14px base.
- **Editor body text:** a literature-friendly serif or humanist sans, user-selectable, since researchers have different reading preferences for long-form drafting. Default: a serif (e.g. Source Serif 4) at 17px / 1.6 line-height — matches the reading comfort of a printed paper, distinct from the UI chrome so the *document* visually reads as separate from the *application*.
- **Code/monospace** (BibTeX, equations-as-text): JetBrains Mono or system monospace stack.
- **Type scale:** 12 / 14 / 16 / 17(editor body) / 20 / 24 / 32px. Do not introduce ad-hoc sizes outside this scale.
- **Never** set body text below 14px anywhere a researcher reads continuously (violates §48 accessibility baseline and general readability).

### 2.4 Spacing & Density

8px base grid. Two density modes, user-toggleable in Settings:
- **Comfortable** (default): 16px component padding, 12px list-item vertical rhythm — matches "low visual noise" in Spec §39.
- **Compact**: 8px padding, 8px rhythm — for the Research Library and Citations panel when a project has 100+ papers (Spec §41 performance target), where density aids scanning.

---

## 3. Layout

### 3.1 Global Shell

```
┌──────────────────────────────────────────────────────────┐
│  Logo   Project ▾            [Search everything]   Avatar │  ← 48px, --bg-surface
├───────────────┬──────────────────────────────────────────┤
│               │                                            │
│  Workspace    │                                            │
│  nav (220px)  │              Main content area             │
│  --bg-sunken  │              --bg-canvas                   │
│               │                                            │
└───────────────┴──────────────────────────────────────────┘
```

- **Top bar (48px fixed):** project switcher (left), global search (center — searches documents, papers, and citations in one box, per Spec §39's "low visual noise" goal of not needing three separate search boxes), account/settings (right).
- **Left nav (220px, collapsible to 56px icon rail):** Documents, Library, Citations, AI Chat, Settings — matches Spec §6/§39 structure exactly. Active item uses `--accent-primary` left-border indicator (2px), never a filled background block (too heavy for this density).
- **Main content area:** single-purpose per route. Never split into more than two panels at once (e.g. Editor + right-side Source Panel is the one sanctioned exception — see §3.2).

### 3.2 Editor Layout (the core screen)

```
┌───────────────┬────────────────────────────┬─────────────┐
│               │                             │             │
│  Left nav     │      Document Editor        │  Source     │
│  (collapsible)│      (max-width: 720px,     │  Panel      │
│               │       centered)              │  (320px,    │
│               │                             │  collapsible)│
└───────────────┴────────────────────────────┴─────────────┘
```

- **Editor column is capped at 720px** and centered, even on wide monitors — matches the "feels like a page, not a dashboard" principle (§2.1). Full-bleed text at 1600px wide is unreadable and is explicitly rejected.
- **Source Panel (right, 320px, collapsible via `Ctrl/Cmd + \`)** shows: the source(s) behind whatever the cursor is currently near (if AI-generated), the active citation search when `@` is triggered (Spec §14), and claim-verification flags (Spec §25) for the current paragraph. This is the single most important panel in the product — it's the physical embodiment of the "source traceability" differentiator (Spec §46) — and should never be the panel that gets removed to "simplify" the layout.
- **Collapsed state:** Source Panel collapses to a 32px rail with a badge count of unresolved flags (e.g. "2 unsupported claims"), so its information is never fully hidden, only minimized.

### 3.3 Library Layout

Card-list, not grid — academic papers are read as a list (matches Spec §11's mock: title, authors·year, action row). Each card:

```
┌──────────────────────────────────────────┐
│ Attention Is All You Need                 │
│ Vaswani et al. · 2017                     │
│ ● Extraction verified          [Open] [Chat] [Cite] │
└──────────────────────────────────────────┘
```

- The extraction-status dot (`● verified` in `--success`, `● unverified` in `--warning`, per Spec §11a) is **always visible on the card**, never hidden behind a click — it directly informs whether this paper's claims can be trusted for citation.
- Action buttons are always three, always in this order: Open, Chat, Cite — consistent order trains muscle memory across hundreds of cards.

---

## 4. Core Interaction Patterns

### 4.1 Citation Insertion (`@`)

1. User types `@` inside the editor → inline popover opens directly below the cursor (not a modal — never interrupt the writing flow with a full-screen takeover).
2. Popover shows a live-filtered list as the user continues typing, ranked by relevance to surrounding paragraph context (not just string match) — reuse the same relevance signal as AI autocomplete's context window (Spec §9).
3. Each result row shows: author/year, title (truncated to one line), and a small paper-icon indicating extraction status.
4. `↑/↓` to navigate, `Enter` to insert, `Esc` to cancel and delete the trailing `@`.
5. On insert: citation marker renders inline as a small superscript pill (not raw text like `[1]` while editing — the pill is clickable and hoverable), and the bibliography in the Source Panel updates immediately with a brief highlight animation (200ms) so the connection between action and result is visible.
6. Deleting a citation pill removes the bibliography entry automatically if unused elsewhere (Spec §16) — show a brief "Reference removed" toast, since silent removal of something that took an effort to insert feels unsafe.

### 4.2 AI Autocomplete (Ghost Text)

Per Spec §9's cost/latency strategy:

- **Ghost text** renders in `--text-tertiary`, inline, after the cursor — never bold, never a different font, so it reads unmistakably as "not yet committed" text.
- **Accept:** `Tab`. **Reject:** any other keystroke, or `Esc` to dismiss without typing over it. **Never auto-accept on pause.**
- If the suggestion is source-grounded, a small superscript source icon appears at the end of the ghost text *before* acceptance, so the user can preview traceability before committing to the sentence — clicking it (or hovering, desktop only) previews the source in the Source Panel without accepting the text.
- If the active provider can't meet the inline-latency budget (Spec §9), ghost text is disabled automatically and replaced with a subtle status indicator in the bottom status bar: "Inline suggestions off — provider latency" with a link to Settings. Never fail silently; the user should know why a feature they might expect isn't there.
- Explicit paragraph-level continuation (`Ctrl/Cmd + /`) opens a small floating card below the cursor with the suggestion and **Accept / Regenerate / Dismiss** — this is a deliberate action, so it gets a heavier, reviewable UI than ghost text.

### 4.3 Claim Verification Flags

- Sentences with zero supporting citation (Spec §25 v1 scope) get a subtle dotted underline in `--warning`, **not** a red squiggly (that's reserved for spellcheck and would create ambiguity).
- Hovering (or focusing via keyboard) shows a small popover: "No supporting citation detected" with a single action, **Find sources**, which opens the citation search (§4.1) pre-filled with the sentence as a query.
- This must be dismissible per-sentence ("Not a claim" / mark as intentional) without disabling the feature project-wide — over-triggering on non-factual sentences (e.g. transitions, opinions) is a real risk, and the escape hatch keeps the feature trustworthy rather than annoying.

### 4.4 Source Traceability Display (the core differentiator, Spec §46)

Every AI-generated sentence that is source-grounded, AI-inference, or general-knowledge (Spec §33 Rule 4, §26a) must carry a **visible, permanent** marker — not just a tooltip on hover, since hover-only information is invisible on a printout-style scan of the document and fails keyboard/screen-reader users.

- **Source-grounded clause:** small superscript numeral in `--source-grounded`, e.g. `¹`. Clicking/activating opens the Source Panel to the exact paper, page, and passage (Spec §26).
- **AI inference clause:** small superscript icon (e.g. a subtle "∿" or dot pattern, not a numeral, to avoid confusion with citation numbers) in `--ai-inference`, with a tooltip/panel entry reading "AI synthesis — not directly stated in a single source."
- **General knowledge:** no marker in the body text (would be too noisy for common knowledge), but the AI chat / autocomplete origin panel always labels its overall answer composition, e.g. a small legend: "3 source-grounded · 1 AI inference · 2 general knowledge" at the top of an AI response block.
- Multi-source clause-level attribution (Spec §26a) means a single sentence can carry more than one marker — this is intentional and must render cleanly (e.g. `...improves accuracy¹, though gains shrink on smaller datasets².`). Do not collapse multiple markers into one to "clean up" the sentence — that reintroduces the exact ambiguity §26a exists to prevent.

### 4.5 AI Chat Modes (Spec §13)

Mode selector is a persistent, always-visible segmented control at the top of the chat panel — **never a dropdown default that could go unnoticed** — because knowing which mode is active is a trust requirement, not a preference:

```
[ Document ] [ Library ] [ Project ] [ General ]
```

- `General` mode gets a persistent, non-dismissible banner above the input: "Not grounded in your sources" in `--general-knowledge` — this banner must be present on every message in that mode, not just the first, since users scroll past onboarding banners.
- Switching modes mid-conversation is allowed but must insert a visible system divider in the thread ("Switched to Library mode") so past and future answers aren't confused about their grounding.

### 4.6 PDF Reader

- Split view: PDF render (left) + extracted-text/AI panel (right), toggleable to PDF-only or text-only for narrow screens.
- Selection → floating toolbar: **Highlight · Note · Ask AI** (matches Spec §12). "Ask AI" opens a small inline thread anchored to that selection, not the main chat panel — keeps the question tied to its exact source location.
- If a page/section is flagged `unverified extraction` (Spec §11a), show a persistent small banner at the top of that page in the reader: "This section's extraction may be unreliable — verify against the original PDF" in `--warning`. This is not optional chrome; it's the UI honoring Spec §33 Rule 3's "insufficient evidence" principle at the source level, not just the answer level.

---

## 5. Trust & Transparency Visual System (summary reference)

This section exists so any contributor can implement §4.4 correctly without re-deriving it.

### 5.1 The Three States, Always Rendered the Same Way

| State | Color token | Marker shape | Never use for |
|---|---|---|---|
| Source-grounded | `--source-grounded` | Numeral superscript | Anything AI-inferred |
| AI inference | `--ai-inference` | Non-numeral superscript (∿ or dot) | Anything directly quoted from a source |
| General knowledge | `--general-knowledge` | No inline marker; block-level label only | Anything with a retrievable source |

### 5.2 Color Is Never the Only Signal

Every semantic color in §2.2 must ship with a redundant non-color cue: an icon, a label, an underline style, or a shape — because color-blind users and any black-and-white export/print path must not lose meaning. When exporting to PDF/DOCX (Spec §27), footnote-style markers preserve this distinction in print form.

---

## 6. States (Loading, Empty, Error)

Never show a bare spinner. Always pair with a label describing the actual stage.

### 6.1 PDF Processing (Spec §41 pipeline)

Render as a stepped progress indicator, not a percentage bar (the stages aren't linear-time-uniform):

```
Upload PDF ✓ → Extracting text ⋯ → Generating embeddings ○ → Ready ○
```

Each step: checkmark (done), spinner (active), empty circle (pending). If extraction hits low confidence (§11a), the step still completes but shows a small warning badge next to "Extracting text" rather than blocking the pipeline.

### 6.2 AI Generation

- Chat: standard streaming response with a subtle "thinking" indicator before first token, never longer than ~1.5s without any feedback.
- Autocomplete: see §4.2 — silent disable with status-bar note, never an infinite spinner in the editor itself (that would block typing flow, violating Principle 4 in §1).

### 6.3 Empty States

- **Empty library:** short instruction + primary action ("Upload your first paper"), no illustration — a large icon in `--text-tertiary` is enough. Avoid cutesy empty-state art; it undercuts the academic tone (§2.1).
- **Empty citation search results:** "No matches in your library. [Search external sources →]" — always offer the next action, never a dead end.
- **No AI provider configured:** the AI Chat and autocomplete surfaces show a clear inline prompt to configure one in Settings (Spec §28), rather than failing silently or showing an unexplained disabled button.

### 6.4 Errors

- Inline, next to the affected control — never a generic top-of-page red banner for a localized failure (e.g. one paper failing to extract shouldn't flag the whole library).
- Always actionable: "Retry," "View details," or "Report issue" — never an error message with no next step.
- Destructive-action errors (failed delete, failed export) get a toast + persistent state until acknowledged, since silently failing a delete could mislead the user into thinking data is gone when it isn't (or vice versa).

---

## 7. Component Notes

- **Buttons:** three tiers only — Primary (`--accent-primary` fill), Secondary (outline), Ghost (text-only). No more than one Primary button visible in any single view at once — enforces a clear "main action" per screen.
- **Citation pill:** rounded-full, 2px vertical padding, uses `--source-grounded` text on a tinted background of the same token at 10% opacity. Hover reveals full citation on desktop; tap-to-preview on touch/narrow viewports.
- **Toasts:** bottom-center, auto-dismiss at 4s except destructive-action confirmations, which persist until dismissed.
- **Modals:** reserved for genuinely blocking, infrequent actions only (delete project, export settings). Never use a modal for citation search or AI suggestions — those must stay inline per §4.1/§4.2 to preserve writing flow.

---

## 8. Accessibility (binding — see Spec §48 for the full requirement)

- **Target: WCAG 2.1 AA**, verified per release, not just at launch.
- All color pairs in §2.2 are pre-checked to ≥ 4.5:1 (body text) / ≥ 3:1 (large text, UI components). Any new color addition must be checked before merging, not after.
- Every interactive element in §4 (citation popover, ghost text, claim flags, source markers, chat mode selector) must be reachable and operable via keyboard alone, with visible focus rings (`2px solid --accent-primary`, never `outline: none` without a replacement).
- Screen reader announcements: AI-generated ghost text must be announced as a suggestion, not silently inserted into the accessibility tree as committed text; citation markers must announce their full reference, not just a bare number.
- Motion: all transitions (citation-insert highlight, panel collapse, toast entry) must respect `prefers-reduced-motion` and fall back to instant state changes.

---

## 9. Keyboard Shortcuts (canonical list — extends Spec §40)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + Z` / `Shift+Z` | Undo / Redo |
| `Ctrl/Cmd + F` | Find in document |
| `Ctrl/Cmd + /` | Request AI paragraph continuation (§4.2) |
| `@` | Open citation search (§4.1) |
| `Tab` | Accept ghost-text suggestion |
| `Esc` | Dismiss ghost text / close popover, in that priority order |
| `Ctrl/Cmd + \` | Toggle Source Panel |
| `Ctrl/Cmd + K` | Global search (top bar) |
| `Ctrl/Cmd + Shift + C` | Open AI Chat panel |
| `↑ / ↓` then `Enter` | Navigate and confirm in any popover list (citation search, mode selector) |

All shortcuts must be listed in a discoverable in-app shortcut sheet (`?` key), since undiscoverable shortcuts don't deliver the "keyboard-friendly" principle in practice.

---

## 10. Responsive Behavior

Per Spec §4 non-goals, native mobile apps are out of scope for v1 — but the web app must still degrade gracefully on a narrow browser window (tablet, split-screen desktop):

- **< 1024px:** Source Panel auto-collapses to the rail state (§3.2); reopens as an overlay on demand rather than pushing the editor column narrower than ~560px.
- **< 768px:** Left nav collapses to icon rail by default; top bar search collapses to an icon that expands on tap.
- **Editor never drops below 320px effective width** — below that, prioritize legibility over showing every panel; stack Source Panel content into a bottom sheet instead of a side column.

---

## 11. What This Document Does Not Cover

- Pixel-level component specs (spacing tokens beyond §2.4, exact border-radius values) — belongs in a design-tokens file maintained alongside the component library in `packages/editor` and `packages/citations` (Spec §35).
- Native mobile UI — explicitly out of scope until mobile apps are prioritized (Spec §4 non-goals).
- Marketing site design — this document governs the product application only.

When in doubt, re-read §0.
