# 003 — Disable animation on GlobalSearchModal command palette (Ctrl+K)

- **Status**: TODO
- **Commit**: no-commit (working tree, zero commits)
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 2 files, 2 lines

## Problem

Command palette is triggered via Ctrl+K/Cmd+K (`apps/web/src/components/shell/WorkspaceLayout.tsx:60-62`) — highest frequency surface (100+ times/day power-user). Per AUDIT.md §1: "No animation. Ever." for keyboard shortcuts / command palette toggle. Raycast has none — correct.

Currently it animates 280ms with zoom+slide+fade, starting slow and blocking focus:

```tsx
// packages/ui/src/dialog.tsx:37 — current (DialogContent used by GlobalSearchModal)
'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border border-border-default bg-surface shadow-2xl duration-280 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 will-change-transform rounded-lg overflow-hidden',

// apps/web/src/components/modals/GlobalSearchModal.tsx:113 — current (DialogContent override)
<DialogContent className="sm:max-w-xl p-0 overflow-hidden top-[25%] translate-y-[-25%]">
```

Overlay also animates `duration-200` (`dialog.tsx:18`). Keyboard-initiated actions must not animate — they feel sluggish.

## Target

Instant open/close for this instance only — override animation to none, keep other dialogs animated.

```tsx
// target — GlobalSearchModal.tsx:113 override
<DialogContent className="sm:max-w-xl p-0 overflow-hidden top-[25%] translate-y-[-25%] data-[state=open]:animate-none data-[state=closed]:animate-none duration-0">
```

Alternatively, add `className` that cancels `animate-in/out`: `animate-none` with `duration-0`. For overlay, also pass `DialogOverlay` class override `duration-0` if needed, but minimal fix is content only.

If keeping subtle fade for comprehension, use `duration-80` + `--ease-out` cubic-bezier(0.23,1,0.32,1) opacity-only, but spec says delete.

## Repo conventions to follow

- Dialog tokens: `packages/tokens/src/tokens.css:56 --duration-instant: 80ms`, `--ease-out` should be `cubic-bezier(0.23,1,0.32,1)` per AUDIT.md §2 (add to tokens if missing — currently `--ease-spring` etc. but no `--ease-out`).
- Exemplar for instant dialog: none exists — this is first. Add override via `className` prop, not by editing `dialog.tsx` globally (other modals like ConfirmDialog should keep animation).
- Do NOT edit `packages/ui/src/dialog.tsx` globally — scope to GlobalSearchModal instance.

## Steps

1. Open `apps/web/src/components/modals/GlobalSearchModal.tsx:112-113`. Add to `DialogContent` `className` string: `data-[state=open]:animate-none data-[state=closed]:animate-none duration-0` (or `!animate-none` if specificity needed). Result: `className="sm:max-w-xl p-0 overflow-hidden top-[25%] translate-y-[-25%] data-[state=open]:animate-none data-[state=closed]:animate-none duration-0"`.
2. Optional: Also override overlay instant — add second prop to `Dialog` or wrap with custom overlay: `<DialogContent ...>` already portals overlay; to cancel overlay, check if `DialogContent` exposes overlay class — if not, add global CSS in `globals.css` for ` [data-radix-dialog-content][data-state]` but prefer className override only. If overlay still animates, add `DialogOverlay className="duration-0 data-[state=open]:animate-none"` via custom portal composition (create inline `<DialogPrimitive.Overlay className="...duration-0">` inside modal instead of using default).
3. Verify `apps/web/src/components/modals/ShortcutsModal.tsx` (?) similar keyboard modal `?` — leave for follow-up, but check if also high frequency.
4. Typecheck `npm run typecheck --workspace=@openresearch/web`.

## Boundaries

- Do NOT edit `packages/ui/src/dialog.tsx` default (other dialogs like PluginManagerModal, VersionHistoryModal keep animation).
- Do NOT change markup/structure beyond className.
- Do NOT add new dependencies.
- If `DialogContent` className merging via `cn` doesn't override `duration-280`, use `!duration-0` or add `style={{ animationDuration: '0ms' }}` as last resort — but prefer Tailwind `!` important.

## Verification

- **Mechanical**: `npm run typecheck --workspace=@openresearch/web` passes; grep `GlobalSearchModal` contains `animate-none`.
- **Feel check**: Press Ctrl+K — palette appears instantly, input focused with zero delay, no zoom/slide. Press Esc — disappears instantly. Spam Ctrl+K 10x rapidly — no animation queue, no flicker. Compare to regular Dialog (e.g., PluginManager via LeftNavigation) — those still animate 280ms, confirming scoped fix.
- **Done when**: GlobalSearchModal opens/closes with `duration-0`/`animate-none`, no 280ms delay.
