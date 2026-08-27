# Animation Improvement Plans — OpenResearch

Generated from `improve-animations` audit (standard effort). Commit: `no-commit` (zero commits, working tree).

## Stack & Conventions (Recon)

- **Framework**: Next.js 16.3 + React 19 + Tailwind 3.4 + `tailwindcss-animate` 1.0.7 (now installed & active — previous H-1 fixed)
- **Motion libraries**: None (no Framer Motion/GSAP/Spring) — all CSS via Tailwind `animate-in` + custom keyframes in `apps/web/src/app/globals.css:36-101`
- **Tokens**: `packages/tokens/src/tokens.css:55-71` defines `--duration-*` (80/150/200/280/350ms), `--ease-*` (default/spring/emphasized/in), `--scale-*`, `--blur-*`. Tailwind maps subset in `apps/web/tailwind.config.js:55-82`
- **Reduced-motion** guard exists: `globals.css:133-140` nukes duration to 0.01ms (slightly over-aggressive, see #12)
- **Personality**: Crisp academic dashboard (restrained, serif, 280ms spring max) — not playful/bouncy
- **Frequency map**: Ctrl+K palette / Ctrl+/ continuation / ghostText = 100+/day → no animation; hover/selection = tens/day → minimal; dialogs/drawers/toasts = occasional → standard 200-280ms; bibliography highlight = rare → can delight

## Plans

| # | Plan | Severity | Category | Status | Leverage | Depends on |
|---|------|----------|----------|--------|----------|------------|
| 001 | Fix `transition-all` in TabsTrigger | HIGH | Performance | TODO | ★★★★★ | — |
| 002 | Remove ghost-text per-keystroke animation | HIGH | Purpose & frequency | TODO | ★★★★★ | — |
| 003 | Disable animation on Ctrl+K command palette | HIGH | Purpose & frequency | TODO | ★★★★☆ | — |
| 004 | Fix width layout thrash on SourcePanel & LeftNavigation | HIGH | Performance | TODO | ★★★★☆ (high impact, med effort) | — |
| 005 | Gate hover motion for touch + remove permanent will-change | MEDIUM | Accessibility & Performance | TODO | ★★★★☆ | — |

## Recommended Execution Order

1. **001** (XS, zero risk) → 2. **002** (XS) → 3. **003** (XS, scoped) → 4. **005** (S, touches many files but mechanical) → 5. **004** (M, layout refactor — do last, after quick wins land).

All plans are independent — can be executed in parallel except 005 and 004 both touch `SourcePanel`/`LeftNavigation` className, so sequence them or coordinate conflicts.

## Dependencies

- 004 provides `duration-280` + `will-change` cleanup that 005 also touches — run 005 second or merge overlapping lines manually.
- 003 scopes to `GlobalSearchModal.tsx` only — no conflict with dialog defaults.
- Tokens consolidation (finding #9) is deferred — not planned, recommend follow-up to map `tailwind.config.js` durations to `tokens.css`.

## Remaining Findings (Not Yet Planned)

| # | Severity | Category | Location | Finding | Fix |
|---|----------|----------|----------|---------|-----|
| 006 | MEDIUM | Physicality | popover.tsx:20, dropdown-menu.tsx:41 etc. | Missing `transform-origin` per side | Add `origin-[--radix-*-content-transform-origin]` |
| 007 | MEDIUM | Easing | dialog.tsx:37 | Content close 280ms symmetric, should be 180-200 ease-out | Set `data-[state=closed]:duration-180` |
| 010 | LOW | Interruptibility | AiResearchChat.tsx:463 | Keyframe bubbles restart on rapid stream | Use transition opacity only while streaming |
| 011 | LOW | Cohesion | ResearchLibrary.tsx:425 etc. | Stagger up to 320ms blocks last items | Cap `Math.min(idx*30,120)` |
| 012 | LOW | Accessibility | globals.css:133 | Reduced-motion nukes opacity feedback | Preserve opacity/color 150ms |

Run `improve-animations plan <description>` to generate plan for any deferred item.
