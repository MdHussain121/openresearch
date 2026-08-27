# OpenResearch — UI/UX Design-System Audit (`ui-ux-pro-max` methodology, code-level)

**Audit date:** 2026-08-26
**Auditor:** ox-alpha (read-only code-level design audit; no screenshots, no file modifications)
**Scope:** `apps/web/src/{app,components,context,i18n,lib}`, `packages/tokens`, `packages/ui`, `packages/editor` (UI-facing parts), audited **against** `docs/OpenResearch_UI_UX_Guidelines.md` (v1, "binding") and `docs/VPAT_CONFORMANCE_STATEMENT.md` (WCAG 2.1 AA claims).
**Stack detected:** Next.js 16 App Router + React 19 + Tailwind CSS 3.4 (`tailwindcss`/`postcss` v3-style config) + Radix primitives (`@openresearch/ui`) + Tiptap editor + lucide-react icons. Methodology applied per the `ui-ux-pro-max` skill priority order: Accessibility → Touch & Interaction → Layout/Responsive → Typography & Color → Animation → Forms & Feedback → Navigation → Trust/AI-specific UX.

---

## Scope & Methodology

| Step | Activity |
|---|---|
| 1 | Loaded `ui-ux-pro-max` skill; applied its priority-ordered rule categories (P1 Accessibility, P2 Touch/Interaction, P5 Layout/Responsive, P6 Typography/Color, P7 Animation, P8 Forms & Feedback, P9 Navigation) as a **source-code** audit. |
| 2 | Inventoried the design-token pipeline: `packages/tokens/src/tokens.css` → `@import` in `globals.css` → Tailwind theme mapping in `apps/web/tailwind.config.js`. Cross-checked against the second token source `packages/tokens/src/index.ts`. |
| 3 | Read every shell component (`TopBar`, `LeftNavigation`, `WorkspaceLayout`, `SourcePanel`, `ViewHeader`, `ModalContainer`, `AIWritingFloatingOverlay`), both AI writing cards, all five Tiptap extensions, the citation popover/toolbar, chat, library, reader, settings, comments, shortcuts modal, global-search modal, confirm dialog, and the two governing docs. |
| 4 | Mechanical quantification via ripgrep: arbitrary font-size utilities, hardcoded palette classes, hex literals, `focus-visible` density, `aria-label` density, `aria-live`/`prefers-reduced-motion` presence, dead utilities (`py-0.2`), undefined CSS variables. |
| 5 | WCAG contrast ratios **computed mathematically** (relative-luminance formula) for all key light/dark token pairs, including white-on-accent button fills in both themes. |
| 6 | Every finding mapped to the two governing documents to produce the Guidelines/VPAT conformance tables. |

**Ignored as instructed:** `node_modules`, `.next`, caches, coverage.

---

## Design-System Inventory (tokens found vs hardcoded values, counts)

### Token sources found

| Source | Contents | Status |
|---|---|---|
| `packages/tokens/src/tokens.css` | 8 background/text/border/accent tokens (light + dark), 6 semantic/trust tokens (light + dark), spacing grid vars (`--space-unit`, `--spacing-component-padding`, `--spacing-list-rhythm`), layout dims (`--topbar-height`, `--sidebar-width`, `--editor-max-width`, `--source-panel-width`, …), 7-step type scale (`--font-size-12…32`), `[data-density="compact"]` override | Imported by `globals.css:1`. **Layout + type-scale vars almost entirely unconsumed** (see findings). |
| `apps/web/tailwind.config.js` | Colors mapped to CSS vars (`canvas`, `surface`, `sunken`, `text-*`, `border-default`, `accent`, `trust-*`), font families via `--font-sans/serif/mono`, `maxWidth.editor=720px`, `width.sidebar/source-panel`, `height.topbar=48px` | Good architecture. Note: `height.topbar` utility (`h-topbar`) exists but is never used; components reach for raw `var()` instead. |
| `packages/tokens/src/index.ts` | A **duplicate** hard-coded hex copy of the same palette exported as TS objects | Drifted from `tokens.css`: light `textTertiary #8A8985` vs css `#706F6A`; dark `textTertiary #6E6D68` vs css `#918F8A`. |
| `docs/OpenResearch_UI_UX_Guidelines.md` §2.2 | Canonical hex table | Doc itself still lists failing tertiary `#8A8985` (see M3). |

### Quantified discipline metrics

| Metric | Count | Verdict |
|---|---|---|
| Arbitrary `text-[Npx]` utilities across app+editor+ui | **219 total**: 9px ×7, 10px ×75, 11px ×133, 14px ×1, 15px ×2, 17px ×1 | **215/219 (98%) fall below the documented 12px scale floor** (§2.3 scale is 12/14/16/17/20/24/32). The documented `--font-size-*` vars are consumed nowhere. |
| Hardcoded Tailwind palette classes (`text-blue-600`, `bg-trust-*` excluded) | **84 occurrences in 12 files** (worst: `EditorToolbar.tsx` 8, `AIEditReviewCard.tsx` 8, `PaperReviewView.tsx` 5, `AiResearchChat.tsx` 3, `ShortcutsModal.tsx` 3, `PdfReader.tsx` 4, `CommentsPanel.tsx` 2 incl. `green-600`/`red-500`) | Violates §2.2 "never hard-code hex values in components" in spirit; these bypass theming and dark-mode token guarantees. |
| Raw hex literals in components | 6 in `intelligence/ResearchGraphView.tsx` (SVG fills `#2C5F4A`, `#E4E2DE`, `#8A8985`, plus non-token `#3B82F6`, `#D97706`) | Direct §2.2 violation. |
| Dead/invalid utility `py-0.2` (not in Tailwind spacing scale → renders nothing) | 9 occurrences in 5 files (`LeftNavigation`, `SourcePanel`, `ResearchLibrary`, `AIEditReviewCard`, `CitationsManager`) | Silent layout bugs. |
| Undefined CSS variable consumed | `var(--header-height)` at `TopBar.tsx:57` (tokens define `--topbar-height`, not `--header-height`) | Top bar height collapses to content height — §3.1's "48px fixed" is not actually enforced. |
| Spacing tokens (`--spacing-component-padding`, `--spacing-list-rhythm`) consumed by any component | **0 usages** | `[data-density]` compact mode is a no-op. |
| `focus-visible:` usages | 249 (healthy overall) | Gaps enumerated in a11y section. |
| `aria-label=` usages | **25 total** across the whole frontend | Far below what the icon-button population requires. |
| `aria-live` / `role="status"` regions | 3 (`WorkspaceLayout` SR region, chat `role="log"` + `aria-live="polite"`, chat mode-toast `role="status"`) | Partial. |
| `prefers-reduced-motion` handling | **0 matches repo-wide** | §8 requirement unmet. |
| Skip link | **None** | VPAT 2.4.1 claim contradicted. |
| Shared primitives in `packages/ui` | Button (6 variants × 5 sizes), Badge (10 variants), Tabs, Select, Popover, Dialog (+Header/Footer/Title/Description), Tooltip, DropdownMenu, `cn()` | Real library exists — but app code frequently hand-rolls parallel button styles (see Component section). |

