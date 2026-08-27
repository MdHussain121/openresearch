# 001 — Replace transition-all on TabsTrigger with explicit properties

- **Status**: TODO
- **Commit**: no-commit (working tree, zero commits)
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, 1 line

## Problem

`transition-all` animates every property including layout/paint composite and triggers unintended GPU work. In a crisp dashboard hit tens of times/day (tab switches in SourcePanel, AI Chat), this causes dropped frames under load. Specifically:

```tsx
// packages/ui/src/tabs.tsx:29 — current
'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-accent data-[state=active]:font-semibold data-[state=active]:shadow-2xs select-none',
```

Audit rule AUDIT.md §5: **"`transition: all` animates unintended properties off-GPU — always a finding."** Must animate `transform` and `opacity` only, or explicitly `background-color,color,box-shadow`.

## Target

Exact end state — explicit properties, tokenized duration and easing:

```tsx
// target
'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-accent data-[state=active]:font-semibold data-[state=active]:shadow-2xs select-none',
```

Inline style fallback if `duration-150` not yet tokenized: keep `duration-150` (maps to `var(--duration-fast)` 150ms) and default easing `var(--ease-default)` cubic-bezier(0.2,0,0,1). Do NOT add `will-change`.

## Repo conventions to follow

- Motion tokens live in `packages/tokens/src/tokens.css:56-64` (`--duration-fast: 150ms`, `--ease-default: cubic-bezier(0.2,0,0,1)`). Tailwind durations map via `apps/web/tailwind.config.js:55-58`. Use `duration-150` not `duration-[150ms]`.
- Exemplar for correct explicit transition: `packages/ui/src/button.tsx:7` uses `transition-[transform,background-color,border-color,color,box-shadow] duration-150` — imitate this pattern but without `transform` if not needed (TabsTrigger has no transform on hover).
- Prefer `transition-[background-color,color,box-shadow]` over `transition-colors` to exclude `border-color` if not animated.

## Steps

1. Open `packages/ui/src/tabs.tsx` line 29. Replace `transition-all` with `transition-[background-color,color,box-shadow,transform]` (or `transition-colors` if `transform` not needed). Keep `duration-150` implicitly or add explicitly if missing — current line has no duration, so add `duration-150` after the transition token.
2. Verify no other `transition-all` remains in `packages/ui` via `grep -r "transition-all" packages/ui`.
3. Run typecheck: `npm run typecheck --workspace=@openresearch/ui` — expect pass.

## Boundaries

- Do NOT touch `TabsList` or `TabsContent` — motion properties only.
- Do NOT add new dependencies or new tokens.
- Do NOT add `will-change-*`.
- If line 29 already differs (drift), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npm run typecheck --workspace=@openresearch/ui` passes; `grep -r "transition-all" packages/` returns 0.
- **Feel check**: Toggle SourcePanel tabs (Source / Claims / Bibliography) and AI Chat mode tabs rapidly. Confirm no visual regression — active state still animates background/color, but DevTools Performance panel shows only `background-color, color, box-shadow` compositing, no layout. No dropped frames.
- **Done when**: `tabs.tsx:29` contains `transition-[background-color,color,box-shadow` and `duration-150`, zero `transition-all` in repo.
