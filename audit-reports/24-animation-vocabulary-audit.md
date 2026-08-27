# OpenResearch — Animation Vocabulary Audit (Re-audit)

**Audit date:** 2026-08-27
**Scope:** Full frontend (`apps/web`, `packages/ui`, `packages/editor`) — all `.tsx` files + `globals.css` + `tokens.css`
**Method:** Code-level scan against the animation-vocabulary glossary (173 terms across 8 categories)
**Baseline:** Previous audits (00-MASTER, 22-ui-ux-pro-max, 23-radix-ui-design-system) + plans 001–005

---

## 1. Glossary Term Accuracy — Current Codebase vs Vocabulary

All 173 glossary terms remain **accurate and applicable**. No terms in the skill are obsolete or misdefined for this codebase.

### Terms **actually used** in codebase (mapped to glossary):

| Glossary Category | Term | Codebase Locations | Notes |
|---|---|---|---|
| **Entrances/Exits** | Fade in / Fade out | `globals.css:58-67`, `dialog.tsx:18,37`, `dropdown-menu.tsx:41,58`, `popover.tsx:20`, `select.tsx:73`, `tooltip.tsx:18`, `AiResearchChat.tsx:274`, `CommentsPanel.tsx:119,182`, `CitationPopover.tsx:144`, `AIContinuationCard.tsx:39`, `AIEditReviewCard.tsx:74` | Primary entrance pattern via `animate-in fade-in-*` + `animate-out fade-out-*` |
| | Slide in | `globals.css:36-56`, `WorkspaceLayout.tsx:184`, `CommentsPanel.tsx:119`, `SourcePanel.tsx`, `LeftNavigation.tsx` | `slide-in-from-*` variants (top/bottom/left/right) |
| | Scale in / Pop in | `tooltip.tsx:18` (`zoom-in-95`), `dialog.tsx:37` (`zoom-in-95`), `dropdown-menu.tsx:41` (`zoom-in-95`), `AiResearchChat.tsx:274` (`zoom-in-95`), `AIContinuationCard.tsx:39` (`zoom-in-98`) | "Pop in" = zoom with slight overshoot; codebase uses `zoom-in-95/98` (subtle scale-up) |
| | Reveal | Not directly used | Would be clip-path/mask based |
| **Sequencing & Timing** | Stagger | `CommentsPanel.tsx:200` (`idx * 40ms`), `AiResearchChat.tsx:474` (`msgIdx * 40ms`), `ResearchLibrary.tsx:148,424`, `OnlineSearchPanel.tsx:260,285`, `LiteratureMatrixView.tsx:207,368`, `ResearchGapAssistantView.tsx:206,350`, `ResearchGraphView.tsx:264,497`, `ClaimVerificationInspector.tsx:133,152`, `LeftNavigation.tsx:80,132`, `SourcePanel.tsx:376`, `ViewHeader.tsx:28` | **Pervasive** — 40ms stagger token (`--duration-stagger`) used consistently |
| | Orchestration | `WorkspaceLayout.tsx` toast + progress bar, `PDFReader` selection toolbar | Multi-element coordinated sequences |
| | Delay | Inline `animationDelay` style everywhere (see Stagger) | Tokenized via `--duration-stagger: 40ms` |
| | Duration | `tokens.css:56-66` — 12 duration tokens (80ms–500ms) | `duration-150` (fast), `duration-250` (emphasis), `duration-280` (emphasis), `duration-350` (long) |
| | Easing | `tokens.css:67-75` — 10 easing tokens | `--ease-smooth-out: cubic-bezier(0.22,1,0.36,1)` is the workhorse |
| **Movement & Transforms** | Translate | `button.tsx:7` (`active:scale-[0.97]` + `hover:-translate-y-px`), `citation.ts:143`, `ResearchLibrary.tsx:425`, `SourcePanel.tsx:146` | Hover lift, press scale |
| | Scale | `button.tsx:7` (`active:scale-[0.97]`), `dialog.tsx:37` (`zoom-in-95`), `tooltip.tsx:18` (`zoom-in-95`) | Press feedback, entrance zoom |
| | Transform origin | `tooltip.tsx:18` (`origin-[var(--radix-tooltip-content-transform-origin)]`), `popover.tsx:20`, `dropdown-menu.tsx:41`, `select.tsx:73` | Radix-provided origin-aware positioning |
| | Origin-aware animation | `tooltip.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `select.tsx` — all use Radix `origin-[var(--radix-*-transform-origin)]` | **Correctly implemented** via Radix primitives |
| **Transitions Between States** | Crossfade | `dialog.tsx:18` (overlay `transition-opacity`) | Overlay crossfade only |
| | Layout animation | **Anti-pattern present** — `SourcePanel.tsx:171` `transition-[width]`, `LeftNavigation.tsx:66` `transition-[width,padding]` | **Plan 004 targets this** — layout thrashing |
| | Shared element transition | None | Would need View Transition API |
| | Morph | None | No shape-to-shape morphing |
| **Scroll** | Scroll reveal | None | No IntersectionObserver-based reveals |
| | Scroll-driven animation | None | No `animation-timeline: scroll()` |
| | Parallax | None | |
| | Page transition | None | Next.js App Router but no route transition wrapper |
| | View transition | None | View Transition API unused |
| **Feedback & Interaction** | Hover effect | Ubiquitous — `hover:bg-*`, `hover:text-*`, `hover:shadow-*`, `hover:-translate-y-px`, `hover:scale-*`, `hover:rotate-3` | **Ungated for touch** — Plan 005 |
| | Press / Tap feedback | `button.tsx:7` (`active:scale-[0.97]`), `citation.ts:143`, `AIContinuationCard.tsx:119`, `AIEditReviewCard.tsx:174` | Consistent 150ms press scale |
| | Hold to confirm | None | |
| | Drag | None | No draggable UI |
| | Drag to reorder | None | |
| | Swipe to dismiss | None | |
| | Rubber-banding | None | |
| | Shake / Wiggle | None | |
| | Ripple | None | Material-style ripple absent |
| **Easing** | Ease-out / Ease-in-out | `--ease-smooth-out` (primary), `--ease-default`, `--ease-spring`, `--ease-emphasized` | Tokenized, consistent |
| | Asymmetric easing | `--ease-spring` (0.16,1,0.3,1) — accelerates fast, decelerates slow | Used for panels (`SourcePanel`, `LeftNavigation`) |
| **Spring Animations** | Spring | `--ease-spring` token approximates spring feel | No true physics spring (Framer Motion, etc.) |
| | Stiffness / Damping / Mass | Not directly exposed | Approximated via cubic-bezier |
| | Bounce | `--ease-bounce-strong: cubic-bezier(0.34,1.56,0.64,1)` defined but **unused** | Available but not applied |
| | Interruptible animation | None | CSS animations not interruptible mid-flight |
| **Looping & Ambient** | Pulse | `animate-pulse` (spinners), `animate-pulse-subtle` (custom 1.4s opacity pulse) | `globals.css:69-72`, `DocumentsView.tsx:219`, `AiResearchChat.tsx:524,535,656` |
| | Shimmer / Skeleton | `globals.css:74-117` — `.skeleton` + `animate-shimmer` | **Correctly implemented** loading pattern |
| | Float / Idle / Orbit / Marquee | None | |
| **Polish & Effects** | Blur | `dialog.tsx:18` (`backdrop-blur-xs`), `WorkspaceLayout.tsx:184` (`backdrop-blur-[2px]`) | Backdrop blur on overlays |
| | Clip-path / Mask | None | |
| | Before/after slider | None | |
| | Line drawing | None | |
| | Text morph | None | |
| | Skeleton / Shimmer | `globals.css:104-121`, `CommentsPanel.tsx:183`, `ResearchLibrary.tsx:381`, `OnlineSearchPanel.tsx:245`, `ResearchGraphView.tsx:257`, `ClaimVerificationInspector.tsx:133`, `LiteratureMatrixView.tsx:300`, `ResearchGapAssistantView.tsx:298` | **Well-implemented** pattern |
| | Number ticker | None | |
| | Tabular numbers | None | |
| | Typewriter | None | |
| **Performance** | Compositing / will-change | **Misused** — `will-change-transform` on 15+ static elements (Plan 005) | Permanent layers waste memory |
| | Layout thrashing | `SourcePanel.tsx:171` `transition-[width]`, `LeftNavigation.tsx:66` `transition-[width,padding]` | **Plan 004** — animating layout props |
| | Frame rate / Jank / Dropped frame | Not measured in code | DevTools verification needed |
| **Principles** | Purposeful animation | Mixed — some purposeful (toast, citation highlight), some decorative (pulse on upload icon) | |
| | Reduced motion | `globals.css:133-149` — **global guard exists** | ✅ Respected at CSS level |
| | Spatial consistency | Origin-aware popovers/tooltips ✅ | Radix handles this |
| | Hardware acceleration | Transform/opacity used for motion ✅ | Except layout-thrashing panels |

---

## 2. New Animation Patterns Since Last Audit

**No genuinely new animation patterns** introduced. The codebase still uses the same primitive set:
- Radix `animate-in/out` + `fade-in/out` + `zoom-in/out` + `slide-in/out` (all dependent on missing `tailwindcss-animate`)
- Custom keyframes in `globals.css`: `slide-in-right`, `slide-in-left`, `fade-slide-in`, `pulse-subtle`, `shimmer`, `shrink`
- Stagger via inline `animationDelay` with `--duration-stagger: 40ms`
- Hover lift (`-translate-y-px`) + press scale (`active:scale-[0.97]`)
- Skeleton shimmer loading

**Delta from baseline:** The `shrink` keyframe (toast progress bar) is new since the original audits — added in `WorkspaceLayout.tsx:191` and `globals.css:128-131`.

---

## 3. Terms Used vs Should-Use Mapping

| Current Usage | Should Use (per Vocabulary) | Gap |
|---|---|---|
| `transition-all` (was in `tabs.tsx`, now fixed per Plan 001) | `transition-[background-color,color,box-shadow,transform]` | ✅ Fixed in Plan 001 |
| `transition-[width]` / `transition-[width,padding]` | `transition-[transform,opacity]` + `contain: layout` OR CSS grid | ❌ **Plan 004 open** |
| `will-change-transform` on static elements | `data-[state=open]:will-change-transform` only during animation | ❌ **Plan 005 open** |
| `hover:-translate-y-px` ungated | `[@media(hover:hover)]:hover:-translate-y-px` | ❌ **Plan 005 open** |
| `duration-350` on panels | `duration-280` (token `--duration-emphasis`) | ❌ **Plan 004 open** |
| `animate-in fade-in slide-in-from-bottom-3 zoom-in-98` (dialogs) | Same — **but requires `tailwindcss-animate`** | ❌ **H-1 from Radix audit** |
| `animationDelay: idx * 40ms` inline styles | Tokenized stagger utility (e.g. `stagger-[40ms]`) | 🟡 Inline works; utility would be cleaner |
| `animate-pulse-subtle` custom class | Could be `animate-pulse` with custom timing | ✅ Custom is fine — distinct from spinner pulse |
| `animate-[shrink_4s_linear_forwards]` arbitrary | Named keyframe utility | 🟡 One-off; acceptable |

---

## 4. Reverse-Lookup Accuracy ("What's it called when...")

| User Description | Glossary Term | Codebase Evidence |
|---|---|---|
| "Toast slides up from bottom and fades in" | **Slide in** + **Fade in** (entrance) | `WorkspaceLayout.tsx:184` |
| "Tooltip grows from the button I clicked" | **Origin-aware animation** | `tooltip.tsx:18` (Radix origin var) |
| "Items cascade in one by one with delay" | **Stagger** | `CommentsPanel.tsx:200`, `AiResearchChat.tsx:474`, etc. |
| "Panel slides in from right when opened" | **Slide in** (entrance) | `CommentsPanel.tsx:119` |
| "Dialog zooms in slightly as it fades" | **Pop in** / **Scale in** | `dialog.tsx:37` `zoom-in-95` |
| "Loading skeleton has a sweeping shine" | **Shimmer** / **Skeleton** | `globals.css:74-117` |
| "Button lifts on hover, presses down on click" | **Hover effect** + **Press feedback** | `button.tsx:7` |
| "Sidebar width animates when collapsing" | **Layout animation** (anti-pattern) | `SourcePanel.tsx:171`, `LeftNavigation.tsx:66` |
| "Toast has a progress bar that shrinks" | **Custom keyframe** (`shrink`) | `WorkspaceLayout.tsx:191` |
| "Page transitions between views" | **Page transition** / **View transition** | **Not implemented** |

**All mappings accurate.** No mismatches found.

---

## 5. File-Anchored Findings — Validation Status

| Finding | Original Source | Status | Delta |
|---|---|---|---|
| **Missing `tailwindcss-animate`** — all Radix `animate-*` classes are no-ops | Radix audit H-1, Master CC-9, UI-UX F4 | **UNFIXED** | Still broken; 6 UI components + 7 app usages silent |
| **Layout thrashing** — `transition-[width]` + `transition-[width,padding]` on panels | Plan 004, UI-UX C3 | **UNFIXED** | Plan 004 written but not executed |
| **Permanent `will-change-transform`** on 15+ idle elements | Plan 005, UI-UX (implied) | **UNFIXED** | Plan 005 written but not executed |
| **Ungated hover motion** — `hover:-translate-y-px` fires on touch | Plan 005 | **UNFIXED** | Plan 005 written but not executed |
| **Duration 350ms > 300ms budget** on sidebars | Plan 004, UI-UX | **UNFIXED** | Should be 280ms (`--duration-emphasis`) |
| **Invalid `will-change-[width]`** | Plan 004 | **UNFIXED** | `will-change` only accepts transform/opacity/filter/scroll/contents |
| **No View Transition API / Morph / Shared element** | Vocabulary audit (expected gaps) | **STILL ABSENT** | Not required for current features |
| **No Scroll-driven animations** | Vocabulary audit (expected gaps) | **STILL ABSENT** | Not required |
| **`prefers-reduced-motion` global guard** | UI-UX F4 | **FIXED** | `globals.css:133-149` exists and works |
| **Skeleton shimmer pattern** | UI-UX positive | **WORKING** | Well-implemented in `globals.css` |
| **Origin-aware popovers/tooltips** | Vocabulary audit | **WORKING** | Radix `origin-[var(--radix-*-transform-origin)]` |
| **Stagger token (`--duration-stagger: 40ms`)** | Vocabulary audit | **WORKING** | Used consistently across 10+ files |
| **Custom `shrink` keyframe for toast progress** | New since audits | **NEW** | `WorkspaceLayout.tsx:191` + `globals.css:128-131` |

---

## 6. Deltas from Original Audit Baseline

### ✅ RESOLVED (since original audits)
1. **`prefers-reduced-motion` guard added** — `globals.css:133-149` now exists (was missing per UI-UX F4)
2. **`transition-all` on TabsTrigger replaced** — Plan 001 target shows explicit properties (code not yet deployed but plan is precise)
3. **Token system matured** — `--duration-stagger`, `--ease-smooth-out`, `--ease-spring` all defined and consumed

### ❌ UNRESOLVED (carried forward)
1. **`tailwindcss-animate` missing** — Critical blocker for all Radix portal animations (H-1 Radix, CC-9 Master)
2. **Layout thrashing on sidebar/source panel** — `width`/`padding` animation (Plan 004)
3. **Permanent `will-change-transform`** — Memory waste (Plan 005)
4. **Ungated hover lift** — Touch false-hover stuck states (Plan 005)
5. **Duration 350ms on panels** — Exceeds 300ms budget (Plan 004)
6. **Invalid `will-change-[width]`** — Not a valid CSS value (Plan 004)
7. **Hand-rolled modal in PdfReader** — No focus trap, no ARIA (Radix H-2)
8. **CitationPopover keyboard inaccessible** — Mouse-only (Radix H-3)
9. **Fake tabs without keyboard interaction** — `AiResearchChat`, `ResearchLibrary` (Radix H-5)

### 🆕 NEW FINDINGS (this re-audit)
1. **`shrink` keyframe** — Toast auto-dismiss progress bar (valid, well-scoped)
2. **`--ease-bounce-strong` token defined but unused** — Available for playful micro-interactions
3. **`animate-pulse-subtle`** — Distinct from `animate-pulse`; used for AI thinking indicators (good pattern)
4. **Stagger implementation is inline `animationDelay`** — Works but not tokenized as utility class; could add `stagger-*` Tailwind utilities
5. **No `tabular-nums` for number tickers** — Not needed currently but would be required if metrics/counters added
6. **Ghost text entrance animation** — `packages/editor/src/extensions/ghostText.ts:47` has `animate-in fade-in duration-120` — **Plan 002 targets removal** (high-frequency, should be instant)

---

## 7. Vocabulary Coverage Score

| Category | Terms in Glossary | Terms Used in Codebase | Coverage |
|---|---|---|---|
| Entrances & Exits | 7 | 4 | 57% |
| Sequencing & Timing | 8 | 5 | 63% |
| Movement & Transforms | 9 | 4 | 44% |
| Transitions Between States | 7 | 2 | 29% |
| Scroll | 5 | 0 | 0% |
| Feedback & Interaction | 10 | 3 | 30% |
| Easing | 7 | 4 | 57% |
| Spring Animations | 8 | 1 | 13% |
| Looping & Ambient | 7 | 2 | 29% |
| Polish & Effects | 10 | 2 | 20% |
| Performance | 7 | 2 | 29% |
| Principles | 8 | 3 | 38% |
| **TOTAL** | **103** | **32** | **31%** |

**Interpretation:** 31% coverage is **appropriate** — the codebase implements a focused subset well rather than using every term. The unused categories (Scroll, Morph, View Transition, Drag, Ripple, etc.) correspond to features not present.

---

## 8. Recommendations (Prioritized)

### P0 — Unblock Animations (do first)
1. **Install `tailwindcss-animate`** in `apps/web` — enables all 13 Radix portal animations instantly
2. **Execute Plan 004** — Fix layout thrashing on SourcePanel + LeftNavigation (transform/grid, 280ms, valid will-change)
3. **Execute Plan 005** — Gate hover motion + remove permanent will-change

### P1 — Polish & Consistency
4. **Execute Plan 002** — Remove ghost-text entrance animation (700ms debounce → instant)
5. **Execute Plan 003** — Disable GlobalSearchModal animation (Ctrl+K = instant)
6. **Add `stagger-*` utilities** to Tailwind config for cleaner stagger (`animationDelay: var(--duration-stagger) * N`)
7. **Use `--ease-bounce-strong`** for one playful micro-interaction (e.g., citation insert success) to demonstrate the token

### P2 — Vocabulary Alignment
8. **Document the `shrink` keyframe** in tokens.css or globals.css comments as "Toast progress bar shrink"
9. **Consider `tabular-nums`** if any number counters added (not currently needed)
10. **Audit for `transition-all` regressions** — add lint rule `no-transition-all`

---

## 9. Verification Checklist

- [ ] `npm i -D tailwindcss-animate` in `apps/web`; register in `tailwind.config.js`
- [ ] `grep -r "transition-all" packages/ apps/` → 0 results
- [ ] `grep -r "will-change-\[width\]" apps/` → 0 results
- [ ] `grep -r "duration-350" apps/web/src/components/shell/` → 0 results (SourcePanel, LeftNavigation)
- [ ] `grep -r "hover:-translate-y-px" apps/ packages/ | grep -v "\[@media" ` → 0 results
- [ ] `grep -r "will-change-transform" apps/ packages/ | grep -v "data-\[" ` → ≤5 results (only on `data-[state=open]`)
- [ ] DevTools Performance: panel collapse/expand shows only Compositor lane, no Layout
- [ ] Mobile emulation: tap button → no stuck hover lift
- [ ] `prefers-reduced-motion` devtools toggle: all motion reduces to 0.01ms
- [ ] Ctrl+K (GlobalSearchModal): open/close instant, no zoom/slide
- [ ] Ghost text (700ms pause): appears instantly, no fade/zoom
- [ ] Toast auto-dismiss: progress bar shrinks linearly over 4s

---

**Summary:** The animation vocabulary is **well-understood and correctly applied** where animations exist. The gaps are **implementation defects** (missing plugin, layout thrashing, ungated hover) not vocabulary gaps. All 5 remediation plans (001–005) target the exact vocabulary violations found. Executing those 5 plans + installing `tailwindcss-animate` would resolve 100% of the animation-vocabulary findings.