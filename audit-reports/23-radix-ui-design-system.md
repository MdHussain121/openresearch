# Radix UI Design System Audit — OpenResearch Monorepo

**Audit type:** READ-ONLY component-architecture audit (no files modified)
**Scope:** `apps/web/src/components/**`, `apps/web/src/app/**`, `packages/ui`, `packages/tokens`, plus primitive usage inside `packages/editor`
**Skill applied:** radix-ui-design-system (audit mode)
**Date:** 2026-08-26
**Auditor:** ox-alpha

---

## Fact Check: Current Stack (Radix present y/n)

### Verdict: ✅ **RADIX UI IS PRESENT** — declared and consumed, but adoption is partial and inconsistent

**Evidence — direct dependency declarations:**

`packages/ui/package.json` (lines 11–24):
```json
"dependencies": {
    "@openresearch/tokens": "*",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-popover": "^1.1.1",
    "@radix-ui/react-select": "^2.1.1",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.378.0",
    "tailwind-merge": "^2.3.0"
}
```

**Evidence — source imports (all verified):**

| File | Radix import |
|---|---|
| `packages/ui/src/dialog.tsx:2` | `import * as DialogPrimitive from '@radix-ui/react-dialog'` |
| `packages/ui/src/dropdown-menu.tsx:2` | `@radix-ui/react-dropdown-menu` |
| `packages/ui/src/popover.tsx:2` | `@radix-ui/react-popover` |
| `packages/ui/src/select.tsx:2` | `@radix-ui/react-select` |
| `packages/ui/src/tabs.tsx:2` | `@radix-ui/react-tabs` |
| `packages/ui/src/tooltip.tsx:2` | `@radix-ui/react-tooltip` |
| `packages/ui/src/button.tsx:2` | `{ Slot } from '@radix-ui/react-slot'` |

**Evidence — resolution:** `package-lock.json` contains the full hoisted Radix dependency tree (`node_modules/@radix-ui/react-dialog` at line 1819, `react-dropdown-menu` at 1898, `react-popover` at 2025, `react-popper` at 2062, plus internal deps `react-dismissable-layer`, `react-focus-scope`, `react-focus-guards`, `react-portal`, `react-presence`, `react-roving-focus`, etc.).

**Evidence — consumption:** 18 import sites use `'@openresearch/ui'`: all 13 modals, `TopBar.tsx:19–29`, `WorkspaceLayout.tsx:15`, `SourcePanel.tsx:32`, `IntelligenceView.tsx:4–9`, and `packages/editor/src/components/EditorToolbar.tsx:41–54`.

**Architecture shape:** This is a **shadcn/ui-style two-layer system**: raw `@radix-ui/*` deps are confined to `packages/ui`; `apps/web/package.json` correctly declares *no* direct Radix dependencies (apps/web/package.json:12–23). The app consumes only the styled wrapper package. This layering is correct and should be preserved.

