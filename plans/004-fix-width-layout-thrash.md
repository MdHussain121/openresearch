# 004 — Replace width-animating panel transitions with transform/grid (layout thrash)

- **Status**: TODO
- **Commit**: no-commit (working tree, zero commits)
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files, 3 lines + CSS

## Problem

Animating `width` and `padding` triggers Layout → Paint → Composite on every frame, drops frames under load, and is the #1 performance anti-pattern per AUDIT.md §5 ("Animate `transform` and `opacity` only. `width`/`height`/`margin`/`padding`/`top`/`left` trigger layout").

```tsx
// apps/web/src/components/shell/SourcePanel.tsx:171 — current
<aside className="w-[var(--source-panel-width)] border-l border-border-default bg-surface flex flex-col shrink-0 overflow-y-auto transition-[width] duration-350 will-change-[width]" style={{ transitionTimingFunction: 'var(--ease-spring, cubic-bezier(0.16,1,0.3,1))' }}>

// apps/web/src/components/shell/SourcePanel.tsx:143 — collapsed trigger also
className="w-[var(--source-panel-collapsed-width)] border-l border-border-default bg-sunken flex flex-col items-center py-4 cursor-pointer hover:bg-surface transition-[background-color,transform] duration-150 active:scale-[0.98] ..."

// apps/web/src/components/shell/LeftNavigation.tsx:66 — current
className={`border-r border-border-default bg-sunken flex flex-col justify-between shrink-0 transition-[width,padding] duration-350 will-change-[width] ${ isSidebarCollapsed ? 'w-[var(--sidebar-collapsed-width)] p-1.5' : 'w-[var(--sidebar-width)] p-2' }`}
 style={{ transitionTimingFunction: 'var(--ease-spring, cubic-bezier(0.16,1,0.3,1))' }}
```

Additionally `duration-350` exceeds UI budget (300ms max) per AUDIT.md §2: sidebars/panels should be 200–280ms.

`will-change-[width]` is invalid (will-change only supports `transform`, `opacity`, `filter`, `scroll-position`, `contents`).

## Target

Use GPU-accelerated technique — either `transform: translateX` or CSS grid `grid-template-columns` with `transition: grid-template-columns` (layout-contained) or simplest: keep width but add `contain: layout` + switch to `transform` via negative margin. Minimal-risk minimal-change target for executor with zero taste:

```tsx
// target — SourcePanel.tsx:171 (expanded)
<aside className="w-[var(--source-panel-width)] border-l border-border-default bg-surface flex flex-col shrink-0 overflow-y-auto transition-[transform,opacity] duration-280 will-change-transform" style={{ transitionTimingFunction: 'var(--ease-spring, cubic-bezier(0.16,1,0.3,1))' }}>
// plus collapse via transform: when isCollapsed, parent grid handles width instantly; inner aside translates. Better: wrap in grid container.

// Recommended grid approach (no layout thrash):
// WorkspaceLayout.tsx main container: change flex to grid with template columns
// <div className="flex flex-1 overflow-hidden"> → <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: `${isSidebarCollapsed ? '56px' : '220px'} 1fr ${isSourcePanelCollapsed ? '32px' : '320px'}` }}>
// Then remove transition-[width] from both panels, add transition-[grid-template-columns] duration-280 var(--ease-spring) on grid container, or transition-transform on panels.

// If grid refactor is out of scope, at minimum:
<aside className="w-[var(--source-panel-width)] ... transition-[width] duration-280 will-change-auto contain-layout">
// Change 350→280 and remove invalid will-change-[width]
```

Exact token values: `--ease-spring: cubic-bezier(0.16,1,0.3,1)` (already in tokens.css:63), `--duration-emphasis: 280ms` (tokens.css:59). Duration 280.

## Repo conventions to follow

- Tokens: `packages/tokens/src/tokens.css:59 --duration-emphasis: 280ms`, `:63 --ease-spring`. Use `duration-280` (already in tailwind.config.js:56) with `style={{ transitionTimingFunction: 'var(--ease-spring)' }}` as existing pattern in both files.
- Layout dimensions: `tokens.css:40-41 --sidebar-width:220px`, `:43 --source-panel-width:320px` — keep using `var(--sidebar-width)` etc.
- Exemplar: `apps/web/src/components/shell/WorkspaceLayout.tsx:107` already does grid? No, uses `flex`. Grid template approach is new but matches academic restraint (no extra JS spring).
- `will-change-transform` is valid; `will-change-[width]` is not — remove.

## Steps

1. In `apps/web/src/components/shell/SourcePanel.tsx:171`, change `duration-350` → `duration-280` and remove `will-change-[width]` (replace with `will-change-auto` or delete). Change `transition-[width]` → `transition-[transform,opacity]` if using transform approach, or keep `transition-[width]` with added `contain-[layout]` and `will-change-auto` as minimal fix (still layout but contained, duration fixed).
2. In `apps/web/src/components/shell/LeftNavigation.tsx:66`, same: `transition-[width,padding]` → `transition-[width]` or `transition-[transform]` + `duration-350`→`duration-280`, remove `will-change-[width]`.
3. In `apps/web/src/components/shell/WorkspaceLayout.tsx:107`, optionally refactor outer `<div className="flex flex-1 overflow-hidden">` to grid container if choosing grid solution — add `style` with `gridTemplateColumns` driven by `isSidebarCollapsed`/`isSourcePanelCollapsed` and move transition there. If not refactoring, skip grid and just fix durations.
4. Verify no `will-change-[width]` remains: `grep -r "will-change-\[width\]" apps/`.
5. Typecheck `npm run typecheck --workspace=@openresearch/web`.

## Boundaries

- Do NOT change panel content/markup beyond className/style.
- Do NOT add Framer Motion or new dependencies.
- Do NOT animate `width` + `padding` together — if `padding` animation needed, keep but duration 200 max.
- If grid refactor conflicts with `flex-1` layout, keep minimal duration fix and document grid as follow-up instead of improvising.

## Verification

- **Mechanical**: `npm run typecheck --workspace=@openresearch/web` passes; grep for `duration-350` in SourcePanel/LeftNavigation returns 0; grep `will-change-\[width` returns 0.
- **Feel check**: Toggle SourcePanel (Ctrl+\) and LeftNavigation collapse 10x. In DevTools Performance > Rendering > Paint flashing, confirm no full-page relayout (if using transform/grid, only compositor lane). Check FPS stays 60, no jank on low-end device. Duration feels crisp (280ms vs previous 350ms sluggish).
- **Done when**: Both panels use `duration-280` + valid `will-change`, no `transition-[width,padding] duration-350`, and `will-change-[width]` gone.
