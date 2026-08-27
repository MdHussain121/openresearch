# 005 — Gate hover motion for touch + remove permanent will-change

- **Status**: TODO
- **Commit**: no-commit (working tree, zero commits)
- **Severity**: MEDIUM
- **Category**: Accessibility & Performance
- **Estimated scope**: ~15 files, ~20 lines

## Problem

Two related cohesion issues per AUDIT.md §5 and §6:

**A. Ungated hover motion** — `hover:-translate-y-px`, `hover:shadow-*`, `hover:rotate-3`, `hover:scale-*` fire on tap on touch devices via false hover, causing stuck lifted states until next tap. No file gates with `@media (hover:hover) and (pointer:fine)`.

```tsx
// examples — current (representative)
packages/ui/src/button.tsx:7
'... hover:-translate-y-px will-change-transform'
// apps/web/src/components/library/ResearchLibrary.tsx:425
'... hover:shadow-md hover:-translate-y-px ...'
// apps/web/src/components/shell/SourcePanel.tsx:146
'className="... transition-transform duration-150 hover:rotate-3"'
// packages/editor/src/extensions/citation.ts:143
'... hover:-translate-y-px hover:shadow-2xs ...'
```

40+ occurrences across `ResearchLibrary`, `OnlineSearchPanel`, `AiResearchChat`, `PdfReader`, `SourcePanel`, `LeftNavigation`, `CitationPopover`, `citation.ts`, `button.tsx`.

**B. Permanent will-change** — `will-change-transform` is set permanently on every button, dropdown, tooltip, dialog, toast, comment card, etc., creating persistent compositor layers that waste memory. Per AUDIT.md §5: only set during animation.

```tsx
// packages/ui/src/button.tsx:7 — current
'... will-change-transform'
// packages/ui/src/dialog.tsx:37 — current
'... will-change-transform'
// packages/ui/src/dropdown-menu.tsx:41,58 — current
'... will-change-transform'
// packages/ui/src/select.tsx:73 — current
'... will-change-transform'
// packages/ui/src/tooltip.tsx:18 — current
'... will-change-transform'
// apps/web/src/components/shell/WorkspaceLayout.tsx:184 — current (toast)
'... will-change-transform'
// apps/web/src/components/comments/CommentsPanel.tsx:119,201 — current
'... will-change-transform'
// packages/editor/src/extensions/citation.ts:143 — current
'... will-change-transform'
```

## Target

**A. Gate hover**: wrap hover motion in `[@media(hover:hover)]:hover:` variant or add global CSS guard.

Tailwind 3.4 supports arbitrary variants. Target for buttons/cards:

```css
/* target — per-component class fix */
'hover:-translate-y-px' → '[@media(hover:hover)]:hover:-translate-y-px'
'hover:shadow-md' → '[@media(hover:hover)]:hover:shadow-md'
'hover:rotate-3' → '[@media(hover:hover)]:hover:rotate-3'
```

Alternatively add once in `apps/web/src/app/globals.css`:

```css
/* target — global guard in globals.css */
@media (hover: none) {
  .hover\:-translate-y-px:hover, .hover\:shadow-md:hover, .hover\:rotate-3:hover {
    transform: none !important;
    box-shadow: none !important;
  }
}
```

Prefer per-component arbitrary variant for explicitness.

**B. Remove permanent will-change**: delete `will-change-transform` from all non-animating base states, add only on `data-[state=open]` or during `animate-in`.

```tsx
// target — remove from base
'... will-change-transform' → '' // delete
// add only where animating
'data-[state=open]:will-change-transform' // for Radix primitives
```

For Button/citation pill with `active:scale` and `hover:-translate`, `will-change-transform` can be removed entirely — modern browsers optimize 150ms transforms without hint.

## Repo conventions to follow

- Tokens: no new tokens. Hover motion durations remain `duration-150` / `duration-200` with `var(--ease-default)` already implicit.
- Exemplar for reduced-motion guard: `apps/web/src/app/globals.css:133-140` has `@media (prefers-reduced-motion: reduce)` — place hover guard alongside it.
- Exemplar for correct will-change usage: none exists — this is first correct usage. Use `data-[state=open]:will-change-transform` pattern matching existing `data-[state=open]:animate-in` in `dialog.tsx`, `popover.tsx`.

## Steps

1. Delete `will-change-transform` from base class strings in: `packages/ui/src/button.tsx:7`, `dialog.tsx:37`, `dropdown-menu.tsx:41,58`, `select.tsx:73`, `tooltip.tsx:18`, `apps/web/src/components/shell/WorkspaceLayout.tsx:184`, `CommentsPanel.tsx:119,201`, `SourcePanel.tsx:377`, `AiResearchChat.tsx:274,463,474,561`, `ResearchLibrary.tsx:425`, `OnlineSearchPanel.tsx:286`, `CitationPopover.tsx:144`, `packages/editor/src/extensions/citation.ts:143`, `PdfReader.tsx:644`, `AIContinuationCard.tsx:39`, `AIEditReviewCard.tsx:74`, `LiteratureMatrixView.tsx:208,452`. Replace with `data-[state=open]:will-change-transform` only on Radix primitives that truly animate (dialog, popover, dropdown, select, tooltip, citation popover) — or delete entirely if no state.
2. For hover gating, update hover motion classes in same files: replace `hover:-translate-y-px` with `[@media(hover:hover)]:hover:-translate-y-px`, `hover:shadow-md` with `[@media(hover:hover)]:hover:shadow-md`, `hover:rotate-3` with `[@media(hover:hover)]:hover:rotate-3`. Cover at least `button.tsx`, `citation.ts`, `ResearchLibrary.tsx:425`, `OnlineSearchPanel.tsx:286`, `SourcePanel.tsx:146,187`, `LeftNavigation.tsx:81`. Alternatively add global CSS guard in `globals.css` after line 140: `@media (hover: none) { .hover\:-translate-y-px:hover { transform: none !important; } }` — but per-component is preferred for plan precision; include both options and choose one.
3. Verify via `grep -r "hover:-translate" apps/ packages/ | wc -l` before/after, and `grep -r "will-change-transform" apps/ packages/ | wc -l` should drop from ~15 to ≤5 (only data-state variants).
4. Typecheck `npm run typecheck --workspaces --if-present` (or at least `ui` and `web`).

## Boundaries

- Do NOT change hover colors/backgrounds — only motion `translate`, `shadow`, `rotate`, `scale` gated.
- Do NOT add new dependencies.
- Do NOT change markup/structure.
- If arbitrary variant `[@media(hover:hover)]:` not supported by current Tailwind version (3.4.3 should support), fall back to global CSS guard in `globals.css` — document choice.
- If a step's file line doesn't match due to drift, SKIP that file and report.

## Verification

- **Mechanical**: grep `will-change-transform` count ≤5 and only with `data-[state` prefix; grep `hover:-translate-y-px` without `[@media` returns 0 (if per-component) or global guard exists in `globals.css`.
- **Feel check**: On desktop, hover over ResearchLibrary cards, buttons — lift+shadow still works. On mobile emulator (DevTools > Toggle device toolbar > touch), tap a card — no stuck lifted state after tap, no false hover remains. In DevTools Rendering > Layer borders, confirm no persistent compositor layers for idle buttons (only during open animating dialogs).
- **Done when**: Hover motion gated for fine pointer only, permanent will-change removed, no visual regression on desktop hover.