---

## Executive Summary

The skeleton of a genuinely well-conceived academic design system is present and often exemplary (720px editor column, stepped PDF pipeline progress, trust legend, ghost-text grounding preview, persistent general-mode warning). However, execution diverges from the two binding documents in ways that are measurable and, in four areas, trust-breaking or conformance-invalidating.

**Severity counts:**

| Severity | Findings |
|---|---|
| **CRITICAL** | **4** |
| **HIGH** | **12** |
| **MEDIUM** | **14** |
| **LOW** | **8** |
| INFO / positive | 14 (see Positive Observations) |

**Headline risks:**
1. **Dark theme fails WCAG AA on every primary action** — white text on the dark-theme accent (`#5FA98A`) computes to **2.79:1** across **51 button/bubble instances** (VPAT §1.4.3 "Supports" is not currently true).
2. **VPAT claims that are false in code:** skip link (2.4.1), 100% keyboard operability (2.1.1), explicit form labels (3.3.2), non-text contrast (1.4.11), ghost-text announcements (4.1.3).
3. **Typography scale has effectively collapsed** — 98% of font sizes are ad-hoc 9–11px utilities; the documented scale and its CSS variables are unused.
4. **"Accept & Insert" on AI continuation edits only `plain_text`, never the live Tiptap document** — the accepted text may not appear in the editor the user is looking at, violating the product's own first principle ("Trust is legible").

---

## Detailed Findings by Area

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🔵 LOW

---

### A. Typography

#### 🔴 A1 [HIGH→ escalated CRITICAL-adjacent; recorded as HIGH] Type scale abandoned: 215 of 219 font sizes are off-scale 9–11px
- **Guideline:** §2.3 — "Type scale: 12 / 14 / 16 / 17(editor body) / 20 / 24 / 32px. Do not introduce ad-hoc sizes outside this scale." And: "Never set body text below 14px anywhere a researcher reads continuously."
- **Evidence (counts):** `text-[9px]` ×7, `text-[10px]` ×75, `text-[11px]` ×133. Examples:
  - `AiResearchChat.tsx:461` — chat assistant answer body is `text-xs` (12px) with metadata at `text-[10px]`; source passages users must evaluate read at `text-[11px]` (`AiResearchChat.tsx:558`).
  - `SourcePanel.tsx:397` — **bibliography entries** (content researchers copy into papers) render at `text-[11px]`.
  - `LeftNavigation.tsx:93,98` — nav badges at `text-[10px]` and `text-[9px]`.
  - `PdfReader.tsx:494` — extracted paper text preview `text-[11px]`.
- The seven `--font-size-*` variables in `tokens.css:42-48` have **zero consumers**.
- **Fix:** Map Tailwind fontSize keys to the scale (`xs:12px, sm:14px, base:16px, editor:17px, lg:20px, xl:24px, '2xl':32px`) and codemod `text-[10px]/[11px]` → `text-xs`; reserve sub-12px exclusively for uppercase micro-labels if unavoidable, and add a lint rule banning new `text-[Npx]`.

#### 🟠 A2 Editor typography correct — everything around it is not
- `AcademicEditor.tsx:218`: `font-serif text-[17px] leading-[1.6]` exactly implements §2.3's editor spec (✔). But the surrounding chrome sits at 12px with 10–11px secondary text, so the intended hierarchy "document ≠ application" is achieved only inside the canvas; panels meant for scholarly evaluation (bibliography, passages, claims) drop to 10–11px serif/sans mixes.
- **Fix:** Establish a minimum 12px floor for *interactive/decision-support* text and 14px for continuous reading surfaces (chat answers, reader text mode already at `text-sm` ✔).

#### 🟡 A3 Font stack fallback drift between CSS and Tailwind config
- `globals.css:11` sets body font directly to `Inter, system-ui…` (bypassing `var(--font-sans)`), while `tailwind.config.js:36` correctly chains `var(--font-sans)` first. Elements using `font-sans` get next/font self-hosted Inter; anything inheriting body gets CDN-less system resolution — subtle metric differences.
- **Fix:** Body should be `font-family: var(--font-sans), Inter, system-ui, sans-serif;`.

---

### B. Color System

#### 🔴 B1 [CRITICAL] Dark theme: white-on-accent fills compute to 2.79:1 — systemic AA failure
- **Computed:** `#FFFFFF` on `--accent-primary(dark) #5FA98A` = **2.79:1** (needs 4.5:1). Light theme same pairing = 7.39:1 ✔ — the failure is exclusive to dark mode, which is precisely why it survives review.
- **Reach:** **51 occurrences in 28 files** of `bg-accent text-white` (or `/90` variants): primary Button variant (`packages/ui/src/button.tsx:11`), chat user bubble (`AiResearchChat.tsx:460`), send button (`AiResearchChat.tsx:603`), upload buttons (`ResearchLibrary.tsx:343,374`), "Find sources" (`ClaimVerificationInspector.tsx:169`), Source Panel jump-to-reader (`SourcePanel.tsx:261`), plus all primary modals' submit buttons. User-bubble timestamps compound it: `text-white/70` on accent ≈ 1.9:1 (`AiResearchChat.tsx:462`).
- **Why it happened:** The dark accent was lightened "for AA contrast on dark surfaces" (§2.2) — true for accent-as-text (5.96:1 on `#1E1E22` ✔) — but nobody re-checked white text *on* the lightened fill.
- **Fix (choose one, apply globally):**
  1. Dark-theme primary buttons use `text-[#101512]`-style near-black ink on the lightened accent (computes ≈ 6+:1), e.g. add `dark:text-canvas` to the Button `default`/`destructive` variants;
  2. Or introduce `--accent-solid-bg`/`--accent-solid-fg` token pairs per theme and map Button/Badge to them.
  Add an automated axe/contrast CI gate so this cannot regress silently.

#### 🟠 B2 White-on-danger in dark theme = 3.35:1
- `Button` destructive variant (`button.tsx:12`) → `#FFFFFF` on `#E06666` = **3.35:1** (fails 4.5:1 for the 12px button text). Same fix pattern as B1.

#### 🟡 B3 Two competing token sources have drifted (one fails contrast)
- `packages/tokens/src/index.ts:13,30` exports dark `textTertiary: '#6E6D68'` (**3.20:1** on `#1E1E22` — would fail if consumed) while `tokens.css:59` uses `#918F8A` (4.85:1 ✔). Light tertiary likewise differs (`#8A8985` vs `#706F6A`). Nothing currently imports the TS palette for styles, so today this is latent — but it is a trap.
- **Fix:** Make `index.ts` re-export/parse from the CSS file (or generate it) so there is exactly one source of truth.