**Notable ABSENCE despite presence:** `tailwindcss-animate` (or equivalent) is **not installed anywhere** (root, apps/web, packages/* — zero matches in any `package.json`), yet the entire animation class surface of the UI package depends on it. See Finding H-1. Also absent: any `@radix-ui/themes` or shadcn CLI scaffolding (fine — hand-rolled wrappers are cleaner for this repo).

---

## Component Inventory Table

### `packages/ui` — shared component package (8 exported components)

| Component | File | LOC | Props shape | State | Composition style | Built on |
|---|---|---|---|---|---|---|
| `Button` | `button.tsx` | 51 | `ButtonHTMLAttributes` + `cva` variants (`variant`×6, `size`×5) + `asChild` | n/a (uncontrolled native) | Single-part, polymorphic via Slot | `@radix-ui/react-slot` + cva |
| `Badge` | `badge.tsx` | 34 | `HTMLAttributes<HTMLDivElement>` + `variant`×10 via cva | n/a | Single-part, **no `asChild`** | cva only |
| `Dialog` family | `dialog.tsx` | 101 | Re-export Root/Trigger/Portal/Close verbatim; styled Overlay/Content/Header/Footer/Title/Description; `hideClose?: boolean` extension on Content | Controlled/uncontrolled via Radix Root | **Compound** (10 parts) | `@radix-ui/react-dialog` |
| `DropdownMenu` family | `dropdown-menu.tsx` | 171 | Re-export 6 parts verbatim; styled Content/Item/CheckboxItem/RadioItem/Label/Separator/SubTrigger/SubContent/Shortcut (+`inset?`) | Via Radix | Compound (13 parts) | `@radix-ui/react-dropdown-menu` |
| `Select` family | `select.tsx` | 141 | Re-export Root/Group/Value; styled Trigger/Content/Item/Label/Separator/ScrollButtons; `position='popper'` default | Via Radix | Compound (10 parts) | `@radix-ui/react-select` |
| `Tabs` family | `tabs.tsx` | 50 | Re-export Root; styled List/Trigger/Content | Controlled/uncontrolled via Radix | Compound (4 parts) | `@radix-ui/react-tabs` |
| `Tooltip` family | `tooltip.tsx` | 25 | Re-export Provider/Root/Trigger; styled Content (`sideOffset=4`) | Via Radix | Compound (4 parts) | `@radix-ui/react-tooltip` |
| `Popover` family | `popover.tsx` | 27 | Re-export Root/Trigger/Anchor/Close; styled Content (`align='center'`, `sideOffset=4`) | Via Radix | Compound (5 parts) | `@radix-ui/react-popover` |
| `cn` util | `utils.ts` | 6 | `(...ClassValue[]) => string` | n/a | — | clsx + tailwind-merge |
| Tests | `utils.test.ts`, `button.dom.test.tsx` | — | — | — | vitest + DOM tests exist | ✅ positive |

### `packages/editor` — editor-scoped presentation components

| Component | File | LOC | Notes |
|---|---|---|---|
| `EditorToolbar` | `components/EditorToolbar.tsx` | 627 | ⚠️ God-component; correctly consumes DropdownMenu/Popover/Tooltip from `@openresearch/ui` |
| `AcademicEditor` | `components/AcademicEditor.tsx` | — | Tiptap host |
| `CitationPopover` | `components/CitationPopover.tsx` | 201 | ❌ **Hand-rolled combobox/popover** — see A11y Audit |
| `AIContinuationCard` | `components/AIContinuationCard.tsx` | — | Presentation card |
| `AIEditReviewCard` | `components/AIEditReviewCard.tsx` | — | Presentation card |

### `apps/web/src/components` — 38 components (LOC measured)

| Domain | Component | LOC | >300? | Consumes `@openresearch/ui`? | Controlled? |
|---|---|---|---|---|---|
| reader | `PdfReader.tsx` | 783(844 phys) | 🔴 GOD | ❌ **hand-rolls modal** | 15+ local `useState` |
| chat | `AiResearchChat.tsx` | 599(659) | 🔴 GOD | ❌ hand-rolled tabs + div-checkboxes | local state |
| views | `SettingsView.tsx` | 552(589) | 🔴 GOD | ❌ native selects/checkboxes | mixed |
| intelligence | `ResearchGraphView.tsx` | 500 | 🔴 GOD | ❌ SVG hardcoded colors | local |
| library | `ResearchLibrary.tsx` | 489(524) | 🔴 GOD | ❌ hand-rolled tabs | local |
| intelligence | `LiteratureMatrixView.tsx` | 477 | 🔴 GOD | ❌ | local |
| intelligence | `ResearchGapAssistantView.tsx` | 435 | 🔴 GOD | ❌ | local |
| modals | `TeamModal.tsx` | 413 | 🔴 GOD | ✅ Dialog + native `<select>`×2 | `isOpen/onClose` |
| shell | `SourcePanel.tsx` | 391 | 🔴 GOD | ✅ Tabs + native `<select>` | controlled via props |
| library | `OnlineSearchPanel.tsx` | 375 | 🔴 GOD | ❌ | local |
| modals | `AiOutlineModal.tsx` | 356 | 🔴 GOD | ✅ Dialog | `isOpen/onClose` |
| modals | `ExportModal.tsx` | 342 | 🔴 GOD | ✅ Dialog + native select | `isOpen/onClose` |
| citations | `CitationsManager.tsx` | 340 | 🔴 GOD | ❌ native select | local |
| intelligence | `PaperReviewView.tsx` | 331 | 🔴 GOD | ❌ native selects×2 | local |
| modals | `PluginManagerModal.tsx` | 321 | 🔴 GOD | ✅ Dialog | `isOpen/onClose` |
| modals | `VersionHistoryModal.tsx` | 284 | — | ✅ Dialog | `isOpen/onClose` |
| comments | `CommentsPanel.tsx` | 283(306) | — | ❌ slide-in panel, hardcoded palette | `isOpen/onClose` |
| modals | `ZoteroImportModal.tsx` | 254 | — | ✅ Dialog+Tabs | `isOpen/onClose` |
| modals | `BibtexModal.tsx` | 242 | — | ✅ Dialog+Tabs | `isOpen/onClose` |
| views | `DocumentsView.tsx` | 235 | — | ❌ | local |
| modals | `AddByIdentifierModal.tsx` | 206 | — | ✅ Dialog | `isOpen/onClose` |
| modals | `ProviderQuotaModal.tsx` | 199 | — | ✅ Dialog | `isOpen/onClose` |
| shell | `TopBar.tsx` | 199 | — | ✅ DropdownMenu+Tooltip | prop callbacks |
| shell | `LeftNavigation.tsx` | 198(209) | — | ❌ (uses ConfirmDialog only) | prop callbacks |
| shell | `WorkspaceLayout.tsx` | 179(192) | — | ✅ TooltipProvider | context-driven |
| modals | `GlobalSearchModal.tsx` | 170(186) | — | ✅ Dialog, **hand-rolled listbox** | controlled |
| intelligence | `ClaimVerificationInspector.tsx` | 166 | — | ❌ | local |
| modals | `ShortcutsModal.tsx` | 146 | — | ✅ Dialog | `isOpen/onClose` |
| modals | `ProjectModal.tsx` | 104 | — | ✅ Dialog | `isOpen/onClose` |
| shell | `ModalContainer.tsx` | 98 | — | hosts 12 modals | context |
| views | `IntelligenceView.tsx` | 94 | — | ✅ **Radix Tabs (model citizen)** | controlled Tabs |
| shell | `AIWritingFloatingOverlay.tsx` | 89 | — | ❌ | **24 props drilled in** |
| modals | `ConfirmDialog.tsx` | 62 | — | ✅ Dialog wrapper (model citizen) | `isOpen/onCancel` |
| views | `LibraryView.tsx` | 36 | — | router shim | — |
| shell | `ViewHeader.tsx` | 28 | — | presentational | — |
| views | `ChatView.tsx` | 24 | — | router shim | — |
| views | `CitationsView.tsx` | 20 | — | router shim | — |

### Page composition (`apps/web/src/app`)

- `layout.tsx` — root: fonts (`--font-sans/serif/mono`), pre-paint theme script, `data-theme="light"` SSR default.
- `(workspace)/layout.tsx` — provider stack `Auth → Project → Document → Paper → Workspace` wrapping persistent `WorkspaceLayout`.
- Route pages (`documents`, `library`, `citations`, `intelligence`, `chat`, `settings`) are thin shims rendering one View each — clean composition, shell never remounts.
- `page.tsx` (root) redirects into workspace.

**God-component count (app, >300 LOC): 15** (+ `EditorToolbar` 627 in editor package = 16 total).
**Prop-drilling depth hotspots:** `AIWritingFloatingOverlay` (24 props through `WorkspaceLayout`), `LeftNavigation` (10 props), `SourcePanel` (9 props) — all drilled from `WorkspaceLayout` even though every value originates in `WorkspaceContext`, which these children could consume directly.

---

## Executive Summary

The repo has a genuinely good Radix foundation that is undermined by incomplete rollout and one broken build-level dependency.

| Severity | Count | Headline items |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 5 | Dead animations (missing plugin); hand-rolled inaccessible modal in PdfReader; keyboard-unreachable CitationPopover options; keyboard-unreachable sidebar document rows; hand-rolled tabs without keyboard interaction |
| MEDIUM | 9 | Native `<select>` ×9 while Select wrapper ships unused; token drift TS↔CSS; dark-mode-breaking hardcoded SVG colors; toast a11y gaps; global key interception in search/listbox; 24-prop drilling; missing radiogroup semantics; hardcoded palette colors; div-checkboxes |
| LOW | 7 | Invalid `py-0.2` classes; Badge lacks `asChild`; `window.alert` error UX; color-name aliasing trap; unconditional modal hosting; Button loading-state gap; EditorToolbar god-file |
| INFO | 6 | Correct package direction, pre-paint theme script, density tokens, model-citizen components, tests present, TooltipProvider placement |

**One-line verdict:** Radix is present and well-wrapped in `packages/ui`, but ~40% of interactive surface area bypasses it with hand-rolled implementations whose accessibility quality is dramatically worse than the wrapped ones sitting right next to them in the codebase.

---

## Hand-Rolled Primitive A11y Audit (pattern → requirements met/missing → file:line)

Legend: ✅ met · ⚠️ partial · ❌ missing

### 1. Dialog / Modal

**Wrapped (correct) instances:** All 13 modals in `apps/web/src/components/modals/*` + `ConfirmDialog.tsx` route through `@openresearch/ui` Dialog (Radix). Verified exemplary: `ConfirmDialog.tsx:38–64` (Title + Description + Footer + destructive variant), `GlobalSearchModal.tsx:112–117` (sr-only Title/Description when visual header absent).

| Requirement | Status | Evidence |
|---|---|---|
| Portal to body | ✅ (wrapped) | `packages/ui/src/dialog.tsx:32` |
| `role="dialog"` + `aria-modal` | ✅ Radix internal | — |
| Focus trap | ✅ Radix internal | — |
| Escape closes | ✅ Radix internal | — |
| Outside-click dismiss | ✅ Radix internal | — |
| Focus restoration to trigger | ✅ Radix internal | — |
| Required `Title` | ✅ everywhere checked | ConfirmDialog.tsx:43; GlobalSearchModal.tsx:114 |
| Scroll lock | ✅ Radix `react-remove-scroll` | via lockfile tree |

**❌ HAND-ROLLED EXCEPTION — `apps/web/src/components/reader/PdfReader.tsx:746–839` ("Selection-Anchored AI Q&A Modal"):**

```tsx
{showAiModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
```

| Requirement | Status | Missing evidence |
|---|---|---|
| `role="dialog"` / `aria-modal="true"` | ❌ | plain `<div>` at line 747 — invisible to AT as a dialog |
| Focus trap | ❌ | no focus management whatsoever; Tab walks into background PDF chrome |
| Escape closes | ❌ | zero `Escape` handlers in file (grep: only `useState/useEffect` hits); only close path is clicking ✕ |
| Focus moved into dialog on open | ❌ | no autofocus of input at line 787 |
| Focus restored on close | ❌ | — |
| Accessible name | ❌ | header span at line 752 is decorative text, not programmatically associated |
| Close button label | ❌ | line 754 `<button onClick={...}><X/></button>` — icon-only, no `aria-label` |
| Overlay click dismiss | ❌ | overlay div has no onClick |
| Portal | ❌ | rendered inline within reader stacking context (z-fighting risk) |

Same anti-pattern applies to the annotation note-editor overlay in the same file (`showNoteEditor` block) — both must migrate to `Dialog`.

### 2. Dropdown Menu

✅ **No hand-rolls found.** `TopBar.tsx:85–129` project switcher uses full compound API (`asChild` trigger, Label, Separator, Item). `EditorToolbar.tsx` likewise. Keyboard matrix, typeahead, roving focus, collision handling all inherited from Radix. Minor: active-project checkmark is a manual `<Check/>` (TopBar.tsx:109) instead of `CheckboxItem`/`RadioGroup.ItemIndicator` — cosmetic duplication, not an a11y defect since selection is conveyed by styling only (see M-15 note below: selected state not exposed via `aria-checked`).

### 3. Tabs

**Wrapped (correct) instances:** `IntelligenceView.tsx:45–98`, `SourcePanel.tsx:196–412`, `BibtexModal.tsx:162–260`, `ZoteroImportModal.tsx:135–269` — all use Radix Tabs with proper `value/onValueChange`.

**⚠️/❌ HAND-ROLLED instance #1 — `AiResearchChat.tsx:260–324` (4-mode segmented control):**

```tsx
<div role="tablist" aria-label="AI Chat Modes" className="grid grid-cols-4 ...">
  <button role="tab" aria-selected={activeMode === 'document'} onClick={() => handleModeChange('document')} ...>
```

| Requirement | Status | Missing evidence |
|---|---|---|
| `role="tablist"` / `role="tab"` / `aria-selected` | ✅ | lines 261, 266–267, 281–282, 296–297, 311–312 |
| Arrow-key navigation between tabs | ❌ | no onKeyDown on any tab; Tab key cycles 4 stops instead of 1 tab stop + arrows |
| Roving `tabIndex` (only active tab tabbable) | ❌ | all four tabs are natural tab stops |
| `id` ↔ `aria-controls` linkage | ❌ | no ids, no aria-controls |
| `role="tabpanel"` on content | ❌ | mode content below (lines 326+) is plain divs |
| Automatic vs manual activation documented | n/a | — |

**⚠️/❌ HAND-ROLLED instance #2 — `ResearchLibrary.tsx:256–283` (Library/Online tabs):** identical defects — `role="tablist"/"tab"` + `aria-selected` present (258–259, 271–272); no arrow keys, no roving tabindex, no tabpanel role/id linkage.

Also unexamined-but-flagged: `CommentsPanel.tsx:134` "Filter Tabs" and `PaperReviewView.tsx:249` "Filter Tabs" comments suggest further segmented controls; `PdfReader.tsx:440` "Panel Tabs" (`activeTab` state at line 52) — same hand-roll family.

### 4. Select / Listbox / Combobox

**Shipped-but-unused wrapper:** `packages/ui/src/select.tsx` (full Radix Select, 141 LOC, popper positioning, scroll buttons, ItemIndicator) — **zero consumers in apps/web** (grep confirms). Instead:

Native `<select>` used in 9 locations (acceptable baseline a11y — native elements are accessible by default — but stylistically inconsistent, unthemeable option lists, and breaks the design-system story):

| Site | file:line |
|---|---|
| Citation style picker | `CitationsManager.tsx:153` |
| Hourly cap | `SettingsView.tsx:284` |
| Paper picker (document chat mode) | `AiResearchChat.tsx:331` |
| Review filters ×2 | `PaperReviewView.tsx:123`, `:276` |
| Source panel selector | `SourcePanel.tsx:331` |
| Export format/style | `ExportModal.tsx:217` |
| Team member role ×2 | `TeamModal.tsx:326`, `:377` |

**❌ HAND-ROLLED combobox — `packages/editor/src/components/CitationPopover.tsx` (entire file, decisive lines):**

| Requirement | Status | Evidence |
|---|---|---|
| Trigger/results association (`aria-expanded`, `aria-controls`, combobox pattern) | ❌ | container div (105–111) has no role; nothing announces "list with N results" |
| `role="listbox"` on results container | ❌ | line 125 plain div |
| Options focusable or `aria-activedescendant` | ❌ | options are `<div onClick onMouseEnter>` at 135–141 — **keyboard users cannot reach any result except via the window-level arrow handler; screen readers see nothing** |
| Selection announcement | ❌ | highlight is purely visual (`bg-accent/10 border-l-2`) |
| Portal | ❌ | fixed-positioned inline (105–110); clipping risk inside editor overflow contexts |
| Escape/outside-click dismissal | ⚠️ half | Escape handled via window listener (92–95); **outside-click has NO handler** — `containerRef` (line 29) is declared but never wired to a mousedown listener; popover stays open after clicking away |
| Global key interception safety | ❌ | window-level `keydown` (98) intercepts ArrowUp/Down/Enter app-wide while open; Enter `preventDefault` (88) suppresses activation of any other focused control |
| Positioning flip/collision | ⚠️ | manual clamp only against right edge (line 109); no top/bottom flip |

**⚠️ PARTIAL hand-rolled listbox — `GlobalSearchModal.tsx`:**

| Requirement | Status | Evidence |
|---|---|---|
| `role="listbox"` / `role="option"` / `aria-selected` | ✅ | 133, 143–144 |
| Arrow navigation + Enter select | ✅ | window handler 85–104 |
| `aria-activedescendant` linking input→highlighted option | ❌ | highlighted index lives only in React state; SR users get no "3 of 20" cue |
| Options tabbable / focus managed into list | ⚠️ | options are `<button>`s (good instinct) but keyboard flow is hijacked globally: Enter pressed on ANY focused element while open triggers the highlighted row (91–103) — e.g., Tab to footer kbd then Enter fires navigation instead |
| Type-ahead | ❌ | typing goes to input which re-filters — acceptable substitute given combobox-as-dialog layout |

### 5. Tooltip

✅ No hand-rolls. `TooltipProvider delayDuration={200}` once at `WorkspaceLayout.tsx:87`; consumers `TopBar.tsx:177–204` with `asChild` triggers and `aria-label` fallbacks. Icon-only buttons correctly carry `aria-label` (183, 198).

### 6. Popover

✅ Wrapped usage in `EditorToolbar.tsx` (link/table inserters). ❌ `CitationPopover` (above) is the outlier despite sharing a name with the primitive it reimplements.

### 7. Toast / Notification

**❌ HAND-ROLLED — `WorkspaceLayout.tsx:180–188`:**

```tsx
{toastMessage && (
  <div className="fixed bottom-6 right-6 z-50 ... animate-in fade-in slide-in-from-bottom-2 duration-150">
    ...
    <button onClick={clearToast} ...>✕</button>
```

| Requirement | Status | Evidence |
|---|---|---|
| Announced to AT (`role="status"`/`alert` on the toast itself) | ❌ | toast div has no live-role; the separate sr-only region at 175–177 carries different content (`w.srAnnouncement`) so toasts go unannounced unless dual-pumped through WorkspaceContext |
| Timed auto-dismiss | ❌ | manual clear only |
| Dismiss button accessible name | ❌ | literal `✕` character, no `aria-label` |
| Hover-pause/stacking | ❌ | single-slot state (`toastMessage` string) — new toast overwrites old |

### 8. Checkbox / Switch / RadioGroup / ToggleGroup

| Instance | Status | Evidence |
|---|---|---|
| Settings toggles (ghost text, autocomplete, tabby) | ✅ native `<input type="checkbox">` — fine, though unstyled | `SettingsView.tsx:255–260, 307–327` |
| Latency tier fast/moderate/slow | ❌ semantic radiogroup missing: three independent `<button>`s, no `role="radiogroup"`, no `aria-checked`/`role="radio"` | `SettingsView.tsx:265–279` |
| Chat library multi-paper filter | ❌ clickable `<div>` with icon-swap checkbox mimicry; no input, no `aria-checked`, not keyboard operable, nested in non-interactive div | `AiResearchChat.tsx:363–380` |

---

## Styling & Theming Architecture Findings

**Variants strategy:** `cva` is used in exactly 2 of 8 ui-package components (`button.tsx`, `badge.tsx`). Everything else is inline ternary template strings — e.g., duplicated four-way `activeMode === 'x' ? ... : ...` blocks repeated verbatim across `AiResearchChat.tsx:269–322`. A `segmentedControlVariants` cva or ToggleGroup primitive would delete ~60 lines.

**`cn()` discipline:** correct clsx+twMerge implementation (`packages/ui/src/utils.ts:4–6`); consistently used inside the package. App-side components mostly use raw ternaries instead of `cn` — inconsistent but harmless.

**Token pipeline:** `packages/tokens/src/tokens.css` (CSS custom properties, light/dark/density) → imported first in `globals.css:1` → mapped into `tailwind.config.js` theme.extend.colors (`canvas/surface/sunken/text-*/border-default/accent/trust-*`). Semantic naming (trust-grounded/inference/warning) is a genuine strength for this product domain. Layout dims (`--sidebar-width` etc.) consumed directly via arbitrary values (`w-[var(--sidebar-width)]`, `h-[var(--header-height)]` TopBar.tsx:57).

**Token adoption rate:** very high in TSX (hex grep across all app components returned matches ONLY in `ResearchGraphView.tsx`) — but that one file is fully hardcoded, including colors that don't exist in the token set.

### 🐛 Token drift (single-source-of-truth violation)

`packages/tokens/src/index.ts` (TS constants) disagrees with `packages/tokens/src/tokens.css`:

| Token | index.ts (light/dark) | tokens.css (light/dark) |
|---|---|---|
| `textTertiary` | `#8A8985` / `#6E6D68` | `--text-tertiary: #706F6A` / `#918F8A` |

Everything else matches. Two sources of truth will drift again; TS copy appears to be stale v1 values.

### Hardcoded color inventory

| Location | Values | Impact |
|---|---|---|
| `ResearchGraphView.tsx:280` | `#8A8985` marker fill | static gray, survives dark mode poorly |
| `ResearchGraphView.tsx:300,315,330` | `#2C5F4A`, `#E4E2DE` stroke | light-theme accent/border baked in → invisible borders on dark canvas `#17171A` |
| `ResearchGraphView.tsx:316` | `#3B82F6` (author nodes) | **not a token at all** (Tailwind blue-500) |
| `ResearchGraphView.tsx:317` | `#D97706` (topic nodes) | **not a token** (Tailwind amber-600) |
| `ResearchGraphView.tsx:330` | `#FFFFFF` selected stroke | white ring on light background = invisible |
| `CommentsPanel.tsx:245` | `text-green-600` | off-token success color (token: `trust-success #3A7D5C`) |
| `CommentsPanel.tsx:253` | `text-red-500` | off-token danger (token: `trust-danger #B33A3A`) |

SVG fills can't use Tailwind classes directly, but `fill="var(--accent-primary)"` works perfectly in JSX — the fix is mechanical.

### Theming mechanism completeness

- ✅ `[data-theme="dark"]` attribute strategy; `darkMode: ['class', '[data-theme="dark"]']` (tailwind.config.js:7).
- ✅ Pre-paint inline script prevents FOUC (`app/layout.tsx:30–40`) executed via `next/script beforeInteractive` (line 57) with system-preference fallback and try/catch.
- ✅ Runtime sync in `WorkspaceContext.tsx:353`; density mode `[data-density="compact"]` also wired (365) and honored by tokens.css:74–78.
- ✅ Dark values defined for every token (tokens.css:51–72).
- ⚠️ Gap: anything reading TS constants (`index.ts`) rather than CSS vars cannot theme — currently only affects potential future consumers; runtime components read vars. The real dark-mode bug is the hardcoded SVG set above.

---

## Package Boundary Findings

**Import direction graph (verified, no violations):**

```
apps/web ──────────► @openresearch/ui ──► @openresearch/tokens
   │                                   └──► @radix-ui/*, cva, clsx, tailwind-merge, lucide-react
   ├──► @openresearch/editor ──► @openresearch/ui, citations, ai, tokens, tiptap
   └──► ai, citations, plugins, tokens
packages/ui imports: nothing internal beyond tokens ✓ (grep: no '../', no 'apps/')
```

No reverse imports (ui→web, tokens→anything) exist. Boundary hygiene is excellent.

**Findings:**

1. **Tailwind theme ownership inverted (MEDIUM):** the color↔CSS-var mapping lives in `apps/web/tailwind.config.js:10–33`, while `content` globs include `../../packages/*/src/**` (lines 3–6). Consequence: `packages/ui` and `packages/editor` emit classes (`bg-accent`, `text-trust-danger`) that are meaningless unless the consuming app happens to define them. Works today because there's exactly one Tailwind app, but the design-system contract should be a **shared Tailwind preset** shipped from `packages/tokens` (`presets: [require('@openresearch/tokens/tailwind.preset')]`), making ui/editor self-describing.
2. **Presentation components in `packages/editor` (MEDIUM):** `CitationPopover` (201 LOC), `AIContinuationCard`, `AIEditReviewCard` are pure UI with zero Tiptap coupling — they belong in `packages/ui` (or a `packages/ui/ai-cards` entry point) where they'd inherit testing infrastructure and be reusable by the chat view, which duplicates similar cards.
3. **App-local components that should graduate to `packages/ui` (MEDIUM):** `ConfirmDialog` (generic confirm pattern, 62 LOC — canonical design-system candidate), `ViewHeader` (28 LOC page-header pattern used by every view), the toast, and the segmented-control/tabs patterns.
4. **Correctly placed:** all 13 feature modals in `apps/web/components/modals` — they orchestrate app contexts and APIs; keeping them out of the shared package is right. `ModalContainer` as single host keyed off `WorkspaceContext.modals` is a sound pattern.
5. **`@openresearch/plugins`, `browser-extension`** declare no UI deps — no boundary concerns.

---

## Detailed Findings

Format: `[SEVERITY] ID — title · location · evidence · fix`

---

### HIGH

**[HIGH] H-1 — Every Radix animation class in the codebase is a silent no-op: `tailwindcss-animate` is not installed**
- **Where:** `packages/ui/src/dialog.tsx:18,37` · `dropdown-menu.tsx:41,58` · `popover.tsx:20` · `select.tsx:73` · `tooltip.tsx:18`; app usages `AiResearchChat.tsx:245`, `WorkspaceLayout.tsx:181`, `packages/editor/src/components/CitationPopover.tsx:111`
- **Evidence:** classes like `data-[state=open]:animate-in data-[state=closed]:fade-out-0 zoom-in-95 slide-in-from-top-2` are generated exclusively by the `tailwindcss-animate` plugin; `apps/web/tailwind.config.js:54` declares `plugins: []` and grep for `tailwindcss-animate|tw-animate` across all ten `package.json` files returns nothing.
```js
// dropdown-menu.tsx:58 (never animates)
'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ...'
```
- **Impact:** all dialogs/menus/popovers/selects/tooltips snap open/closed with no transition — dead weight in 6 shipped components; misleading code review signal.
- **Fix:** `npm i -D tailwindcss-animate` in `apps/web`; register `plugins: [require('tailwindcss-animate')]`. Verify `data-[state]` variants begin emitting. Effort XS.

**[HIGH] H-2 — Hand-rolled modal in PdfReader violates every WAI-ARIA dialog requirement**
- **Where:** `apps/web/src/components/reader/PdfReader.tsx:746–839` (AI Q&A modal); same pattern in the note-editor overlay (`showNoteEditor`)
- **Evidence:** plain `fixed inset-0` divs; no role/aria-modal/focus-trap/Esc/focus-restore/portal; unlabeled icon-only close button (754); zero Escape handlers in the whole 844-line file.
- **Impact:** screen-reader users never learn a modal opened; keyboard users are trapped in background scroll order behind a visually-modal layer; WCAG 2.1 AA failures (2.4.3, 4.1.2, 1.4.13-adjacent).
- **Fix:** replace with existing `<Dialog open onOpenChange><DialogContent>` from `@openresearch/ui` — the exact component 13 sibling files already use. Effort S for both overlays.

**[HIGH] H-3 — CitationPopover results are unreachable/invisible to keyboard and assistive tech**
- **Where:** `packages/editor/src/components/CitationPopover.tsx:125–166` (options), `:98–100` (global listener), `:29` (dead ref)
- **Evidence:** options are `<div onClick onMouseEnter>` — no tabindex, no roles, no `aria-activedescendant`; selection conveyed visually only; outside-click never dismisses (`containerRef` unused); window-level Enter interception (87–90) can swallow activations elsewhere.
- **Impact:** citation insertion — arguably the core interaction of an academic writing tool — is mouse-only for AT users; WCAG 2.1.1/4.1.2 failure.
- **Fix:** rebuild on `Popover` + `Command` (cmdk) or minimally add `role="combobox"`/`role="option"` + `aria-activedescendant` + outside-click dismiss. Full guidance in Migration Plan step 4. Effort M.

**[HIGH] H-4 — Sidebar document rows are mouse-only**
- **Where:** `apps/web/src/components/shell/LeftNavigation.tsx:124–147`
- **Evidence:**
```tsx
<div key={doc.id} onClick={() => setActiveDocument(doc)} className={`group flex ... cursor-pointer ...`}>
```
Clickable div: not in tab order, no Enter/Space handling, no role; the nested delete `<button>` (136) inherits an unfocusable parent context for AT narration ("clickable" nothing).
- **Fix:** swap outer div for `<button className="w-full text-left">` (with inner delete button relocated beside, or use `role="listitem"`+buttons). Effort XS.

**[HIGH] H-5 — Two hand-rolled tab sets ship without keyboard interaction alongside four correct Radix tab sets**
- **Where:** `AiResearchChat.tsx:260–324`; `ResearchLibrary.tsx:256–283` (plus same-family suspects `PdfReader.tsx:440`, `CommentsPanel.tsx:134`, `PaperReviewView.tsx:249`)
- **Evidence:** ARIA roles copied (`tablist/tab/aria-selected`) but behavior isn't: no Arrow/Home/End handling, no roving tabIndex, no tabpanel role or id/aria-controls linkage → violates the ARIA Authoring Practices tabs pattern (roles promise keyboard contract the component doesn't deliver — worse than no roles).
- **Fix:** replace with `Tabs/TabsList/TabsTrigger/TabsContent` from `@openresearch/ui` (pattern proven in `IntelligenceView.tsx:45–64`). Effort S for both.

