# 002 — Remove animation from per-keystroke ghost-text preview

- **Status**: TODO
- **Commit**: no-commit (working tree, zero commits)
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, 2 locations

## Problem

Ghost-text is ephemeral autocomplete triggered after a 700ms pause on every keystroke (`packages/editor/src/components/AcademicEditor.tsx:312`). It appears at cursor position and must feel instant, not animated. Currently it animates on every appearance, violating AUDIT.md §1 frequency rule: "100+ times/day (keyboard shortcuts, command palette toggle) → No animation. Ever." and §2 hover vs enter decision.

```ts
// packages/editor/src/extensions/ghostText.ts:47 — current
span.className =
  'ghost-text-preview font-serif text-[17px] text-text-tertiary select-none italic opacity-75 inline animate-in fade-in duration-120';
span.style.animationDelay = '0ms';
span.style.transitionTimingFunction = 'var(--ease-default)';

// packages/editor/src/extensions/ghostText.ts:58 — current (badge inside ghost text)
badge.className =
  'source-preview-badge ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent border border-accent/30 font-sans not-italic font-medium cursor-pointer hover:bg-accent/25 transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-px hover:shadow-2xs select-none inline-flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150';
```

Every ghost preview fades+zooms for 120-150ms, and badge adds another zoom. On fast typing this creates flicker and delays reading the suggestion.

## Target

Instant appearance — opacity-only if any transition needed, but no transform/zoom/slide. Keep hover micro-interaction for badge but gate it.

```ts
// target — ghost span, no animation
span.className =
  'ghost-text-preview font-serif text-[17px] text-text-tertiary select-none italic opacity-75 inline';
 // remove animate-in, fade-in, duration-120, animationDelay, transitionTimingFunction

// target — badge, keep hover but remove entrance animation, shorten to instant
badge.className =
  'source-preview-badge ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent border border-accent/30 font-sans not-italic font-medium cursor-pointer hover:bg-accent/25 transition-[background-color] duration-150 select-none inline-flex items-center gap-1';
 // remove animate-in fade-in zoom-in-95 duration-150, remove hover:-translate-y-px/hover:shadow-2xs if present
```

If a fade is desired for comprehension, use `transition-opacity duration-80` (maps to `--duration-instant` 80ms) with `ease-out` cubic-bezier(0.23,1,0.32,1), but prefer instant.

## Repo conventions to follow

- Tokens: `packages/tokens/src/tokens.css:56 --duration-instant: 80ms`, `--ease-default: cubic-bezier(0.2,0,0,1)`. If keeping opacity, use `duration-80`.
- Exemplar for instant disappearance: `packages/editor/src/extensions/ghostText.ts` clear logic already instant via DecorationSet.empty — keep that.
- Badge hover exemplar: `packages/editor/src/components/AcademicEditor.tsx` citation insertion — no entrance animation.

## Steps

1. In `packages/editor/src/extensions/ghostText.ts:46-47`, delete `animate-in fade-in duration-120` from ghost span `className`. Delete lines 48-49 `animationDelay` and `transitionTimingFunction` assignments (or leave timing if opacity kept).
2. In same file line 58, delete `animate-in fade-in zoom-in-95 duration-150` from badge `className`. Also remove `hover:-translate-y-px hover:shadow-2xs` and `transition-[transform,background-color,box-shadow]` → replace with `transition-[background-color] duration-150` (or `duration-80`).
3. Search for other `ghost-text` usages via `grep ghostText` — ensure `AcademicEditor.tsx` ghost timeout 700ms unchanged.
4. Typecheck: `npm run typecheck --workspace=@openresearch/editor`.

## Boundaries

- Do NOT change `createGhostTextSpan` signature or logic besides className.
- Do NOT change debounce 700ms in `AcademicEditor.tsx:331`.
- Do NOT add new dependencies or keyframes.
- If file lines drifted, STOP.

## Verification

- **Mechanical**: `npm run typecheck --workspace=@openresearch/editor` passes; `grep -n "animate-in.*ghost" packages/` returns 0.
- **Feel check**: Type fast in AcademicEditor, pause 700ms — ghost text appears instantly with no fade/slide, no flicker on subsequent keystrokes. Press Tab accepts instantly. Toggle `prefers-reduced-motion` — no difference (already instant). Badge still shows but without zoom.
- **Done when**: ghostText.ts contains zero `animate-in`/`duration-` for ghost span, badge entrance animation removed.