#### 🟡 B4 The guideline document itself still specifies a failing color
- §2.2 light `--text-tertiary #8A8985` computes to **3.50:1** on `#FFFFFF` — the implementers knew: `tokens.css:14` quietly corrected it to `#706F6A` (5.03:1 ✔). The binding doc and the code now disagree, and the doc's own rule (§2.2 "pre-checked to ≥ 4.5:1") is violated by its own table.
- **Fix:** Update the doc table to `#706F6A` (light) and record the change per §0 ("deliberate, written decision").
- Related: `#706F6A` on `--bg-sunken #F1F0EE` = **4.42:1** — tertiary is used for placeholder/disabled only (exempt-ish), but verify no load-bearing tertiary-on-sunken text ships (kbd hints in `GlobalSearchModal` footer sit on `bg-sunken` at `text-text-tertiary text-[11px]` — borderline).

#### 🟡 B5 Form-field boundaries fail WCAG 1.4.11 non-text contrast
- Inputs across Settings/Library/Search use `border border-border-default` (`#E4E2DE`) on `bg-surface`/`bg-sunken`: computed **1.29:1 / ~1.19:1**, far below the 3:1 required when the boundary identifies the control (most of these fields sit on the same-color surface, so the border *is* the identifier). VPAT §1.4.11 "Supports" is therefore overstated for form controls.
- **Fix:** Give inputs a darker resting border token (e.g. mix `--text-secondary` at ~35%: ≥3:1) or a visible fill delta ≥3:1 plus the existing `focus:border-accent`.

#### 🟡 B6 Hardcoded palette classes bypass the semantic system (84×)
- `EditorToolbar.tsx:107-114` + `AIEditReviewCard.tsx:41-48`: nine AI-action icon hues (`blue-600`, `amber-600`, `purple-600`, `emerald-600`, `sky-600`, `cyan-600`, `indigo-600`, `pink-600` + `dark:` twins) exist nowhere in §2.2; `CommentsPanel.tsx:245,253` uses `green-600`/`red-500` where `trust-success`/`trust-danger` exist; `AiResearchChat.tsx:425-441` chips use `amber/blue/sky-600`; `ShortcutsModal.tsx:37,46,55` repeats the pattern.
- Consequences: unthemable, off-palette in both themes, and §5.2's "redundant non-color cue" obligation is unmet for these hue-coded meanings (the AI-action colors encode nothing — pure decoration, which §2.1 explicitly discourages).
- **Fix:** Decorative variety → use opacity/tint of `accent` or neutralize; meaningful states → `trust-*` tokens only. Add ESLint restriction (e.g. `no-restricted-syntax` on `-(blue|sky|…)-[0-9]+` class strings).

#### 🔵 B7 Raw hex SVG fills in graph view
- `ResearchGraphView.tsx:280,300,315-317,330` — node/stroke colors inline, including non-token `#3B82F6`/`#D97706`; node *type* is encoded by color alone (author=blue, topic=amber) — see also M12.
- **Fix:** Read `getComputedStyle` token values or use CSS `fill: var(--accent-primary)` classes; add a shape/label differentiator per node type.

#### ✅ Contrast results that PASS (verified, for the record)
| Pair | Ratio | Status |
|---|---|---|
| `#1A1A18` on `#FFFFFF` | **17.43:1** | ✔ AAA (VPAT cites 15.8 — understated but direction-safe) |
| `#EDECE9` on `#1E1E22` | **14.06:1** | ✔ AAA (VPAT cites 12.4) |
| text-secondary on surface/canvas (both themes) | 6.68–7.19:1 | ✔ |
| accent as text on surfaces (both themes) | 7.39 / 5.96:1 | ✔ |
| trust-warning / danger / success / ai-inference as text (per theme) | 4.92–8.12:1 | ✔ |
| Focus ring `ring-accent` on all surfaces | 5.96–7.39:1 | ✔ exceeds 3:1 (VPAT 1.4.11 true *for focus rings*, not for field borders — see B5) |

---

### C. Spacing / Layout / Responsive

#### 🟠 C1 Top bar height token is undefined — "48px fixed" is fiction
- `TopBar.tsx:57`: `className="h-[var(--header-height)] …"` — grep confirms `--header-height` is defined **nowhere**; tokens define `--topbar-height: 48px` (`tokens.css:34`) and Tailwind even ships an unused `h-topbar` utility. Result: the header auto-sizes to its tallest child, breaking §3.1's fixed-48px contract and the vertical rhythm of every route.
- **Fix:** `h-topbar` (or fix the var name). One-line change; add a stylelint/CSS-var existence check.