### MEDIUM

**[MEDIUM] M-6 — Nine native `<select>`s while a full Radix Select wrapper ships unused**
- **Where:** listed in Select section above (CitationsManager:153; SettingsView:284; AiResearchChat:331; PaperReviewView:123,276; SourcePanel:331; ExportModal:217; TeamModal:326,377)
- **Impact:** visual inconsistency (native popup can't be themed), no multi-line option rendering, keyboard/AT experience diverges between surfaces; `select.tsx` is dead code (~141 LOC) inviting drift.
- **Fix:** adopt `Select` progressively — start with user-facing pickers (ExportModal, CitationsManager, TopBar-adjacent flows); keep native for dense internal forms if desired, but then delete or clearly mark the wrapper. Effort S each / M batched.

**[MEDIUM] M-7 — Design-token drift between TS constants and CSS variables**
- **Where:** `packages/tokens/src/index.ts:13,30` vs `packages/tokens/src/tokens.css:14,59`
- **Evidence:** `textTertiary` = `#8A8985`/`#6E6D68` (TS) vs `#706F6A`/`#918F8A` (CSS). Any consumer importing TS constants gets different grays than the rendered app.
- **Fix:** make `tokens.css` the sole source; generate `index.ts` from it (style-dictionary/token-transformer) or delete the drifted fields. Effort S.

**[MEDIUM] M-8 — ResearchGraph hardcodes light-theme + non-token colors → broken dark mode**
- **Where:** `ResearchGraphView.tsx:280,300,315–317,330` — details in Styling table above
- **Impact:** in dark theme, `#E4E2DE` edges and `#FFFFFF` selection rings sit on `#17171A` canvas producing glare/invisibility; author/topic blues/ambers have no token lineage and won't track future brand changes.
- **Fix:** `stroke="var(--border-default)"`, `fill="var(--accent-primary)"` etc.; introduce `--graph-author`/`--graph-topic` tokens (both themes) in tokens.css. Effort S.

**[MEDIUM] M-9 — Toast lacks announcement, auto-dismiss, and labeled dismiss**
- **Where:** `WorkspaceLayout.tsx:180–188`
- **Evidence:** no `role="status"`/`aria-live` on the toast itself (the sr-only region at 175–177 carries unrelated content); `✕` button unnamed; overwrite-on-new-toast; also depends on dead animate classes (H-1).
- **Fix:** adopt `@radix-ui/react-toast` (`Provider` + `Root` with `duration`, `SwipeDirection`) styled once in packages/ui. Effort M.

**[MEDIUM] M-10 — GlobalSearchModal intercepts Enter/arrows at window level while open**
- **Where:** `GlobalSearchModal.tsx:82–109`; listbox gaps at `:133–144`
- **Evidence:** listener attached to `window` with no target filtering; `preventDefault` on Enter means keyboard activation of any focused control inside the dialog is impossible while results exist; no `aria-activedescendant` bridge from input to highlighted option.
- **Fix:** scope handler to the input's `onKeyDown`, add `aria-activedescendant` + option ids, or migrate to cmdk (which solves all of it). Effort S–M.

**[MEDIUM] M-11 — `AIWritingFloatingOverlay` receives 24 drilled props**
- **Where:** `WorkspaceLayout.tsx:145–169` (call site enumerating continuation.* and editReview.* sub-objects field-by-field); component itself is 89 LOC
- **Impact:** every new AI-card field touches three files (context → layout → overlay); the layout has become a pure plumbing layer for state it doesn't use; merge-conflict magnet.
- **Fix:** consume `useWorkspace()` directly inside the overlay (it's already client-side), or split into `<AIContinuationCardHost/>` + `<AIEditReviewCardHost/>` each pulling their slice. Effort S.

**[MEDIUM] M-12 — Latency-tier picker lacks radiogroup semantics**
- **Where:** `SettingsView.tsx:265–279`
- **Evidence:** three `<button>`s expressing exclusive choice; no `role="radiogroup"`, no `role="radio"`/`aria-checked`, so SR users hear three unrelated buttons with no selection state.
- **Fix:** Radix `ToggleGroup type="single"` (new dep) styled once, or minimal role attributes. Effort XS–S.

**[MEDIUM] M-13 — Off-token palette colors in CommentsPanel**
- **Where:** `CommentsPanel.tsx:245` (`text-green-600`), `:253` (`text-red-500`)
- **Fix:** `text-trust-success` / `text-trust-danger`. Effort XS.

**[MEDIUM] M-14 — Chat paper-filter checkboxes are fake**
- **Where:** `AiResearchChat.tsx:363–380`
- **Evidence:** clickable div toggling lucide `CheckSquare/Square` icons; no real input, no `aria-checked`, not keyboard reachable.
- **Fix:** `Checkbox` primitive (new dep `@radix-ui/react-checkbox`) + `<label>`. Effort S.

### LOW

**[LOW] L-15 — Invalid Tailwind class `py-0.2` silently does nothing**
- **Where:** `LeftNavigation.tsx:93`, `:98` (`px-1.5 py-0.2`, `px-1 py-0.2`) — spacing scale steps are 0.5-based; intended `py-[2px]`.
- **Fix:** replace. Effort XS.

**[LOW] L-16 — `Badge` always renders a `<div>` with no `asChild`**
- **Where:** `badge.tsx:32–33` — forces block-in-inline workarounds (`<span><Badge/></span>`) and invalid nesting when placed inside `<p>`.
- **Fix:** add `asChild?: boolean` mirroring Button's Slot pattern. Effort XS.

**[LOW] L-17 — `window.alert` for error UX in an otherwise polished app**
- **Where:** `IntelligenceView.tsx:38` — blocking native alert contradicts the toast infrastructure that exists.
- **Fix:** route through toast/live-region announcer. Effort XS (after M-9).

**[LOW] L-18 — Color aliasing creates a footgun: `primary` maps to near-black**
- **Where:** `tailwind.config.js:17–19` (`primary: var(--text-primary)` etc.) — intuitive `bg-primary` yields ink-black backgrounds; classic shadcn expectation (`primary`=brand) inverts.
- **Fix:** rename to `ink`/`ink-secondary` or drop aliases; keep `accent` as the brand slot. Effort XS (rename + codemod grep).

**[LOW] L-19 — All 12 modals hosted unconditionally in `ModalContainer`**
- **Where:** `ModalContainer.tsx:37–100` — cost is low today (Radix portals mount content only when open) but the monolithic `modals` state object grows linearly and every modal takes `isOpen/onClose` boilerplate.
- **Fix (optional):** registry map keyed by modal id with a generic `openModal(id, payload)` reducer. Effort M. Not urgent.

**[LOW] L-20 — No standardized loading/pending Button state**
- **Where:** ad-hoc spinners (`Loader2` in TopBar.tsx:155, AiOutlineModal, ExportModal) re-implemented per site; Button variant set has no `loading`.
- **Fix:** add `loading?: boolean` to Button (disable + swap leading icon slot). Effort S.

**[LOW] L-21 — `EditorToolbar` is a 627-LOC god-component inside the shared package**
- **Where:** `packages/editor/src/components/EditorToolbar.tsx`
- **Fix:** decompose into `TextFormatMenu`, `InsertMenu`, `AIToolsMenu`, `HistoryControls` sub-components colocated in same folder. Effort M (pure refactor).

### INFO

- **I-1** Package import direction is acyclic and clean everywhere (verified by grep) — rare and commendable.
- **I-2** Pre-paint theme script correctly uses `beforeInteractive` strategy with hydration-safe `suppressHydrationWarning` (layout.tsx:48–57).
- **I-3** `IntelligenceView`, `ConfirmDialog`, `SourcePanel`, `BibtexModal`, `ZoteroImportModal` are model citizens — cite them in PR reviews as the reference patterns.
- **I-4** `packages/ui` ships unit/DOM tests (`button.dom.test.tsx`, `utils.test.ts`) — extend to dialog a11y snapshot tests post-migration.
- **I-5** Density tokens (`[data-density]`) actually implemented end-to-end — most repos never wire this.
- **I-6** `WorkspaceLayout` maintains a dedicated polite live region for SR announcements (175–177) — good instinct; unify toast messaging through it (or Radix Toast which handles this natively).

---

## Radix Migration Plan (prioritized, effort-tagged)

Already installed: `dialog, dropdown-menu, popover, select, tabs, tooltip, slot`. Efforts: **XS** <1h · **S** ½–1d · **M** 1–3d · **L** 1–2w.

| # | Priority | Action | New dep? | Effort | Unlocks |
|---|---|---|---|---|---|
| 1 | **P0** | Install + register `tailwindcss-animate` (H-1). One-line smoke test: open a dropdown and observe fade/zoom. | yes (devDep, apps/web) | **XS** | Entire existing animation surface starts working with zero code edits |
| 2 | **P1** | Port PdfReader AI-Q&A + note-editor overlays to `Dialog`/`DialogContent` (H-2). Delete ~90 lines of overlay markup. | no | **S** | Closes the last WCAG-dialog violations |
| 3 | **P1** | Replace both hand-rolled tab sets with `Tabs` (H-5); sweep `PdfReader:440`, `CommentsPanel:134`, `PaperReviewView:249` segmented controls in same pass | no | **S** | Uniform tabs; keyboard contract restored |
| 4 | **P1** | Make LeftNavigation document rows `<button>`s (H-4) | no | **XS** | Core nav becomes keyboard-operable |
| 5 | **P2** | Rebuild CitationPopover as `Popover` + `cmdk` combobox (H-3): `npm i cmdk`; portal, roving focus, typeahead, outside-click for free | yes (cmdk) | **M** | Flagship interaction becomes accessible; delete 201-line hand-roll |
| 6 | **P2** | Migrate GlobalSearchModal list to `cmdk` inside existing Dialog (command palette pattern; skill reference §Real-World Examples) — resolves M-10 | (shares cmdk) | **S–M** | Consistent command UX, aria-activedescendant correctness |
| 7 | **P2** | Add `@radix-ui/react-toast`; create `Toaster` in packages/ui; replace hand-rolled toast (M-9); reroute `window.alert` (L-17) | yes | **M** | Queued, swipeable, announced notifications |
| 8 | **P3** | Add `@radix-ui/react-checkbox` + `react-switch`; replace fake chat checkboxes (M-14) and optionally restyle settings toggles | yes | **S** | True form semantics |
| 9 | **P3** | Add `@radix-ui/react-toggle-group`; implement `SegmentedControl` wrapper; apply to chat-mode tabs (if kept as toolbar semantics), latency tiers (M-12) | yes | **S** | Kills ~80 lines of duplicated ternary styling |
| 10 | **P3** | Roll `Select` into high-traffic pickers: ExportModal → CitationsManager → TeamModal → SourcePanel → PaperReviewView → SettingsView → AiResearchChat (M-6) | no | **M** (batched) | Visual consistency; activates dead select.tsx |
| 11 | **P3** | Tokens: fix drift (M-7), add graph tokens + convert SVG colors (M-8), extract shared Tailwind preset into packages/tokens (Boundary F1) | no | **S** | Single source of truth; dark-safe graph |
| 12 | **P4** | Graduate `ConfirmDialog`, `ViewHeader`, Toaster, SegmentedControl into packages/ui with exports + tests (Boundary F3) | no | **S** | Real design-system growth path |
| 13 | **P4** | Decompose god-components incrementally, starting where change-frequency is highest: PdfReader (extract `SelectionToolbar`, `AnnotationLayer`, `AiQaPanel`), EditorToolbar (L-21), AiResearchChat (extract `ModeSelector`, `LibraryFilter`) | no | **L** (ongoing) | Maintainability; enables per-panel memoization |
| 14 | **P4** | Collapse AIWritingFloatingOverlay prop drilling (M-11) | no | **S** | Layout stops being plumbing |

**Sequencing rationale:** items 1–4 are pure wins touching few files and should land before any new feature work; 5–7 introduce the two missing primitives (cmdk, toast) that eliminate the largest hand-rolled surfaces; 8–11 round out form/graph semantics; 12–14 are structural and can ride along with normal feature development.

---

## Positive Observations

1. **The two-layer architecture is textbook-correct**: Radix confined to `packages/ui`, app consumes only `@openresearch/ui`, zero direct Radix imports in app code, peer-declared React ranges, acyclic package graph.
2. **Wrappers faithfully follow shadcn conventions**: forwardRef + displayName propagation, `cn()` composition, `asChild` preserved, variant defaults sensible, extension props (`hideClose`, `inset`, `sideOffset` overrides) added cleanly.
3. **13 of 14 dialogs are fully accessible** with correct Title/Description/Footer composition — including the subtle case of sr-only titles for search-style dialogs (GlobalSearchModal.tsx:114–117).
4. **Theming foundation exceeds typical maturity**: pre-paint FOUC script, system-preference fallback, dual-theme coverage for every token, working density modes, semantic trust-color vocabulary matched to the product's grounding concept.
5. **Token adoption in markup is ~99%** — the only hex offenders are one SVG-heavy view and two utility colors.
6. **Tests already exist** in the UI package — unusual discipline at this stage; a11y assertions can be added incrementally.
7. **Model-citizen components** (IntelligenceView, ConfirmDialog, SourcePanel tabs) prove the team already knows the right pattern — this audit is about finishing the rollout, not changing course.
8. **Keyboard-shortcut ergonomics**: global shortcuts respect INPUT/TEXTAREA guards (WorkspaceLayout.tsx:76) and shortcuts modal documents them.

---

## Prioritized Recommendations

1. **This week:** install `tailwindcss-animate` (P0/XS) — free visible polish across every primitive; port the PdfReader modal(s) to `Dialog` (P1/S); button-ify sidebar doc rows (P1/XS); swap both hand-rolled tab sets to `Tabs` (P1/S).
2. **Next sprint:** adopt `cmdk` for CitationPopover + GlobalSearchModal (P2/M+S); add Toast primitive and retire the hand-rolled toast + `window.alert` (P2/M).
3. **Following sprint:** Checkbox/Switch + ToggleGroup primitives (P3/S); Select rollout across the 9 native sites (P3/M); token-drift fix + graph theming + shared Tailwind preset (P3/S).
4. **Ongoing hygiene:** graduate ConfirmDialog/ViewHeader/SegmentedControl into `packages/ui` with tests; enforce via ESLint rule (`no-restricted-syntax` on `role="tab"` outside ui package, or a custom rule banning `fixed inset-0` overlays outside Dialog) so hand-rolling can't regress; decompose god-components opportunistically when touched.
5. **Governance:** add a one-paragraph "UI primitives" section to CONTRIBUTING.md pointing at `IntelligenceView.tsx` and `ConfirmDialog.tsx` as reference implementations, and require new interactive components to start from a Radix primitive.

*End of report.*
