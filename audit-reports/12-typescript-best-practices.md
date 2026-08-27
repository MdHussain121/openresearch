# TypeScript Best Practices Audit — OpenResearch Monorepo

**Audit ID:** 12-typescript-best-practices
**Date:** 2026-08-26
**Auditor:** ox-alpha (read-only audit, `typescript-best-practices` skill applied)
**Scope:** `apps/web/src/**/*.{ts,tsx}` and `packages/{ai,citations,editor,plugins,research,tokens,ui}/src/**/*.{ts,tsx}` plus root/app configs
**Files audited:** 133 TS/TSX files (~20,700 LOC): 78 in the web app, 55 in shared packages. Configs: `tsconfig.base.json`, `tsconfig.json`, `apps/web/tsconfig.json`, `eslint.config.mjs`, root & workspace `package.json`, `vitest.config.ts`, `next.config.js`.
**No files were modified.**

---

## Scope & Methodology

### What was examined

| Area | Method |
|---|---|
| Compiler strictness | Manual review of all three tsconfigs against a strictness checklist (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`) |
| Escape hatches | Systematic `rg` sweeps for `: any`, `<any>`, `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, non-null assertions (`!.` / `!).`), and every `as T` assertion outside import statements |
| Type-narrowing | Review of guards in `client.ts`, `errors.ts`, `DocumentContext.isCitationNode`, `PdfReader` metadata checks, `describeErrorDetail` |
| Discriminated unions | Inventory of union usage (`SearchResultItem`, `UploadProgress`, `SaveStatus`, tab/state unions) vs stringly-typed props (`category: string`, `severity: string`) |
| React patterns | Full read of all 5 contexts, shell components, views, intelligence views, modals; hook dependency arrays, memoization, effect hygiene, error boundaries/Suspense coverage |
| Next.js App Router | Layout/page tree, `'use client'` placement, `metadata` exports, absence of route-segment files (`error.tsx`, `loading.tsx`, `not-found.tsx`), `next.config.js` |
| API client layer | All 19 modules under `lib/api/`; comparison of DTO shapes to backend-mirroring needs and to package domain types |
| i18n | `i18n/index.ts` typing, `strings.json` (633 lines), hardcoded-string census in components |
| Package boundaries | Import graph of `@openresearch/*` across apps/packages, package.json dependency declarations, dead-package detection |

### Environment notes
- Backend is FastAPI (`apps/api`, excluded from TS). The web client talks to it directly over HTTP/SSE; there are **no Next.js route handlers**, so the fetch layer is the only contract surface on the frontend side.
- `packages/browser-extension` contains plain JS (`popup.js`, `manifest.json`) with no `src/` and no TypeScript — out of TS scope but noted below.
- Tests (`*.test.ts(x)`, `*.test-d.ts`) were reviewed for quality signals but escape-hatch counts are reported separately for test vs production code.

---

## Executive Summary

The codebase has solid fundamentals — `strict: true`, zero `@ts-ignore`, zero non-null assertions, clean package dependency DAG, well-typed domain unions in packages, type-level tests, and a genuinely tested SSE client. However, the type system is consistently **bypassed at exactly the places it matters most**: the network boundary, the localStorage boundary, and several event-handler boundaries. There is **no schema validation library anywhere** (no zod/valibot/yup), so every `request<T>()` call is an unchecked `Promise<T>` cast over raw JSON, and hand-written DTO interfaces drift freely from both the backend and the package-domain types that mirror them. React architecture concentrates all state in five eagerly-re-rendering contexts whose values are never memoized, and the App Router app ships without a single error boundary or `error.tsx`.

| Severity | Count |
|---|---|
| **CRITICAL** | 2 |
| **HIGH** | 9 |
| **MEDIUM** | 14 |
| **LOW** | 9 |
| **INFO** | 8 (incl. positive observations) |

### Headline metrics

| Metric | Value | Assessment |
|---|---|---|
| `strict` flag | ✅ enabled (all tsconfigs) | Good baseline |
| `noUncheckedIndexedAccess` | ❌ missing | Array index access unsound (`serverProjects[0]` typed non-undefined) |
| `exactOptionalPropertyTypes` | ❌ missing | Optional props accept explicit `undefined`, weakening DTO fidelity |
| `noUnusedLocals` / `noUnusedParameters` | ❌ missing | Dead exports survive undetected |
| Explicit `any` (production code) | **~16 occurrences in 8 files** | Concentrated in i18n, TopBar/LeftNavigation props, `parseZoteroJson`, `AcademicEditor`, `DocumentItem.content_json` |
| `as any` (production) | 3 (PaperReviewView.tsx:221,262,278) | Event-value casts to satisfy unions |
| `as T` assertions (non-import, non-test) | ~50 | ~12 are unsafe wire-data/domain casts |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** | Excellent |
| Non-null assertions | **0** | Excellent |
| Runtime schema validation (zod etc.) | **0 libraries, 0 schemas** | Every network/localStorage payload trusted blindly |
| eslint typescript-eslint plugin | ❌ absent (only `eslint-config-next`) | No `no-explicit-any`, no type-aware rules |
| Error boundaries (`error.tsx`/ErrorBoundary class) | **0** | One render crash blanks entire workspace |
| Context values memoized | 0 of 5 providers | Every provider re-renders all consumers each state change |

---

## Config Review

### `tsconfig.base.json` / `tsconfig.json` / `apps/web/tsconfig.json`

```jsonc
// tsconfig.base.json (lines 2–17, abridged)
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "allowJs": true,          // ← JS admitted into type-checked programs
    "skipLibCheck": true,
    "isolatedModules": true,  // ✅ good
    "forceConsistentCasingInFileNames": true, // ✅ good
    "moduleResolution": "bundler",            // ✅ appropriate
    ...
  }
}
```

**Findings**

- **[HIGH] Missing modern strictness flags.** None of the three configs enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noStrictBindCallApply`-era leftovers aside, nor `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`. Concrete unsoundness this permits today:
  - `ProjectContext.tsx:75,77,101` — `serverProjects[0]` / `localList[0]` typed `Project` (not `Project | undefined`); the code even defends manually at some sites (`styles.ts:21–25,46` writes `authors[0] && …` guards *as if* the flag were on — inconsistent discipline).
  - `SettingsView.tsx:80` — `{ ...prev[provider], apiKey: '' }` where `prev[provider]` may be `undefined`; spreads silently produce `{apiKey}` only.
  - `AiOutlineModal`/contexts pass optional fields explicitly as `undefined` in object literals (e.g., `chat.ts` payloads `{ paper_id: undefined }`), which `exactOptionalPropertyTypes` would flag before they hit `JSON.stringify`.
- **[MEDIUM] Path aliases defined twice** — once in `tsconfig.base.json:18–33` and again (with different relative depth) in `apps/web/tsconfig.json:23–39`. Drift risk: adding a package requires editing both plus `next.config.js#transpilePackages` plus `vitest.config.ts#resolve.alias`. A fourth alias map lives in vitest. Single-source these (e.g., generate or keep only base+app).
- **[MEDIUM] `allowJs: true`** while the repo also lints `.js` config files — invites gradual JS creep into type-checked surface for zero current benefit (all sources are TS).
- **[LOW] `skipLibCheck: true`** — conventional, but combined with `"types"` not being pinned it means third-party `.d.ts` breakage surfaces late.
- **[INFO] Root `tsconfig.json` excludes `apps/api`** (Python) correctly; `include` covers `packages/**` and `apps/**` so a single `tsc --noEmit` at root type-checks the whole TS monorepo — good CI shape (root script `typecheck` fans out per-workspace).

### `eslint.config.mjs`

```js
// apps/web/eslint.config.mjs (full, lines 1–15)
import coreWebVitals from 'eslint-config-next/core-web-vitals';
const eslintConfig = [
  ...coreWebVitals,
  { rules: { 'react-hooks/set-state-in-effect': 'off' } },   // ← tracked follow-up
  { ignores: ['.next/**', 'node_modules/**', 'out/**'] },
];
```

- **[HIGH] No `typescript-eslint` at all.** The flat config contains only Next's core-web-vitals. Rules like `@typescript-eslint/no-explicit-any`, `no-unsafe-*`, `no-floating-promises`, `switch-exhaustiveness-check` are unavailable — which is why 16 production `any`s and dozens of unchecked floating promises (`loadComments()` fire-and-forget, `handleCitationInserted` awaited nowhere) pass lint silently. Ironically, `extensions.test.ts` contains 15 `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments for a rule that isn't even configured in this repo's own config.
- **[MEDIUM] `react-hooks/set-state-in-effect: 'off'`** is acknowledged as a tracked follow-up (comment cites auth/project/paper contexts). Confirmed offenders: `AuthContext` n/a, `WorkspaceContext.tsx:339–349,378–397` (localStorage→setState on mount), `DocumentsView.tsx:39–43` (prop-derived `docTitle` state), `PaperReviewView` selectedDoc init. These are the classic "derive state during render" candidates.

### `package.json` scripts (root + workspaces)

- ✅ `typecheck` runs `tsc --noEmit` per workspace; `lint`, `test`, `test:coverage` wired.
- ✅ Vitest coverage thresholds are **100% lines/functions/branches/statements** for `citations`, `research`, `ai`, `plugins`, `ui`, `editor/extensions` — unusually rigorous.
- **[LOW]** Packages ship raw source (`"main": "src/index.ts"`, `"types": "src/index.ts"`) with no build step; consumers rely on `transpilePackages` (Next) and vitest aliases. Works internally, but breaks any future external consumer or non-transpiling toolchain; also means `exports` maps are missing everywhere except `tokens` (which does define `./tokens.css` properly).
- **[LOW] Version skew:** `@openresearch/editor` pins tiptap `^2.3.1` while web uses Next 16/React 19 — fine, but `lucide-react ^0.378.0` duplicated in three package.jsons (web, ui, editor) can resolve to duplicate icon bundles if ranges drift.

### `next.config.js`
- ✅ `reactStrictMode: true`, `output: 'standalone'`, all six internal packages transpiled.
- **[LOW]** `allowedDevOrigins: ['192.168.1.6']` hard-codes a LAN IP — environment-specific config committed to the repo.

---

## Detailed Findings

Severity scale: **CRITICAL** = exploitable/corrupting; **HIGH** = correctness or maintainability hazard likely to bite; **MEDIUM** = should fix in normal course; **LOW** = polish; **INFO** = observation.

---

### CRITICAL-01 — Zero runtime validation at the network trust boundary (`request<T>` blind cast)

**File:** `apps/web/src/lib/api/client.ts:59–79`

```ts
export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  ...
  if (response.status === 204) {
    return {} as T;          // ← fabricated T from nothing
  }
  return response.json();    // ← Promise<any> returned as Promise<T>, unchecked
}
```

Every one of the 60+ API methods across 19 modules (`papersApi`, `documentsApi`, `intelligenceApi`, `chatApi`, …) funnels through this cast. A backend field rename, a proxy HTML error page, or a version skew produces **silently mis-shaped data** that flows straight into React state and rendering (e.g., `intelligenceApi.paperReview` result drives `Object.entries(reviewResult.categories)` at `PaperReviewView.tsx:218` — a shape change throws at render time, and with no error boundary, whitescreens the app).

No zod/valibot/yup exists anywhere in the dependency tree (verified by sweep). The skill-mandated pattern — *schema as single source of truth, `z.infer` for the static type, `parse` at trust boundaries* — is entirely absent.

**Fix (representative):**
```ts
import { z } from 'zod';

const PaperDTOSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  authors: AuthorSchema.array().optional(),
  extraction_status: ExtractionStatusSchema,
  /* … */
});
export type PaperDTO = z.infer<typeof PaperDTOSchema>;

export async function request<S extends z.ZodType>(schema: S, endpoint: string, options?: RequestInit):
  Promise<z.output<S>> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  if (!response.ok) throw new ApiError(await extractErrorMessage(response, 'API request failed'), response.status);
  if (response.status === 204) return undefined as z.output<S>;
  return schema.parse(await response.json()); // fail fast, loudly, at the boundary
}
```
This simultaneously deletes the DTO/domain duplication problem (CRITICAL/HIGH-03) because schemas become the shared contract.

---

### CRITICAL-02 — Unescaped interpolation into `innerHTML` (XSS sink fed by API data)

**File:** `packages/editor/src/extensions/ghostText.ts:57`

```ts
badge.innerHTML =
  `<svg …></svg><span>${topSource.authors || 'Source'}</span>`;
```

`topSource.authors` originates from LLM/RAG pipeline output relayed through the backend (`GroundedPassage.authors` — free-form string built by `toGroundedPassage` from raw API fields). A malicious or merely malformed paper record containing `<img src=x onerror=…>` executes inside the editor DOM. The sibling `textContent = text` on line 49 shows the correct pattern was known and skipped for the badge. Secondary instance of the same class: `citation.ts:144` interpolates `node.attrs.paperTitle`/`authors` into a `title` attribute — attribute-context injection is mitigated by ProseMirror attr serialization here, but the ghost-text badge is a direct `innerHTML` sink.

**Fix:** build the label with `createElement` + `textContent`:
```ts
const label = document.createElement('span');
label.textContent = topSource.authors || 'Source';
badge.append(svgIcon, label);
```

---

### HIGH-01 — Two parallel, drifting type vocabularies: package domain types vs web DTOs (duplicated types, stringly-typed DTOs)

The monorepo maintains *three* representations of the same concepts with no compile-time link:

| Concept | `packages/*/src/types.ts` (camelCase, literal unions) | `apps/web/src/lib/api/*.ts` (snake_case DTO) | Component-local copies |
|---|---|---|---|
| Paper | `BibliographicReference` (citations) | `PaperDTO` (papers.ts:4–19) | `Paper` (PaperContext.tsx:76–90) |
| Annotation | — | `PaperAnnotationDTO` (papers.ts:21–33) | `PaperAnnotation` (PaperContext.tsx:92–104) — **field-for-field identical** |
| Grounded passage | `GroundedPassage` (ai) | `AIChatSourceDTO = GroundedPassage` ✓ (chat.ts:11) | — |
| Trust legend | `TrustLegend {sourceGroundedCount…}` (ai:31–35) | inline `trust_legend {source_grounded_count…}` (chat.ts:19–23) | `ChatMessageItem.trustLegend` re-declares snake_case shape again (AiResearchChat.tsx:47–51) |
| Claim flag | `ClaimFlag {flagType:'no_supporting_citation', startChar…}` (ai:148–157) | `ClaimFlagDTO {flag_type: string, claim_id…}` (intelligence.ts:3–12) — **severity/category demoted to `string`** | `export type ClaimFlag = ClaimFlagDTO` (ClaimVerificationInspector.tsx:21) shadows the package type name |
| Research gaps | `PotentialResearchGap`/`ResearchGapsResult` with `category` union of 5 literals (ai:189–206) | `ResearchGapItemDTO.category: string` | — |
| Lit matrix row | `LitMatrixRow` (ai:217–227) | `LiteratureMatrixRowDTO` | — |
| Review issue | `ReviewIssue`/`ReviewCategorySummary` with `ReviewCategoryType`/`ReviewIssueSeverity` unions (ai:236–257) | `ReviewIssueDTO.severity: string`, `categories: Record<string, …>` (intelligence.ts:91–118) | `PaperReviewView.tsx:29–30` re-aliases DTO names onto package names: `export type ReviewCategorySummary = ReviewCategorySummaryDTO` |

Consequences already visible in code:
- `PaperReviewView.tsx:221,262,278` need `as any` precisely because DTO strings lost the literal unions: `setActiveTab(catKey as any)`.
- `WorkspaceContext.toGroundedPassage` (lines 34–55) is a 22-line defensive adapter that accepts *either* naming convention (`p.paper_id || p.paperId`) — the signature of two uncoordinated dialects.
- `chat.ts:88–91` recasts four streamed frame fields (`frame.mode as AIChatStreamMetaDTO['mode']` etc.) because the SSE envelope is untyped.

**Fix:** make package types (or better, zod schemas placed in packages, e.g. `@openresearch/ai/schemas`) the single source; derive DTOs via `z.infer` + `.transform()` for case normalization; delete component-local re-aliases. Where backend casing differs, normalize once in `request<T>` rather than at every consumer.

---

### HIGH-02 — tsconfig strictness gaps (see Config Review for full list)

Representative live defects the missing flags already permit:
- `DocumentContext.tsx:185` — `localList[0] || null` shows awareness, but `ProjectContext.tsx:77` `return serverProjects[0];` returns possibly-undefined as `Project`.
- `WorkspaceLayout.tsx:125` — `documentId={activeDocument?.id || ''}` — empty-string sentinel instead of `string | null`; forces downstream `if (!documentId)` truthiness checks (`CommentsPanel.tsx:40`).
- `SettingsView.tsx:80` — spread of possibly-undefined draft.

**Fix:** enable `noUncheckedIndexedAccess` first (expect a bounded ~20-site fix wave), then `exactOptionalPropertyTypes`, then the unused-code flags.

---

### HIGH-03 — ESLint has no TypeScript-aware ruleset (see Config Review)

Any refactor relying on lint to police `any`, floating promises, or unsafe assertions currently polices nothing. Also note `react-hooks/exhaustive-deps` disables exist in app code at `ChatView.tsx:15`, `WorkspaceLayout.tsx:54,83`, `ClaimVerificationInspector.tsx:69` — each individually justified in comments, but with no type-aware lint there is no second line of defense for the ones that aren't documented.

---

### HIGH-04 — Context architecture: unmemoized values + unstable handlers ⇒ cascade re-renders; one god-context

**Files:** `WorkspaceContext.tsx:639–700`, `ProjectContext.tsx:195–210`, `DocumentContext.tsx:466–493`, `PaperContext.tsx:410–433`, `AuthContext.tsx:28–36`

```tsx
// WorkspaceContext.tsx:639
const value: WorkspaceContextType = {   // fresh object literal EVERY render
  activeNav, navigate, /* …44 more members… */
};
return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
```

- Only the *inner* objects (`modals`, `continuation`, `editReview`) are `useMemo`'d; the top-level value is not, and most member functions in Project/Document/Paper contexts are plain functions recreated per render (`selectPaper`, `uploadPaper`, `createDocument`, `setActiveDocument`, `updateStats`…). Since `useContext` compares by reference, **every keystroke in the editor** (via `updateActiveDocument` → `stats` change → new value) re-renders every consumer of every descendant provider chain — including `TopBar`, `LeftNavigation`, all mounted modals, `SourcePanel`.
- `WorkspaceContext` is a 709-line god-context mixing navigation, theme, density, sidebar/panel layout, 13 modal open/close flags, AI quota accounting, SR announcements, and two AI request flows. Splitting along state-change frequency (e.g., `ModalsContext`, `ThemeContext`, `AIWritingContext`) would cut most of the blast radius even before memoization.

**Fix:** wrap each provider value in `useMemo` with precise deps; stabilize handlers with `useCallback`; split contexts by update frequency; consider `use-context-selector` for hot consumers.

---

### HIGH-05 — No error boundaries anywhere in the App Router app

Verified absent: no `error.tsx`, `global-error.tsx`, `loading.tsx`, `not-found.tsx` anywhere under `src/app`; no `componentDidCatch`/`getDerivedStateFromError`; no `<Suspense>`; no `React.lazy`/`next/dynamic` (checked across app+packages).

Combined with CRITICAL-01 (render-time throws from unvalidated data, e.g., `reviewResult.categories` iteration) any unexpected payload or extension crash takes down the whole persistent shell — editor included. For an editor product, an unhandled exception losing visible work is a severe failure mode.

**Fix:** add `(workspace)/error.tsx` with recovery actions ("reload document", "back to library"); wrap `AcademicEditor` in a local boundary so editor crashes degrade to a message instead of killing autosave-adjacent state; add `not-found.tsx`.

---

### HIGH-06 — Stale-closure bugs inside `useEditor` callbacks (`isCitationPopoverOpen`, `atSymbolPos` captured at creation)

**File:** `packages/editor/src/components/AcademicEditor.tsx:215–339`

`useEditor(...)` creates the editor once; `editorProps.handleKeyDown` and `onUpdate` close over first-render values. The author carefully routed five handlers through refs (`onSaveRef`, `onUpdateRef`, `onGhostTextRequestRef`, …, lines 58–101) — but **not** the popover state used inside those callbacks:

```tsx
editorProps: {
  handleKeyDown: (view, event) => {
    ...
    if (isCitationPopoverOpen) {          // ← always false: captured when editor was created
      if (event.key === 'Escape') { setIsCitationPopoverOpen(false); ... }
    }
```
and in `onUpdate` (line 287) `if (isCitationPopoverOpen && atSymbolPos !== null)` gates query syncing on the same frozen values. Net effects: Escape-to-close via keydown path is dead code; popover query filtering depends on whichever render tiptap last re-bound (in v2 `onUpdate` is refreshed, but the guard reads the closure variable, not a ref). The `initialContent` sync effect (479–487) additionally `JSON.stringify`s the whole document on every prop change for equality — O(document) work on each external update.

**Fix:** mirror `isCitationPopoverOpen`/`atSymbolPos` into refs alongside the existing five, or move the Escape/popover logic out of editor props into React-level handlers (the component already has a separate document click handler doing dismissal).

---

### HIGH-07 — Streaming chat cannot be aborted; setState-after-unmount window

**File:** `apps/web/src/components/chat/AiResearchChat.tsx:138–213`

`api.chat.sendStream` accepts an optional `AbortSignal` (chat.ts:71, passed to `streamRequest`), but `AiResearchChat` never constructs an `AbortController`. Navigating away mid-stream leaves the reader loop running until the backend finishes, while `patchMessage` keeps calling `setMessages` on a potentially unmounted component, and `onSelectSource(topSource)` (line 216–218) fires post-navigation side effects. Same unguarded async pattern in `SettingsView.handleSetupTabby` (timeout-probe chain, lines 190–198).

**Fix:**
```tsx
const abortRef = useRef<AbortController | null>(null);
// in handleSendMessage: abortRef.current = new AbortController(); pass signal
// in useEffect cleanup: abortRef.current?.abort();
```

---

### HIGH-08 — i18n key typing deliberately defeated; translations evaluated once at module load

**File:** `apps/web/src/i18n/index.ts:13–26`

```ts
export type I18nKey = NestedKeyOf<typeof strings> | (string & {});
//                                     ^^^^^^^^^^^^^^^ swallows every typo

export function t(key: I18nKey): string {
  let current: any = strings;      // ← traversal in `any`
```

The sophisticated `NestedKeyOf` template-literal type computes exact dotted keys, then immediately unions with `string & {}` so **any** string type-checks — `t('nav.documnts')` compiles and silently renders the key. Additionally `LeftNavigation.tsx:38–45` calls `t(...)` at module scope to build `NAV_ITEMS`, freezing English output at bundle-eval time and making any future locale switch impossible without rearchitecting. Interpolation/pluralization don't exist, and a large census of hardcoded UI strings persists alongside the catalog (e.g., `LeftNavigation.tsx:42,172,182,192` titles, `SettingsView.tsx:401–409,414,430,533,546,576,581`, nearly all of `PaperReviewView.tsx:170–183,253–258`, `GlobalSearchModal.tsx:136`). i18n is therefore best described as partial decoration, not infrastructure.

**Fix:** drop `| (string & {})` (the compiler then finds every bad key instantly); make `t(key: I18nKey, vars?: Record<string, string|number>)`; hoist `t` calls into render; decide whether i18n is real (then migrate stragglers) or aspirational (then delete it — see Recommendations).

---

### HIGH-09 — `PaperContext.loadPapers` refetches on every search keystroke with no debounce/cancellation

**File:** `context/PaperContext.tsx:147–182`

```ts
}, [activeProject, isAuthLoading, isOfflineMode, searchQuery]);  // searchQuery in deps

useEffect(() => { loadPapers(); }, [loadPapers]);
```

`searchQuery` is bound to a text input in `ResearchLibrary`; every character triggers `api.papers.list(projectId, q)`. Out-of-order responses aren't guarded (unlike the careful `loadRequestRef` staleness pattern already implemented in `DocumentContext.refreshDocuments:103,145–188` — reuse it). Related race: `ProjectContext.refreshProjects:66–67` sets `isLoadingProjects(true)` then early-returns while `isAuthLoading`, leaving loading stuck if auth resolves without another trigger.

---

### MEDIUM-01 — Explicit `any` inventory (production code)

| # | Location | Snippet |
|---|---|---|
| 1 | `apps/web/src/i18n/index.ts:17` | `let current: any = strings;` |
| 2–4 | `components/shell/TopBar.tsx:32–34` | `projects: any[]; activeProject: any; setActiveProject: (proj: any) => void;` — despite `Project` being exported from `ProjectContext` one directory away |
| 5–7 | `components/shell/LeftNavigation.tsx:28–30` | `documents: any[]; activeDocument: any; setActiveDocument: (doc: any) => void;` — same, `DocumentItem` exists; also `citationStyle: string` (line 27) instead of `CitationStyle` |
| 8 | `packages/editor/src/components/AcademicEditor.tsx:500` | `(action: any) => {` for `handleToolbarAIEdit` although `EditorToolbarProps.onTriggerAIEdit` is correctly typed `(action: AIEditActionType)` (EditorToolbar.tsx:59) — pure regression |
| 9–12 | `packages/citations/src/styles.ts:499,504,522,536` | `parseZoteroJson(input: string | any[])`, `(item: any)`, `(c: any)`, `(a: any)` — textbook zod candidate (Zotero CSL-JSON is a well-known public schema) |
| 13 | `packages/research/src/cache.ts:8` | `Map<string, CacheEntry<any>>` — should be an internal `UnknownEntry` or generic class param |
| 14–16 | `apps/web/src/context/DocumentContext.tsx:14,36,45` | `content_json?: Record<string, any>` (interface, updater signature, factory return) — TipTap ships `JSONContent`; `Record<string, unknown>` at minimum |
| — | `lib/api/papers.ts:65–66` | `const errJson = await response.json(); errJson.detail || errorDetail` — implicit `any` deref; duplicates `extractErrorMessage` which exists for exactly this (see MEDIUM-05) |

Test code adds 14× `as any` in `packages/editor/src/extensions/extensions.test.ts` (each behind a `no-explicit-any` disable comment) — acceptable in tests, but a `Partial<Extension>` helper would remove them.

---

### MEDIUM-02 — Unsafe domain casts of wire data (lie-to-the-compiler instead of validating)

Each asserts an arbitrary server string into a literal union with a silent fallback, defeating exhaustiveness checking downstream:

- `WorkspaceContext.tsx:459,553` — `(res.grounding_state as GroundingState) || 'general-knowledge'`
- `DocumentsView.tsx:83` — same pattern
- `DocumentContext.tsx:204–205,225–226` — `(c.citation_style as CitationStyle) || 'apa'`, `(c.attribution_scope as AttributionScope) || 'direct_quote'`
- `chat.ts:88–91` — `frame.mode as AIChatStreamMetaDTO['mode']` (SSE frame)
- `CitationsManager.tsx:155`, `SourcePanel.tsx:333`, `TeamModal.tsx:328,379` — `e.target.value as CitationStyle` / `as TeamRole` (user-driven; low risk but the select could be typed generically)
- `ghostText.ts:183` — `return meta as GhostTextState;` (plugin meta)

**Fix:** a 5-line `parseUnion` helper (or zod `z.enum`) converts these to checked conversions that fall back explicitly; e.g. `function toGroundingState(v: unknown): GroundingState`.

---

### MEDIUM-03 — `localStorage` payloads parsed without schema validation

- `WorkspaceContext.tsx:382` — `JSON.parse(raw) as {enableGhostText?...}` (then manual typeof checks — validation exists but hand-rolled, duplicable, and untyped-safe only by discipline)
- `ProjectContext.tsx:49–50` — `Array.isArray(parsed)` is the *entire* validation of stored projects (items unchecked; a corrupted element becomes `activeProject` and flows into `TopBar` `proj.id` accesses)
- `DocumentContext.tsx:112–113` — same for documents, whose `content_json` later feeds `traverse()` into citation extraction
- `PaperContext.tsx:159,197` — `JSON.parse(saved)` straight into `setPapers`/`setAnnotations`

One shared `safeParseJson(schema, raw, fallback)` utility would cover all six call sites.

---

### MEDIUM-04 — `papersApi.upload` reimplements error extraction with an implicit-any deref

**File:** `lib/api/papers.ts:62–71`

```ts
} catch {
  const errJson = await response.json();
  errorDetail = errJson.detail || errorDetail;   // errJson: any
}
throw new Error(errorDetail);
```
Diverges from the central `extractErrorMessage` (client.ts:44–57): loses HTTP status (plain `Error`, not `ApiError`), loses array-form `detail`, and bypasses the tested path. Should be `throw new ApiError(await extractErrorMessage(response, 'Paper upload failed'), response.status);`.

---

### MEDIUM-05 — Prop drilling layered on top of the same contexts (dual access patterns)

`WorkspaceLayout.tsx:37` grabs `const w = useWorkspace();` then forwards 15–20 individual props into `TopBar` (projects, activeProject, setActiveProject, saveStatus, theme…), `LeftNavigation` (documents, activeDocument, setActiveDocument, createDocument, deleteDocument…) — yet those children *also* call `useWorkspace()`/`useDocument()` internally (`LeftNavigation.tsx:61–62`). This yields the worst of both worlds: prop-list noise, unstable callback identities crossing the boundary, and double subscription. Pick one direction: leaf components consume contexts directly; layout passes only true inputs. `AIWritingFloatingOverlay` receives 24 individual props (lines 145–169) that are literally fields of `w.continuation`/`w.editReview` objects — pass the two objects.

---

### MEDIUM-06 — All 12 global modals mount eagerly on every page

**File:** `shell/ModalContainer.tsx:37–100`

Every modal is rendered with `isOpen` flags regardless of need. Radix suppresses portal output when closed, but each modal's component body, hooks, and (for several) initial `useEffect` fetches still execute per render of the container, which itself re-renders on *every* context change (see HIGH-04). Lazy-mount via `{m.isTeamOpen && <TeamModal …/>}` preserves the API while removing the cost; heavy ones (`ZoteroImportModal`, `PluginManagerModal`) are also `React.lazy` candidates.

---

### MEDIUM-07 — `PdfReader` is an 844-line component with 18 parallel `useState` hooks

**File:** `components/reader/PdfReader.tsx:41–120+`

View mode, tabs, zoom, selection toolbar, note editor, AI thread modal, annotation CRUD all live in one function component. State clusters are independently cohesive (`viewMode/zoomLevel`, `selection/note`, `aiQuery/aiAnswer`). Extract custom hooks (`useSelectionToolbar`, `useAnnotationThread`) or child components; the file already demonstrates the right instinct for derived-data safety (`metadata.sections` Array.isArray guards, line 76–84) which a zod-parsed `PaperMetadata` schema would obsolete.

---

### MEDIUM-08 — Dead / orphaned code kept alive by exports and 100% coverage

- `SaveStatus = 'saved'|'saving'|'unsaved'|'offline'` (DocumentContext.tsx:20) — **`'unsaved'` is never produced anywhere** (grep: only the declaration and TopBar's render branch for it). Dead union member rendering dead UI.
- `EditorDocumentState` (editor/types.ts:13–20) — exported, type-tested, never imported by application code.
- `packages/research` entire provider stack — `ResearchProviderRegistry`, `OpenAlexProvider`, `CrossrefProvider`, `ArxivProvider`, `SemanticScholarProvider`, `providerCache` — all four providers are **hardcoded empty-result stubs** (`arxiv.ts:10–16` returns `totalResults: 0, results: []`), the registry is never imported by `apps/web` (verified: web's online search goes through `api.research.search` → FastAPI instead), yet the package enjoys 100% coverage of its emptiness.
- `packages/ai` provider layer (`LLMProviderRegistry`, `OpenAICompatibleProvider`, `OllamaProvider`, `CustomLLMProvider`) — likewise never instantiated by the web app (backend proxies LLM calls); only types are consumed. Fine as a published-library bet, but today it's a parallel implementation maintained at 100% coverage for zero runtime users.
- `AuthContext` hardcodes `LOCAL_USER`/`isAuthenticated: true` (AuthContext.tsx:12–35) — scaffolding that makes `isAuthenticated && !isOfflineMode` branches across Project/Document/Paper contexts permanently-true noise, and `client.test.ts:71` actively asserts requests carry **no** Authorization header.
- `browser-extension` package: `popup.js` plain JS, no TS, no build — excluded from typecheck entirely while sitting in the workspaces graph.

---

### MEDIUM-09 — Verbatim ~90-line duplication between `CitationsManager` and `SourcePanel`

`CitationsManager.tsx:51–137` vs `SourcePanel.tsx:63–137`: identical `citedReferences` mapping (including the `as BibliographicReference` + `.filter(Boolean) as` pair), identical `formattedBibliography` memo, identical copy handlers, identical 26-entry `styleOptions` table (CitationsManager's variant uses `t()` labels, SourcePanel's hardcodes English — they will diverge). Extract `useCitedReferences(papers, documentCitations)` and a shared `CITATION_STYLE_OPTIONS` constant (labels via i18n keys).

Also: the Paper→BibRef mapping exists in triplicate — `paperToBibRef.ts` (canonical), `CitationsManager.tsx:59–75`, `SourcePanel.tsx:71–87`, plus a fourth inline variant in `AddByIdentifierModal.tsx:80–89`.

---

### MEDIUM-10 — `NodeJS.Timeout` used for browser timers

`packages/editor/src/components/AcademicEditor.tsx:57` — `useRef<NodeJS.Timeout | null>(null)`. Pulls Node typings into isomorphic package code; `ReturnType<typeof setTimeout>` (used correctly elsewhere, e.g. `AiResearchChat.tsx:86`) is the portable form. Same package mixes both idioms.

---

### MEDIUM-11 — Toast/announcement timers never cleaned up

`DocumentContext.handleCitationInserted:418,440,447` and `handleCitationDeleted:461` fire bare `setTimeout(() => setToastMessage(null), 3000)` with no stored handle — rapid insert/delete cycles interleave timers that clear newer messages early. Compare `AiResearchChat.modeToastTimerRef` which stores and clears correctly. Same class: `recentlyAddedRefId` reset timer (line 418).

---

### MEDIUM-12 — Metadata/viewport gaps in root layout

`app/layout.tsx:24–27` exports title/description only. No `viewport` export (`themeColor` belongs there in current Next), no Open Graph/Twitter cards, no icons block, no `metadataBase`. For a standalone-marketed OSS tool this costs link-preview fidelity; trivially added.

---

### MEDIUM-13 — Resize handler collapses panels on every event, no debounce, wrong deps shape

`WorkspaceLayout.tsx:40–55` — `resize` listener runs `setIsSidebarCollapsed(true)` continuously while dragging below breakpoints (also fights user intent: expanding the sidebar under 1024px is impossible since any resize re-collapses). Debounce + matchMedia change listeners (`matchMedia('(max-width: 767px)').addEventListener('change')`) is the idiomatic fix. Effect body references `w.setIsSidebarCollapsed` under an `exhaustive-deps` disable.

---

### MEDIUM-14 — `filter(Boolean) as T[]` pattern instead of a type-guard

`CitationsManager.tsx:75–77`, `SourcePanel.tsx:87–89`:
```ts
}).filter(Boolean) as BibliographicReference[];
```
`.filter(Boolean)` does not narrow (pre-ES2022 lib); the trailing `as` reasserts. One generic `nonNull<T>(x: T | null): x is T` helper eliminates both casts and is reusable at `DocumentsView`, `WorkspaceContext`.

---

### LOW-01 — Inconsistent error-handling idioms across contexts

Three competing patterns coexist: `getErrorMessage(err, fallback)` (OnlineSearchPanel, AddByIdentifierModal, IntelligenceView, PaperReviewView — good), `err instanceof Error ? err.message : fallback` hand-rolled (SettingsView.tsx:84,106,153,200,237; AiResearchChat.tsx:208), and silent `catch {}` / `console.warn` swallow (17 `catch {` blocks; 17 `console.warn` calls concentrated in contexts — ProjectContext.tsx:127,156,183; PaperContext ×7; CommentsPanel ×5). Users receive no surfaced failure for comment/annotation/paper-delete failures. Standardize on `getErrorMessage` + a context-level toast channel (one already exists: `toastMessage` in DocumentContext).

### LOW-02 — Dead fallback on total Record index

`providers/openai.ts:111`, `ollama.ts:106` — `EDIT_ACTION_INSTRUCTIONS[request.action] ?? 'Improve…'`: the operand indexes `Record<AIEditActionType, string>` with an `AIEditActionType`, so `??` is unreachable (would become reachable — and useful — under `noUncheckedIndexedAccess`).

### LOW-03 — `window.prompt` for link editing

`EditorToolbar.tsx:82` — blocking native dialog in the flagship editor UI; also unvalidated URL (a `javascript:` URI passes straight into `setLink` — low-risk given authenticated local app, but a `URL` scheme allowlist is cheap).

### LOW-04 — Barrel files use `export *` extensively

`lib/api/index.ts:1–19`, `citations/index.ts`, `ai/index.ts`, `research/index.ts`, `editor/index.ts`, `ui/index.ts`. With `isolatedModules` this is safe, but it enabled the name-shadowing seen at `ClaimVerificationInspector.tsx:21` (`ClaimFlag` DTO alias vs ai package's `ClaimFlag`) and `PaperReviewView.tsx:29–30`. Prefer explicit named re-exports in app-facing barrels; keep `export *` internal to packages.

### LOW-05 — `lib/api.ts` facade double-exports everything

```ts
export * from './api/index';
export { api } from './api/index';  // api already covered by * ? — no: index exports `api` too
```
Both `./api/index`'s namespace dump and a named `api` — the second line is redundant with what `index.ts` already exports, and consumers import inconsistently from `../../lib/api` throughout. Keep one entry.

### LOW-06 — Mixed naming conventions leak storage vocabulary into UI state

`ChatMessageItem.trustLegend.source_grounded_count` (AiResearchChat.tsx:47–51, consumed at :485–495) carries the wire's snake_case into a purely client-side model — the camelCase `TrustLegend` exists in `@openresearch/ai` for exactly this.

### LOW-07 — `toGroundedPassage` exported from a context module and re-exported through a component

`WorkspaceContext.tsx:34` exports a data-mapper from a Provider file; `SourcePanel.tsx:18` imports the `GroundedPassage` *type* from `../chat/AiResearchChat` (a component!) rather than `@openresearch/ai`, and `ChatView.tsx:6` aliases it back out again. Types should come from the package; mappers from a `lib/` module.

### LOW-08 — `hourlyCap` sentinel `-1` magic number

`WorkspaceContext/DocumentsView/SettingsView` thread `-1` as "unlimited" (`hourlyCap !== -1 && hourlyUsage.count >= hourlyCap`, DocumentsView.tsx:70). `type HourlyCap = number | 'unlimited'` or a branded `Unlimited` const removes the magic value; `AIQuotaConfig.hourlySuggestionCap` (ai/types.ts:141) documents the same convention in a second place.

### LOW-09 — `announce()` double-rAF trick relies on empty-text flush

`WorkspaceContext.tsx:199–202` clears then re-set inside `requestAnimationFrame` to retrigger the live region — works, but is timing-dependent; toggling a counter/key on the aria-live node is deterministic.

---

## Component Architecture Assessment

### Provider composition
`(workspace)/layout.tsx` nests Auth → Project → Document → Paper → Workspace. Ordering is correct for data dependencies (each consumes its parents'). The persistent-shell pattern (layout holds chrome, pages render via `children`) is sound and prevents remount churn on navigation.

### State taxonomy observed
| Category | Mechanism | Health |
|---|---|---|
| Server entities (projects/documents/papers/annotations) | Contexts with manual fetch+fallback-to-localStorage | Functional but races (HIGH-09), unvalidated (MEDIUM-03) |
| UI shell (panels, modals, nav, theme) | One god-context | Over-concentrated (HIGH-04) |
| AI request lifecycle | Continuation/EditReview sub-states inside god-context | Well-shaped discriminated-ish objects (`ContinuationState`, `EditReviewState` include their own action callbacks) — good design worth extracting into a dedicated provider |
| Forms (modals/settings) | Local useState per modal | Generally clean; `providerDrafts` keyed-record pattern in SettingsView is nice |
| Search/filter | Derived `useMemo` | Good (GlobalSearchModal, CitationPopover scoring) |

### Patterns done right (worth preserving as templates)
- **Discriminated unions where they matter:** `SearchResultItem` (GlobalSearchModal.tsx:15–17) with exhaustive narrowing at every consumption site; `UploadProgress` + `PipelineStep`; `acProbeState: 'idle'|'checking'|'up'|'down'`; `ViewMode`/`ActiveTab` in PdfReader.
- **Const-assertion registries:** `SOURCE_OPTIONS` (OnlineSearchPanel.tsx:21–28) deriving `SourceKey` from `typeof`; `NAV_ROUTES`→`ROUTE_TO_NAV` inversion (WorkspaceContext.tsx:21–32); `EDIT_ACTION_INSTRUCTIONS` as `Record<AIEditActionType, string>` (compile-time-complete instruction table).
- **Ref-mirroring for stable callbacks** in AcademicEditor (partially applied — see HIGH-06 for the gap).
- **Request-staleness guard** in `DocumentContext.refreshDocuments` (`loadRequestRef`, lines 103,145–188) — correct pattern, under-reused.
- **Type-level tests:** `types.test-d.ts` in citations and editor using `expectTypeOf` — rare and valuable.
- **SSE parser fully unit-tested** across chunk-boundary splits (`client.test.ts:19–42`).
- **Accessibility plumbing** typed and centralized (`srAnnouncement`, aria attributes throughout).

### Re-render hot spots ranked
1. Any `WorkspaceContext` state change → all five-context consumers (value literal, HIGH-04).
2. Editor keystroke → `updateStats` → DocumentContext value → TopBar save-status + LeftNavigation doc list + ModalContainer + SourcePanel all reconcile.
3. `hourlyUsage.count` increments on every AI request → DocumentsView status bar + everything else in the god context.

### Suspense/streaming posture
None. Acceptable for an authenticated tool SPA-like surface, but `next/font` is the only Next-native optimization in play; the 633-line `strings.json` and all packages ride in the initial client bundle. Route-level `React.lazy` for `PdfReader`/intelligence views would measurably trim TTI.

---

## Positive Observations

1. **Zero `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`** across 133 files — suppression culture is healthy.
2. **Zero non-null assertions** in application code.
3. **`strict: true` everywhere**, with `isolatedModules`, bundler resolution, consistent casing — modern baseline.
4. **Clean package DAG, no cycles:** `tokens ← ui`; `citations ← ai, research`; `{citations, ai, ui, tokens} ← editor`; `plugins` leaf. Web depends only downward. Dependency declarations in package.json match actual imports.
5. **Literal-union domain modeling in packages:** 26-style `CitationStyle`, `GroundingState`, `AttributionScope`, `AIEditActionType`, `PluginType` — illegal states largely unrepresentable at the domain layer.
6. **Exhaustive `Record<Key, V>` tables** (`EDIT_ACTION_INSTRUCTIONS`) give compile-time completeness when new actions are added.
7. **Type-level testing** (`expectTypeOf`) and **100% enforced coverage** on core packages.
8. **A purpose-built typed error utility** (`lib/errors.ts#getErrorMessage(unknown)`) exists and is adopted in the newest code — the older hand-rolled `instanceof` chains are migration debt, not intent.

---

## Prioritized Recommendations

### P0 — Correctness & security (do now)
1. **Escape the `innerHTML` sink** in `ghostText.ts:57` (CRITICAL-02). One-hour fix.
2. **Introduce zod at the fetch boundary**: wrap `request<T>` with a schema parameter; start with the highest-shape-risk endpoints (`intelligence.*`, `chat.sendStream` frames, `citations.resolveIdentifier`). Delete `{} as T`. (CRITICAL-01)
3. **Add `error.tsx` + a boundary around `AcademicEditor`** so data/render failures degrade gracefully (HIGH-05).
4. **Abort chat streams on unmount/navigation** and guard post-stream side effects (HIGH-07).

### P1 — Type-system integrity (this sprint)
5. Enable `noUncheckedIndexedAccess`, then `exactOptionalPropertyTypes`, then `noUnusedLocals/noUnusedParameters/noFallthroughCasesInSwitch` in `tsconfig.base.json`; fix the resulting bounded wave (~20–30 sites, many already defensively coded for it). (HIGH-02)
6. Adopt `typescript-eslint` (recommended-type-checked config) in `eslint.config.mjs`; re-enable `react-hooks/set-state-in-effect` once the six offending mount-effects are refactored to derive-during-render. (HIGH-03)
7. Collapse the DTO/domain/component type tripling: schemas (from step 2) become the source; remove `ClaimFlag`/`ReviewCategorySummary` shadow aliases; replace the four `as X` wire-cast families with `z.enum` parsing helpers. (HIGH-01, MEDIUM-02)
8. Replace all six `localStorage` parses with one validated `safeParseJson` util. (MEDIUM-03)
9. Fix the i18n escape hatch (`remove | (string & {})`), stop module-scope `t()` evaluation, and either commit to migrating hardcoded strings or retire the system. (HIGH-08)
10. Fix `PaperContext` refetch-per-keystroke (debounce + staleness ref) and the stuck-loading early-return in `ProjectContext.refreshProjects`. (HIGH-09)

### P2 — Architecture (next quarter)
11. Memoize all five provider values; split `WorkspaceContext` into Modals/Theme/AIWriting/UI-shell contexts; pass overlay sub-objects instead of 24 flattened props. (HIGH-04, MEDIUM-05)
12. Refactor `AcademicEditor` popover state into refs or React-level handlers; extract `PdfReader` hooks. (HIGH-06, MEDIUM-07)
13. Deduplicate cited-reference/style-options logic into `lib/` + shared hook. (MEDIUM-09)
14. Lazy-mount modals; lazy-load `PdfReader` and intelligence views. (MEDIUM-06)
15. Decide the fate of unused layers: implement or archive `packages/research` stubs and the client-side `LLMProvider` registry; delete `'unsaved'` status or wire it; resolve the `AuthContext` placeholder. (MEDIUM-08)

### P3 — Polish
16. Timer cleanup for toasts (MEDIUM-11); `ReturnType<typeof setTimeout>` (MEDIUM-10); debounce resize (MEDIUM-13); `nonNull` guard helper (MEDIUM-14); unify on `getErrorMessage` (LOW-01); explicit barrel re-exports (LOW-04/05); root metadata/viewport completion (MEDIUM-12); remove committed LAN IP from `next.config.js`.

---

*Audit performed read-only. No repository files were modified other than this report.*