#### 🟠 C2 Density toggle (§2.4) is wired to nothing
- `SettingsView.tsx:543-554` exposes Comfortable/Compact; `WorkspaceContext.tsx:361-368` sets `data-density` on `<html>`; `tokens.css:74-78` swaps `--spacing-component-padding`/`--spacing-list-rhythm`. **Grep shows zero components consume either variable** — every padding is a literal Tailwind class (`p-4`, `py-1.5`, `px-3`).
- Additional gaps vs §2.4: density choice is not persisted (theme is, via localStorage — `WorkspaceContext.tsx:351-357`; density isn't).
- **Fix:** Either consume the vars in list rows/cards (`padding: var(--spacing-component-padding)`) or remove the toggle until real. Persist to localStorage alongside theme.

#### 🟡 C3 Responsive behavior partially implements §10 — overlay requirement missed
- Implemented ✔: auto-collapse sidebar <768px and source panel <1024px at mount+resize (`WorkspaceLayout.tsx:40-55`); editor centered at `max-w-[var(--editor-max-width)]` (`DocumentsView.tsx:96`); chat/modals constrain width (`max-w-4xl`, `max-w-lg`).
- Deviations: (a) reopening the Source Panel below 1024px **pushes** the main column instead of opening as an overlay ("reopens as an overlay on demand rather than pushing the editor column narrower than ~560px"); (b) the "stack Source Panel into a bottom sheet below 320px editor width" fallback does not exist; (c) the resize listener only ever collapses — widening the window never restores panels; (d) `w-screen` on the root (`WorkspaceLayout.tsx:88`) can force horizontal overflow when a vertical scrollbar is present (100vw includes scrollbar width).
- **Fix:** Overlay positioning (`absolute right-0 inset-y-0 z-40`) under a `lg:` breakpoint; restore states above breakpoints; replace `w-screen` with `w-full`.

#### 🟡 C4 Touch/pointer targets below guidance across dense chrome
- Skill P2 target: 44×44px (min WCAG 2.2 2.5.8 = 24px). Measured: toolbar buttons `min-h-[30px] min-w-[30px]` (`EditorToolbar.tsx` throughout), icon buttons `p-1`/`p-1.5` with 16px glyphs ⇒ ~26–28px (`SourcePanel.tsx:146,184-191`, `LeftNavigation.tsx:116-120,141-144`), library delete `p-1.5` ⇒ ~28px (`ResearchLibrary.tsx:494`), toast close ~20px (`WorkspaceLayout.tsx:184`).
- Desktop-first mitigates, but tablet split-screen (explicitly in scope per §10) hits these.
- **Fix:** Raise interactive minimums to 40–44px via padded hit areas (`before:absolute before:-inset-1`) without visual growth.

#### 🔵 C5 Scrollbar styling WebKit-only
- `globals.css:18-34` — Firefox users get default scrollbars; cosmetic inconsistency with "academic restraint."
- **Fix:** Add `scrollbar-width: thin; scrollbar-color: var(--border-default) var(--bg-sunken);`.

---

### D. Component Consistency

#### 🟡 D1 Parallel button implementations fragment the variant system
- `packages/ui` Button defines canonical tiers (§7 wants three; the lib ships six — `default/destructive/outline/secondary/ghost/link`, an acceptable superset). But app code hand-rolls dozens of look-alikes with divergent metrics: Source Panel CTA `py-1.5 px-2.5 … bg-accent text-white` (`SourcePanel.tsx:261`), chat send `p-2 rounded-md bg-accent` (`AiResearchChat.tsx:603`), upload `px-3.5 py-1.5` (`ResearchLibrary.tsx:343`), toolbar actions `min-h-[30px] px-2 py-1` (`EditorToolbar.tsx:126,163`), settings saves `px-3 py-1.5` (`SettingsView.tsx:356,504`). Heights in production today: 28 / 30 / 32 / 36px.
- **Fix:** Codemod hand-rolled CTAs onto `<Button size variant>`; extend cva with the two missing sizes rather than restyling locally. Enforce §7's "≤1 Primary per view" — currently violable, e.g. `DocumentsView.tsx:109-157` header row shows an accent-filled *Comments* toggle (when open) beside accent-tinted Export/Claims buttons.

#### 🟡 D2 Dialog system is good — ConfirmDialog aims focus at the wrong button
- Radix Dialog provides focus trap + Escape + return-focus (supports VPAT 2.1.2 ✔; `sr-only` Close label ✔ `dialog.tsx:46`).
- `ConfirmDialog.tsx:54-61`: `autoFocus` sits on the **confirm/destructive** button. Best practice (and safer for accidental-Enter): focus **Cancel** for destructive intents.
- **Fix:** Move `autoFocus` to Cancel when `destructive`.

#### 🟡 D3 Toast system deviates from §7 on five axes
- Spec: bottom-center, 4s auto-dismiss, destructive toasts persist. Reality (`WorkspaceLayout.tsx:180-188`, `DocumentContext.tsx:439-461`): positioned `bottom-6 right-6`; 3s timer; close via a bare `✕` **text glyph** (icon-by-character anti-pattern) with no `aria-label`; the toast container has **no** `role="status"`/`aria-live` (only the separate SR region announces select events); message strings are hardcoded English ("Citation inserted & bibliography updated") bypassing `strings.json`.
- **Fix:** Central `<Toast/>` primitive: bottom-center, role=status, labelled IconButton, 4s, i18n keys.

#### 🔵 D4 Citation pill misses §7 styling details
- Spec: `rounded-full`, tinted background at 10% of the grounded token. Code (`citation.ts:143`): `rounded` (4px), `bg-accent/10` — accent green instead of `--source-grounded` (same value today, wrong token semantically), plus the dead `py-0.2` class (renders as no padding; spec says 2px vertical).
- **Fix:** `rounded-full py-0.5 bg-trust-grounded/10 border-trust-grounded/30 text-trust-grounded`.

#### ✅ D5 Positive: shared primitives consistently themed
Every Radix wrapper in `packages/ui` maps to tokens (no grays), includes `focus-visible:ring-2 ring-accent ring-offset-1` on triggers/tabs/select, disabled treatments, and portal animations. This is the right backbone — the gap is adoption, not architecture.

---

### E. Interaction Patterns

#### 🔴 E1 [CRITICAL] "Accept & Insert" never touches the live editor document
- `WorkspaceContext.tsx:474-483` (`handleAcceptContinuation`) and `:568-577` (`handleAcceptEdit`) mutate **only** `activeDocument.plain_text` (`current.replace(...)` / string append). The Tiptap instance renders from `content_json` and only syncs *from* `initialContent` when unfocused-and-different (`AcademicEditor.tsx:479-487`); `updateActiveDocument({plain_text})` alone will not repaint the cursor's document. Net UX: user reviews an AI continuation, clicks **Accept & Insert**, the card closes, an SR announcement says "inserted," and the visible document may not contain the text (and `plain_text`/`content_json` silently fork). For edit-review, `String.replace(original, suggested)` also replaces only the *first* occurrence and misbehaves on `$`-patterns.
- This violates product Principle 1 ("Trust is legible") more than any styling issue: an affirmative AI acceptance appears to do nothing.
- **Fix:** Route both accepts through ProseMirror commands (`editor.commands.insertContent` / a replace-range transaction) via a handler passed down from `DocumentsView`, mirroring how `onCitationInserted` already flows; keep `plain_text` derived, not authoritative.

#### 🟠 E2 Keyboard shortcut sheet advertises a shortcut that doesn't exist (Ctrl+F)
- §9 canonical list + `ShortcutsModal.tsx:31` list `Ctrl/Cmd + F — Find in document`. Repo-wide grep for a Ctrl+F handler finds **none** (the editor adds only Ctrl+S at `AcademicEditor.tsx:455-466` and Ctrl+/ at `:222`; global handler covers K/E/Shift+C/\/? — `WorkspaceLayout.tsx:58-84`). Browser-native find will hijack the key instead. VPAT 2.1.1's "shortcuts available for all core tasks" inherits this falsehood.
- **Fix:** Implement find-in-document (reader already has `inDocQuery` infrastructure to reuse) or remove the row until shipped.

#### 🟠 E3 Mode switching inserts a transient popup, not the mandated thread divider
- §4.5: "Switching modes mid-conversation … must insert a visible system divider **in the thread**." Implementation (`AiResearchChat.tsx:109-124,238-249`): a 2-second center-screen pill that vanishes; scrolling back later shows **no record** of which mode answered which message (mode is stored per-message but never rendered as a divider).
- **Fix:** Render `msg.mode` as a persistent divider row whenever it differs from the previous message's mode; keep the toast as a bonus, not the substitute.

#### 🟠 E4 Error UX violates §6.4 in three distinct patterns
1. **Blocking browser dialogs:** `alert()` in `ResearchLibrary.tsx:86` (invalid PDF), `IntelligenceView.tsx:38` and `OnlineSearchPanel.tsx:103` (add-paper failures). Not stylable, not screen-reader-friendly contextually, halts the event loop.
2. **Silent swallowing:** `CommentsPanel.tsx:46,68,83,95,103` log `console.warn` only — failed comment post/delete/resolve gives the user zero feedback; `DocumentContext`/`ProjectContext` similarly swallow (7 + 3 sites).
3. **Errors rendered as content without affordance:** chat failures become assistant text `"Error generating research answer: …"` (`AiResearchChat.tsx:197,208`) — no error styling, no Retry button (§6.4: "Always actionable"). Same for continuation-card failures (`WorkspaceContext.tsx:465` sets the error as `continuationText`).
- **Fix:** Adopt the existing toast primitive for transient failures + inline retry where contextual (chat message error variant with "Retry" re-invoking `handleSendMessage`); ban `alert(` via lint.

#### 🟡 E5 Destructive-action confirmation is inconsistently applied
- Protected ✔: document delete (`LeftNavigation.tsx:153-164`), paper delete (`ResearchLibrary.tsx:510-521`) — both route through `ConfirmDialog`.
- Unprotected ✖: comment-thread delete (`CommentsPanel.tsx:251-257`, instant), provider "Remove Key" (`SettingsView.tsx:509-514`), table delete in toolbar dropdown (`EditorToolbar.tsx:563-571`).
- **Fix:** Route all through `ConfirmDialog destructive` (which then needs D2's focus fix).

#### 🟡 E6 Ghost-text badge injects unstrusted strings via `innerHTML`
- `ghostText.ts:57`: ``badge.innerHTML = `<svg …><span>${topSource.authors || 'Source'}</span>`` — author metadata originates from ingested PDFs/Zotero; a crafted author string becomes HTML injection inside the editor DOM.
- **Fix:** Build the text node via `document.createElement`/`textContent` (keep the static SVG string, append a span with `.textContent = authors`).

#### 🔵 E7 Optimistic feedback is pleasant where present
- Cite button flips to "Copied!" with clipboard write (`ResearchLibrary.tsx:101-112`) ✔; bibliography recently-added highlight animation implements §4.1(5) (`SourcePanel.tsx:372-380`) ✔; save status triad saving/saved/offline in `TopBar.tsx:152-174` ✔. Minor: statuses are hardcoded English and the offline case pairs icon+text correctly.

---

### F. Accessibility Deep-Dive (vs VPAT)

#### 🔴 F1 [CRITICAL] VPAT 2.4.1 claims a skip link; there is none
- Claim: "Skip-to-main-content landmark and clear ARIA navigation landmarks." Reality: repo-wide `skip` search = 0 matches; `<main>` exists (`WorkspaceLayout.tsx:120`) but keyboard users must tab through the entire sidebar (6 nav items + N documents + 4 footer actions) on every route change.
- **Fix:** First focusable element in `WorkspaceLayout`: `<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:bg-surface focus:p-2">Skip to main content</a>` + `id="main-content"` on `<main>`.

#### 🔴 F2 [CRITICAL] Core selection/list interactions are mouse-only (VPAT 2.1.1 "100% operable" is false)
- `LeftNavigation.tsx:124-147` — document switcher rows are `<div onClick>` (no `role`, `tabIndex`, or key handler).
- `AiResearchChat.tsx:365-381` — Library-mode paper checklist: `<div onClick>` toggles.
- `AiResearchChat.tsx:545-574` — cited-source cards: `<div onClick>` selects into Source Panel (inner "Open in Reader" *is* a button ✔, but primary selection is not keyboard-reachable).
- `trustMarker.ts:103-117` / `citation.ts:132-148` — trust markers & citation pills: click + `title` tooltip only; no `tabIndex`, no `role="button"`, no Enter/Space, no focus popover. §4.4/§8 require markers be "reachable and operable via keyboard alone"; hover-only tooltips additionally fail sighted-keyboard users (§4.3 anticipates "hovering (or focusing…)").
- `ResearchLibrary.tsx:394-400` — paper titles open the reader via `<h3 onClick>`.
- **Fix pattern:** convert rows/cards to `<button>` (or `role="button" tabIndex={0}` + Enter/Space); give markers `tabIndex={0}` `role="button"` `aria-label={titleText}` and a focus-triggered popover.

#### 🔴 F3 [CRITICAL] Ghost text enters no live region (VPAT 4.1.3 claim partially false)
- Claim: "AI ghost text suggestions … announced to screen readers via aria-live='polite'." Reality: `createGhostTextSpan` (`ghostText.ts:44-70`) builds a decoration widget with zero ARIA (`aria-hidden` not set, no `role`, no announcement); the suggestion silently appears in the visual layer only. Also the accepted-insertion (`acceptGhostText`) is announced nowhere (contrast: citation insertion IS announced via `w.announce` — `DocumentsView.tsx:196` ✔).
- **Fix:** On `setGhostText`, fire the existing `announce()` channel: "Suggestion available, Tab to accept: <first N words>"; mark the widget `aria-hidden="true"` so the un-committed text stays out of the a11y tree (per §8: announce *as a suggestion*, don't insert as committed text).

#### 🟠 F4 `prefers-reduced-motion` ignored everywhere (binding §8: "must respect")
- Zero matches repo-wide. In-flight animations: spinner `animate-spin` (multiple), pulse indicators `animate-pulse` (`DocumentsView.tsx:218`, `AiResearchChat.tsx:531,643`), drag-over `animate-bounce` (`ResearchLibrary.tsx:147`), dialog/popover zoom-slide suites, `animate-slide-in-left/right` (`globals.css:36-64`), smooth `scrollIntoView` (`AiResearchChat.tsx:127`), bibliography highlight `transition-all duration-300 … scale-[1.02]`.
- **Fix:** Global guard in globals.css: `@media (prefers-reduced-motion: reduce){ *,::before,::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important} }` + conditional `{behavior:'auto'}` scroll.

#### 🟠 F5 Form labeling contradicts VPAT 3.3.2 ("All form inputs … explicit labels")
- Exactly **1** `htmlFor` in the app (`ExportModal.tsx:214`); 32 `<label>` elements elsewhere wrap checkboxes loosely or decorate groups. Representative offenders: API-key/model/base-url inputs (`SettingsView.tsx:466-497`), Tabby fields (`:332-349`), rate limit (`:424`), settings toggles (`:255-260,307-327` — checkbox not inside `<label>`, no `id`), chat textarea (`AiResearchChat.tsx:592-599`), library search (`ResearchLibrary.tsx:290`), reader search, math LaTeX input (`EditorToolbar.tsx:471-478`), comment/reply inputs (`CommentsPanel.tsx:264-272,288-294`).
- **Fix:** Add visually-hidden or visible `<label htmlFor>` pairs; for icon-adjacent toggles wrap input inside `<label>`.

#### 🟠 F6 Icon-only buttons lean on `title` instead of accessible names (VPAT 1.1.1 overstated)
- Only 25 `aria-label`s total. `title`-only controls (name computed unreliably across AT; nothing on touch): library delete (`ResearchLibrary.tsx:489-498`), copy/export bib (`SourcePanel.tsx:346-363`), collapsed-panel expand (`SourcePanel.tsx:146`), chat send (`AiResearchChat.tsx:600-607`), comments resolve/delete (`CommentsPanel.tsx:238-257`), reader back/zoom/view-mode cluster (`PdfReader.tsx:196-202` + toolbar), toast close (`WorkspaceLayout.tsx:184` — a bare `✕` character, also an emoji-as-icon anti-pattern), document-row delete (`LeftNavigation.tsx:136-144` — additionally hover-gated, see F7).
- **Fix:** `aria-label` on every icon-only control (keep `title` for sighted tooltip).

#### 🟠 F7 Hover-only affordances hide functionality from keyboard/touch
- Document delete appears only via `opacity-0 group-hover:opacity-100` (`LeftNavigation.tsx:141`) — invisible and unreachable without pointer hover (focus does not trigger `group-hover`).
- **Fix:** Gate on `group-focus-within:opacity-100` too, or always-visible ghost icon.

#### 🟡 F8 Dropdown/menu focus indication is a faint background swap
- `dropdown-menu.tsx:76` (items), `select.tsx:116`: `focus:bg-sunken` only. Sunken-on-surface delta ≈ 1.1:1 — technically "visible," practically misspottable, and weaker than the `ring-accent` standard used elsewhere (inconsistent with VPAT 2.4.7's blanket description).
- **Fix:** Add `focus-visible:ring-1 ring-accent` or bolden to `focus:bg-accent/10 focus:text-accent`.

#### 🟡 F9 Landmarks/semantics near-misses
- Active nav lacks `aria-current="page"` (`LeftNavigation.tsx:73-106`); custom tablists hand-roll roles without id/aria-controls wiring (`AiResearchChat.tsx:260-324`, `ResearchLibrary.tsx:256-283`) and without arrow-key roving (Radix `Tabs` used elsewhere does this correctly — IntelligenceView ✔); editor root lacks `role="textbox"` `aria-multiline` `aria-label` (`AcademicEditor.tsx:216-219`); CommentsPanel is a bare `<div>` (no `role="complementary"` / label); chat transcript correctly `role="log" aria-live="polite"` ✔.
- Heading order generally sound (one `h1` per view via `ViewHeader` ✔); nit: empty-state `h3`s under no `h2` (`AiResearchChat.tsx:414`, `ResearchLibrary.tsx:369`).

#### 🟡 F10 i18n/RTL readiness (given `i18n/` dir exists)
- `strings.json` is English-only; `t()` silently returns the key on miss (`i18n/index.ts:15-26`); meanwhile large volumes of user-visible English are hardcoded outside the catalog ("Comments", "History", "Trust Legend", "Cite Source", "Accept & Insert", "reversible", toast texts, shortcut labels, Settings section headers…). No `dir` attribute management anywhere → RTL is structurally unready (logical-property classes like `border-l-2`, `left/right-` utilities used extensively would need auditing). `lang="en"` is static ✔ (VPAT 3.1.1 true for en).
- **Fix:** At minimum route the hardcoded strings through `t()`; defer RTL until a second locale is real, then adopt `psuedoRTL` smoke test + logical properties.

#### 🟡 F11 Modals: solid foundations, one gap each
- All 13 `DialogContent` usages include `DialogTitle` ✔ (VPAT 1.3.1/4.1.2 hold here); Radix supplies traps/Esc ✔. Gap: `hideClose` on ConfirmDialog removes the pointer path entirely (Esc/Cancel remain — acceptable); `GlobalSearchModal` listbox omits `aria-activedescendant` (selection announced only via focus since items are buttons — acceptable but worth noting); `ShortcutsModal` filter input autoFocus is fine, but the dialog's scroll body lacks labelled grouping headings semantics (uses styled divs, not `<h3>`s).

#### 🔵 F12 Misc a11y polish
- `aria-hidden` present on only 3 decorative elements; hundreds of lucide icons default to `aria-hidden` behavior via `svg` (lucide marks decorative by default only when `aria-hidden` prop set — most instances omit it; harmless since svgs without title are skipped, but pair with the F6 naming work).
- Zoom/reflow (VPAT 1.4.4/1.4.10): px-fixed side rails (`w-80/w-96/w-[420px]`) plus `w-screen` make exact 320px reflow unverified; recommend an axe+zoom manual pass before repeating the claim.
- Color-alone signals remaining: highlighter colors (`yellow`/`blue` annotation categories, `PdfReader.tsx:63,158`), graph node types (B7). Extraction-status dots DO carry text labels ✔ (§5.2 satisfied there), probe dots carry text ✔.

---

### G. AI-Specific UX

#### ✅ G1 What the codebase gets genuinely right (rare in MVPs)
| Spec clause | Evidence |
|---|---|
| §4.2 grounding preview **before** acceptance | Ghost badge with source authors + inspect-on-click (`ghostText.ts:51-67`) |
| §4.2 Tab-accept / Esc-dismiss / never-auto-accept | `ghostText.ts:143-162` + clear-on-doc-change (`:186-194`) |
| §4.2 honest degraded state + Settings link | `DocumentsView.tsx:215-236` status bar ("Inline suggestions off" path, hourly budget counter) |
| §4.5 persistent segmented mode control, per-message general banner | `AiResearchChat.tsx:259-324`, `:473-478` |
| §4.4 block-level trust legend ("N grounded · N inference ∿ · N general") | `AiResearchChat.tsx:481-498`; legend card `SourcePanel.tsx:282-309` |
| §33 insufficient-evidence banner | `insufficientEvidence` → styled warning block (`AiResearchChat.tsx:501-511`) |
| §6.2 labeled thinking stage, streaming cursor | ThinkingBlock auto-expand/collapse (`:625-659`), blinking caret (`:531`) |
| §6.1 stepped PDF pipeline (check/spinner/pending + unverified badge) | `ResearchLibrary.tsx:153-240` — textbook implementation |
| §4.6 unverified-extraction persistent banner | `PdfReader.tsx:353-361` |
| Latency transparency | `{latencyMs}ms` on both AI cards |

#### 🟠 G2 Streaming chat lacks retry & provider-absence honesty
- Errors stream in as ordinary prose (E4-3); no "Retry" affordance; no pre-flight check for "No AI provider configured" (§6.3 requires the chat surface to prompt configuration instead of letting the request die). Empty-state chips happily dispatch into a dead backend.
- **Fix:** Detect provider-unconfigured state (settings API already exposes it — `api.providers.list()`) and swap the composer for a "Configure a provider" inline card; wrap failures in an error bubble with Retry.

#### 🟠 G3 Continuation/edit flow breaks the writing surface (see E1) and its errors
- Beyond the insert-divergence: failure text masquerades as generated prose ("Failed to generate continuation…" set as `continuationText`, `WorkspaceContext.tsx:465-466`) with grounding quietly downgraded to general-knowledge — the card then offers "Accept & Insert" on an error string. Regenerate doubles as the only recovery path but isn't framed as such.
- **Fix:** Add an explicit `isError` state → red-tinted card footer, disable Accept, primary action becomes Retry.

#### 🟡 G4 Ghost-text presentation deviates from §4.2's "reads as not-yet-committed"
- Widget adds `italic opacity-75` (`ghostText.ts:47`); spec says tertiary color, "never bold, never a different font" — italic is a third voice beyond spec intent and can be confused with emphasized document text on serif body.
- **Fix:** Drop italic; keep `text-text-tertiary` (already correct).

#### 🟡 G5 `@`-popover: strong keyboard model, two spec nits
- Implements §4.1(2)-(4) incl. context ranking, ↑↓/Enter/Esc, extraction-status icon per row ✔, dead-end avoidance with "Add by DOI" ✔. Nits: Esc cancels the popover but leaves the typed `@` in the paragraph (§4.1(4): "delete the trailing @"); result rows lack listbox/option semantics (`CitationPopover.tsx:135-141` uses divs; selection is visual-only for AT).
- **Fix:** On Escape, `deleteRange({from: pos, to: pos+1})`; add `role="listbox"/"option"` + `aria-selected`.

#### 🔵 G6 Reader "Ask AI" anchored thread exists but is modal-flavored
- Selection floating toolbar with Highlight/Note/Ask AI present (`PdfReader.tsx:642+`) ✔ per §4.6; Ask AI opens an inline modal-ish panel rather than the spec's "small inline thread anchored to that selection," and the annotation thread records Q/A as plain notes. Mouse-driven selection toolbar has no keyboard equivalent (F2 family).

---

## Guidelines & VPAT Conformance Audit

### `OpenResearch_UI_UX_Guidelines.md` (v1) — clause verdicts

| § | Documented claim | Reality verdict |
|---|---|---|
| 2.2 | CSS custom properties; never hard-code hex in components | ⚠️ PARTIAL — token pipeline excellent; 84 palette-class + 6 hex-SVG violations |
| 2.2 | Semantic colors paired with icon/label, never color alone | ✔ MOSTLY — dots/legend/banner compliant; graph nodes & highlighter colors excepted (M12/B7) |
| 2.2 | All pairs ≥4.5:1 (body) / ≥3:1 (large/UI) | ❌ FAIL in dark theme for accent-fill text (2.79:1) and danger-fill text (3.35:1); doc's own tertiary value fails (3.5:1) though code corrected it |
| 2.3 | Fixed type scale, no ad-hoc sizes; ≥14px continuous reading | ❌ FAIL — 215/219 sizes ad-hoc 9–11px; chat/bibliography/reader metadata below floor |
| 2.4 | Two density modes, user-toggleable | ❌ FAIL — toggle exists but spacing tokens unconsumed (cosmetic no-op), unpersisted |
| 3.1 | 48px fixed top bar | ❌ FAIL — height var undefined (`--header-height`) |
| 3.1 | Active nav = accent left-border indicator, never filled block | ⚠️ MOSTLY — left border ✔ but adds `bg-surface/60` tint; no `aria-current` |
| 3.1 | Left nav 220px collapsible to 56px | ✔ — vars + classes match (`LeftNavigation.tsx:66-68`) |
| 3.2 | Editor capped 720px, centered | ✔ — `max-w-[var(--editor-max-width)]` |
| 3.2 | Source panel 320px collapsible; rail keeps unresolved-flag badge | ✔ — `SourcePanel.tsx:139-167` implements badge count exactly |
| 3.2 | Source panel never removed to simplify | ✔ — persistent in shell |
| 3.3 | Card-list library; extraction dot ALWAYS visible; Open·Chat·Cite fixed order | ✔ — `ResearchLibrary.tsx:417-499` (delete appended after the trio; acceptable) |
| 4.1 | Inline popover for `@`, never modal; live-filter ranked; ↑↓/Enter/Esc; insert pill + bibliography highlight; removal toast | ⚠️ MOSTLY — all present except trailing-`@` cleanup and listbox semantics |
| 4.2 | Ghost text styling; Tab/Esc; grounding preview pre-accept; latency-disable status note | ✔ STRONG — plus minor italic deviation (G4) |
| 4.3 | Warning dotted underline; Find sources; per-sentence dismissal | ✔ — `claimVerification.ts:60-80` + inspector |
| 4.4 | Permanent visible markers (numeral / ∿); multi-marker preserved | ⚠️ PARTIAL — rendering ✔; keyboard activation & SR naming ✖ (F2/F3) |
| 4.5 | Persistent mode segmented control; per-message General banner; **thread divider on switch** | ❌ PARTIAL FAIL — divider replaced by 2s toast (E3) |
| 4.6 | Split reader; selection toolbar Highlight·Note·Ask AI; unverified banner | ⚠️ MOSTLY — banner ✔, toolbar ✔ (mouse-only); "PDF render" is simulated extracted text, no real PDF canvas |
| 6.1 | Stepped pipeline indicator, never bare spinner | ✔ EXEMPLARY |
| 6.2 | Chat thinking ≤1.5s feedback; autocomplete never blocks typing | ✔ |
| 6.3 | Empty states with next action; no-provider prompt | ⚠️ PARTIAL — library/chat empties ✔; provider-absence prompt ✖ in chat (G2) |
| 6.4 | Inline actionable errors; never generic; destructive failures persist | ❌ FAIL — `alert()`×3, console-swallowed×~20, error-as-prose without actions |
| 7 | Three button tiers; ≤1 Primary/view; citation pill round-full 10% tint; toasts bottom-center 4s; modals restricted to blocking actions | ⚠️ MIXED — tiers ✔ (superset); multi-Primary leaks; pill shape/token off; toast position/duration off; modal usage otherwise disciplined ✔ |
| 8 | WCAG 2.1 AA verified; keyboard+focus rings on ALL §4 elements; SR announcements for ghost text & markers; reduced-motion respected | ❌ SUBSTANTIAL FAIL — see B1/B5/F2/F3/F4/F6 |
| 9 | Canonical shortcuts incl. Ctrl+F; discoverable `?` sheet | ⚠️ PARTIAL — sheet ✔ excellent; Ctrl+F phantom (E2); Mac users shown "Ctrl" labels |
| 10 | <1024 panel overlay; <768 rail; 320px floor + bottom-sheet fallback | ⚠️ PARTIAL — collapses ✔; overlay/bottom-sheet/restoration ✖ (C3) |

### `VPAT_CONFORMANCE_STATEMENT.md` — claim-by-claim reality check

| VPAT claim | Code reality | Verdict |
|---|---|---|
| 1.1.1 Supports — all icon-only buttons have descriptive `aria-label` + tooltip | 25 `aria-label`s total; many icon buttons `title`-only (F6) | ❌ Overstated → "Partially Supports" |
| 1.3.1 Supports — strict heading hierarchy, semantic tables/dialogs | Mostly holds (h1/view, DialogTitle everywhere ✔); stray h3-under-nothing | ✔ with minor caveats |
| 1.4.1 Supports — trust states always paired with redundant cue | True for dots/legend/banners; false for graph node types & highlighter palette | ⚠️ Mostly true |
| 1.4.3 Supports — light 15.8:1, dark 12.4:1 | Ratios real but **irrelevant to the failing pairs**: white-on-accent dark 2.79:1, white-on-danger dark 3.35:1 (B1/B2) | ❌ FALSE as stated |
| 1.4.4/1.4.10 Supports — clean 200% zoom, reflow to 320px | Plausible but unverifiable; px-fixed rails + `w-screen` risk horizontal scroll at 320px | ⚠️ Unproven |
| 1.4.11 Supports — focus indicators & active borders >3:1 | True for focus rings (5.96–7.39) ; false for input borders 1.29:1 (B5) | ⚠️ Half-true |
| 2.1.1 Supports — 100% keyboard operable, all listed shortcuts | False: F2 (cards/checklists/markers/nav rows), E2 (Ctrl+F phantom) | ❌ FALSE → "Partially Supports" |
| 2.1.2 Supports — clean focus traps, Esc restores trigger | Radix-managed ✔ | ✔ |
| 2.4.1 Supports — skip-to-main-content landmark exists | **No skip link exists** (F1) | ❌ FALSE |
| 2.4.7 Supports — visible rings on all interactives | Broadly true (249 usages); weak bg-only focus in menus (F8); hover-gated delete (F7) | ⚠️ Mostly |
| 3.1.1 Supports — lang=en, strings externalized | lang ✔; externalization partial (hardcoded strings pervasive, F10) | ⚠️ Half-true |
| 3.3.2 Supports — all inputs have explicit labels | 1 `htmlFor` in app; placeholder-only pervasive (F5) | ❌ FALSE → "Partially Supports" |
| 3.3.3 Supports — actionable errors | Chat/comments/settings errors lack actions (E4) | ⚠️ Partial |
| 4.1.2 Supports — standard ARIA roles on custom components | Radix roles ✔; editor/marker/popover gaps (F2/F9/G5) | ⚠️ Mostly |
| 4.1.3 Supports — dynamic updates announced politely | Citation/save ✔ via SR region; **ghost text not announced** (F3); toast not a live region | ⚠️ Partial |
| §3 AT matrix (NVDA/VoiceOver/Keyboard-only "Pass") | Keyboard-only Pass contradicted by F2; ghost-text SR claim contradicted by F3 | ❌ Not reproducible against current code |

> **Bottom line:** the VPAT reads as aspirational documentation written ahead of the implementation. Four Level-A criteria currently fail outright on code evidence (2.1.1, 2.4.1, 3.3.2, and 1.4.3 in dark mode). Until remediated, publishing this statement creates procurement/legal exposure (Section 508 buyers rely on it).

---

## Positive Observations

1. **Token architecture is right**: CSS-variable tokens → Tailwind semantic mapping → zero gray-* usage anywhere in `packages/ui` — a rare, disciplined foundation (B1's fix is therefore a two-line token change, not a refactor).
2. **Stepped PDF pipeline indicator** (`ResearchLibrary.tsx:153-240`) implements §6.1 better than most commercial products — named stages, per-state icons, unverified badge, dismiss-on-ready.
3. **Ghost-text grounding preview before acceptance** (`ghostText.ts:51-67`) is the single best trust feature in the codebase — traceability *previewable pre-commit*, exactly as §4.2 demands.
4. **Persistent General-mode warning on every message** (`AiResearchChat.tsx:473-478`) honors §4.5's anti-scroll-past rationale precisely.
5. **Trust Legend composition line** ("N grounded · N inference ∿ · N general", `AiResearchChat.tsx:481-498`) delivers §4.4's block-level composition label.
6. **Insufficient-evidence banner** distinguishes "the system found nothing" from "the answer is negative" — §33 Rule 3 honored in UI.
7. **Status-bar honesty for disabled autocomplete** with a Settings deep-link (`DocumentsView.tsx:215-236`) — "never fail silently" implemented.
8. **Source Panel collapsed-rail badge** for unresolved flags (`SourcePanel.tsx:152-165`) — information density preserved at minimal width, exactly per §3.2.
9. **SR announcement plumbing exists and is used** for citations/outlines/acceptances (`WorkspaceContext.announce` + polite region) — the channel just needs extending to ghost text/toasts.
10. **Citation popover keyboard model** (↑↓/Enter/Esc, context ranking, dead-end escape hatch to DOI import) is complete and matches §4.1 beat-for-beat.
11. **Library card anatomy** follows §3.3 faithfully: always-visible extraction dot *with text label*, fixed Open·Chat·Cite ordering, DOI mono-metadata.
12. **Unverified-extraction banner in reader** (`PdfReader.tsx:353-361`) — §4.6's "not optional chrome" implemented.
13. **Latency transparency on AI cards** (`{latencyMs}ms`) — unusual honesty for generation UX.
14. **Dialog hygiene**: every one of 13 dialogs carries `DialogTitle`; shared `DialogHeader/Footer` keep modal chrome uniform.

---

## Prioritized UX Remediation Plan

### Sprint 1 — Conformance stopgaps (fix the false VPAT claims)
| # | Item | Effort | Files |
|---|---|---|---|
| 1 | **B1/B2**: dark-mode solid-fill ink token (flip Button/chat/send/upload to near-black-on-accent in `[data-theme=dark]`) | S | `tokens.css`, `button.tsx`, 28 call sites via one class change if routed through Button |
| 2 | **F1**: skip link + `id="main-content"` | XS | `WorkspaceLayout.tsx` |
| 3 | **F2 (wave 1)**: convert document rows, chat checklist, source cards to real buttons; `aria-current` on nav | M | `LeftNavigation.tsx`, `AiResearchChat.tsx` |
| 4 | **E1**: accept-continuation/edit → ProseMirror transaction (restore trust in the flagship interaction) | M | `WorkspaceContext.tsx`, `AcademicEditor.tsx` |
| 5 | **C1**: `h-topbar`; delete or define `--header-height` | XS | `TopBar.tsx` |
| 6 | Republish VPAT with honest "Partially Supports" rows until items land | XS | docs |

### Sprint 2 — Systemic consistency
| # | Item | Effort |
|---|---|---|
| 7 | **A1**: map Tailwind fontSize to the 7-step scale; codemod 10/11px → 12px; lint-ban `text-\[\d+px\]` | M |
| 8 | **F4**: reduced-motion global guard + auto-scroll behavior switch | XS |
| 9 | **F5**: label every input (hidden-label util), wrap toggles in `<label>` | M |
| 10 | **E3**: persistent per-message mode divider (render `msg.mode` changes) | S |
| 11 | **E4**: retire `alert()`; chat error bubble with Retry; stop console-swallowing in comments | M |
| 12 | **B6**: purge hardcoded palette classes → tokens/neutral tints; lint rule | M |
| 13 | **C2**: wire density vars into list/card paddings or cut the toggle; persist choice | S |

### Sprint 3 — Polish & depth
| # | Item | Effort |
|---|---|---|
| 14 | **F2 (wave 2)**: keyboard-operable trust markers/citation pills (tabIndex + focus popover + SR names); **F3** ghost-text announcements | M |
| 15 | **D3/D1/D4/D2**: unified Toast primitive (bottom-center, live, i18n); consolidate hand-rolled buttons onto `<Button>`; pill `rounded-full`; ConfirmDialog focuses Cancel | M |
| 16 | **B3/B4**: single-source tokens (generate `index.ts` from CSS); update guideline hex table | S |
| 17 | **C3/C4**: <1024 source-panel overlay; panel-state restoration on resize-up; 44px hit areas; `w-screen`→`w-full` | M |
| 18 | **G2**: provider-absence inline card in chat; **E6** innerHTML fix; **G5** Esc-deletes-`@` + listbox roles | M |
| 19 | **F10**: route hardcoded strings through `t()` (prereq for any future RTL) | M |
| 20 | Add automated gates: axe-core in CI, contrast unit test over token pairs, ESLint bans (`alert(`, `text-\[\d+px\]`, palette classes, `py-0\.2`) | M |

*Effort key: XS < 1h · S ≤ 0.5d · M ≤ 2d (single dev, familiar with codebase).*

— End of report —
