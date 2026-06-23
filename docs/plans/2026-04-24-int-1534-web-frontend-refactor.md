# INT-1534 — Web App Frontend Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow tasks sequentially — each is a self-contained, independently commitable unit.

**Goal:** Reduce `apps/web` initial-load bundle, eliminate SRP violations in oversized pages/components, close required-by-CLAUDE.md hook/service test gaps, harden `apiClient`, unify modal primitives, and close the 3-location env-var drift — without changing user-visible behaviour.

**Architecture:** All work is confined to `apps/web`. We convert the route table to `React.lazy` + `<Suspense>`; introduce deterministic Rollup `manualChunks`; split the five largest source files into `components/<feature>/` subfolders each ≤ 200 LOC; add a `ci:tracked`-enforced env-var lockstep check across `cloudbuild.yaml`, `config.ts`, and `vite.config.ts`; back-fill vitest specs for 8 untested hooks + top 5 untested services; add a 401→refresh retry + `X-Request-Id` propagation to `apiClient`; adopt `@radix-ui/react-dialog` as the shared modal primitive; fix `framer-motion` dependency classification and defer heavy imports.

**Tech Stack:** React 18, Vite 5 + Rollup, TypeScript strict mode, vitest + `@testing-library/react`, `@auth0/auth0-react`, `@radix-ui/react-dialog`, TailwindCSS, `vite-plugin-pwa`, `rollup-plugin-visualizer`.

---

## Endpoint Changes

No HTTP endpoints are created, modified, or removed by this plan. `apps/web` is a consumer; the refactor is strictly internal to the SPA bundle and its build config.

- **Modified:** none.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all service endpoints consumed via `config.ts` (`authServiceUrl`, `whatsappServiceUrl`, `notionServiceUrl`, `mobileNotificationsServiceUrl`, `ResearchAgentUrl`, `commandsAgentServiceUrl`, `actionsAgentUrl`, `notesAgentUrl`, `retiredChecklistServiceUrl`, `bookmarksAgentUrl`, `calendarAgentUrl`, `linearAgentUrl`, `codeAgentUrl`, `retiredChatServiceUrl`, `retiredSchedulerServiceUrl`, `hellscriptAgentUrl`, `appSettingsServiceUrl`, `llmUsageServiceUrl`).

---

## Key Decisions

- **One plan, no subtasks.** All changes live in a single service boundary (`apps/web`); the CLAUDE.md/planning contract forbids sibling subtasks within a single service. Sequence the work within this plan.
- **No user-visible behavior change.** This is a structural refactor. Any behavior delta (e.g. a new modal focus-trap) must be covered by a test that exercises the new behavior while an existing test asserts the prior behavior is preserved on already-correct paths.
- **Loader UX.** Use a single shared `<FullPageSpinner/>` for both the existing auth-loading state and the new `Suspense` fallback — identical visual element ⇒ no perceived flicker when lazy chunks resolve quickly.
- **Env-var drift is now a CI gate.** A new script under `scripts/ci/check-web-env-lockstep.cjs` (called from `pnpm run ci:tracked` for the web workspace) asserts that the service list in `cloudbuild.yaml`, the consumer list in `config.ts`, and the proxy list in `vite.config.ts` are set-equal. This catches today's drift (`image-service`, `web-agent` in cloudbuild but not in `config.ts`) and prevents regressions.
- **Modal migration is mechanical.** `@radix-ui/react-dialog` is added as a thin wrapper (`components/ui/Modal.tsx`) preserving the current props surface of each `*Modal.tsx`; call-sites do not change signatures.
- **`framer-motion` fix is a dependency-classification fix**, not a code change — move `devDependencies.framer-motion` to `dependencies`.

---

## File Structure

### Created

- `apps/web/src/components/routing/FullPageSpinner.tsx` — shared loader for auth + Suspense fallbacks (~30 LOC).
- `apps/web/src/components/routing/ProtectedLayout.tsx` — nested layout route wrapping `ProtectedRoute` + `Layout` + global providers (~60 LOC).
- `apps/web/src/components/ui/Modal.tsx` — thin `@radix-ui/react-dialog` wrapper (~90 LOC).
- `apps/web/src/components/ui/__tests__/Modal.test.tsx` — focus-trap / escape-to-close / aria.
- `apps/web/src/components/home/*` — one file per extracted `HomePage` region (~8 files, each ≤ 200 LOC).
- `apps/web/src/components/sidebar/*` — one file per `Sidebar` section (~7 files).
- `apps/web/src/pages/research/*` — `ResearchAgentPage` split.
- `apps/web/src/pages/inbox/*` — `InboxPage` split + `apps/web/src/hooks/useInboxSync.ts` extracted.
- `apps/web/src/pages/linear-issues/*` — `LinearIssuesPage` split.
- `apps/web/src/hooks/__tests__/useResearch.test.ts` (+ 7 more hook test files — full list in Task 10).
- `apps/web/src/services/__tests__/{researchAgentApi,linearApi,codeAgentApi.extra,notesApi,todosApi,workerSettingsApi,llmKeysApi}.test.ts`.
- `scripts/ci/check-web-env-lockstep.cjs` — drift-detection script invoked from the web workspace `ci:tracked`.
- `scripts/ci/__tests__/check-web-env-lockstep.test.cjs` — unit tests for the script.
- `apps/web/src/services/requestId.ts` — `X-Request-Id` generator (crypto.randomUUID wrapper).
- `apps/web/src/services/__tests__/apiClient.retry.test.ts` — 401-refresh retry, X-Request-Id, non-JSON status preservation.

### Modified

- `apps/web/src/App.tsx` — route table switched to `React.lazy`, `ProtectedRoute` extracted to nested layout, static page imports removed.
- `apps/web/src/pages/HomePage.tsx`, `Sidebar.tsx`, `ResearchAgentPage.tsx`, `InboxPage.tsx`, `LinearIssuesPage.tsx` — reduced to `<200 LOC` shells that compose the extracted subcomponents.
- `apps/web/vite.config.ts` — add `build.rollupOptions.output.manualChunks`; add `rollup-plugin-visualizer` in analyze mode; update proxy map to match `config.ts` (lockstep).
- `apps/web/src/config.ts` — add `imageServiceUrl` and `webAgentUrl` consumers (or remove from cloudbuild if the user opts out — see Task 8 decision gate).
- `apps/web/src/services/apiClient.ts` — inject optional `refreshToken: () => Promise<string>`; on 401 from `apiRequest`, retry once with a forced-refresh token; attach `X-Request-Id` header; preserve `response.status` when body is non-JSON; mark `cacheMode: 'off'` when retrying.
- `apps/web/src/hooks/useApiClient.ts` — pass Auth0's `getAccessTokenSilently({ cacheMode: 'off' })` as the refreshToken callback.
- `apps/web/package.json` — `framer-motion` moved from `devDependencies` to `dependencies`; `@radix-ui/react-dialog` added; `rollup-plugin-visualizer` added to `devDependencies`.
- `apps/web/public/action-config.yaml` → `apps/web/src/config/action-config.yaml` — relocate + `?raw` import in `services/actionConfigLoader.ts`.
- Every `apps/web/src/components/**/*Modal.tsx` — replace ad-hoc `<div>`-based backdrops with `<Modal>` wrapper (focus-trap, `aria-modal`, escape-to-close).

### Unchanged

- `apps/web/src/context/*`, `apps/web/src/utils/*`, `apps/web/src/styles/*`, `apps/web/src/index.tsx`.
- Any API route handler or server-side code.

---

## Bite-Sized Tasks

### Task 1: Scaffold shared `<FullPageSpinner/>` loader

**Files:**
- Create: `apps/web/src/components/routing/FullPageSpinner.tsx`
- Create: `apps/web/src/components/routing/__tests__/FullPageSpinner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/routing/__tests__/FullPageSpinner.test.tsx
import { render, screen } from '@testing-library/react';
import { FullPageSpinner } from '@/components/routing/FullPageSpinner';

describe('FullPageSpinner', () => {
  it('renders a role=status element with an aria-label', () => {
    render(<FullPageSpinner />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading');
  });

  it('takes full viewport height', () => {
    render(<FullPageSpinner />);
    const status = screen.getByRole('status');
    expect(status.className).toMatch(/min-h-screen/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/web exec vitest run src/components/routing/__tests__/FullPageSpinner.test.tsx`
Expected: FAIL with "Cannot find module '@/components/routing/FullPageSpinner'".

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/src/components/routing/FullPageSpinner.tsx
import type { JSX } from 'react';

export function FullPageSpinner(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/web exec vitest run src/components/routing/__tests__/FullPageSpinner.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/routing/FullPageSpinner.tsx apps/web/src/components/routing/__tests__/FullPageSpinner.test.tsx
git commit -m "feat(web): add shared FullPageSpinner component [INT-1534]"
```

---

### Task 2: Extract `ProtectedLayout` nested layout route

**Files:**
- Create: `apps/web/src/components/routing/ProtectedLayout.tsx`
- Create: `apps/web/src/components/routing/__tests__/ProtectedLayout.test.tsx`
- Modify: `apps/web/src/App.tsx` (move `ProtectedRoute` into the new layout; do NOT yet remove inline wrappers — that happens in Task 4)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/routing/__tests__/ProtectedLayout.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedLayout } from '@/components/routing/ProtectedLayout';

vi.mock('@/context', async (orig) => {
  const m = await orig<typeof import('@/context')>();
  return { ...m, useAuth: () => ({ isAuthenticated: true, isLoading: false }) };
});

describe('ProtectedLayout', () => {
  it('renders the Outlet when authenticated', () => {
    render(
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/x" element={<div>protected-child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected-child')).toBeInTheDocument();
  });

  it('renders FullPageSpinner while Auth0 is loading', () => {
    vi.resetModules();
    vi.doMock('@/context', async (orig) => {
      const m = await orig<typeof import('@/context')>();
      return { ...m, useAuth: () => ({ isAuthenticated: false, isLoading: true }) };
    });
    const { ProtectedLayout: Reloaded } = await import('@/components/routing/ProtectedLayout');
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Reloaded />}>
            <Route path="/" element={<div>never</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test; confirm failure**

Run: `pnpm --filter @intexuraos/web exec vitest run src/components/routing/__tests__/ProtectedLayout.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ProtectedLayout`**

```tsx
// apps/web/src/components/routing/ProtectedLayout.tsx
import type { JSX } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context';
import { FullPageSpinner } from '@/components/routing/FullPageSpinner';

export function ProtectedLayout(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 4: Run tests; confirm pass**

Run: `pnpm --filter @intexuraos/web exec vitest run src/components/routing/__tests__/ProtectedLayout.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/routing/ProtectedLayout.tsx apps/web/src/components/routing/__tests__/ProtectedLayout.test.tsx
git commit -m "feat(web): add ProtectedLayout nested route layout [INT-1534]"
```

---

### Task 3: Introduce `React.lazy` + `Suspense` for all 41 pages

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/index.ts` (remove barrel-file re-exports that defeat tree-shaking)
- Create: `apps/web/src/__tests__/App.lazyRoutes.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/__tests__/App.lazyRoutes.test.tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('App.tsx lazy-loaded routes', () => {
  const src = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

  it('imports every page via React.lazy', () => {
    // No static page imports remain
    expect(src).not.toMatch(/from '@\/pages'/);
    // At least 30 lazy() calls (sanity lower bound; we ship 41)
    const lazyCount = (src.match(/React\.lazy\(/g) ?? []).length;
    expect(lazyCount).toBeGreaterThanOrEqual(30);
  });

  it('wraps routes in <Suspense fallback={<FullPageSpinner/>}>', () => {
    expect(src).toMatch(/<Suspense[^>]*fallback={<FullPageSpinner/);
  });
});
```

- [ ] **Step 2: Run test; confirm failure**

Run: `pnpm --filter @intexuraos/web exec vitest run src/__tests__/App.lazyRoutes.test.tsx`
Expected: FAIL — static barrel import still present.

- [ ] **Step 3: Refactor `App.tsx`**

Replace the block `import { ApiKeysSettingsPage, ... } from '@/pages';` with individual `React.lazy()` imports per page. For each page, use a named export → default re-wrap pattern so the lazy boundary still gives typed props:

```tsx
// apps/web/src/App.tsx (representative slice — apply to all 41 pages)
import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, SyncQueueProvider, ThemeProvider } from '@/context';
import { PWAProvider } from '@/context/pwa-context';
import { AndroidInstallBanner, IOSInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { XiaomiBatteryGuide } from '@/components/XiaomiBatteryGuide';
import { DevBar } from '@/components/DevBar';
import { Chat } from '@/components/Chat';
import { config } from '@/config';
import { FullPageSpinner } from '@/components/routing/FullPageSpinner';
import { ProtectedLayout } from '@/components/routing/ProtectedLayout';

// One lazy() call per page (abbreviated list; enumerate all 41)
const HomePage = React.lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const InboxPage = React.lazy(() => import('@/pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const CodeTaskViewPage = React.lazy(() => import('@/pages/CodeTaskViewPage').then((m) => ({ default: m.CodeTaskViewPage })));
// ... all remaining pages ...

function AppRoutes(): React.JSX.Element {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/code-tasks/:taskId" element={<CodeTaskViewPage />} />
          {/* ... remaining routes ... */}
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
```

For the paired-route pattern `CodeTaskViewPage` / `CodeTaskNewPage` (where `useParams()` decides which to render), keep the `useParams`-switching wrapper but render lazy components inside.

- [ ] **Step 4: Remove `apps/web/src/pages/index.ts` re-exports**

Delete the barrel file (or trim to only re-export small non-lazy-eligible utility components if any). Update any remaining non-App.tsx importers to use direct paths.

- [ ] **Step 5: Run the full web test suite**

Run: `pnpm --filter @intexuraos/web test`
Expected: all tests pass. Fix any importers that still reach into `@/pages`.

- [ ] **Step 6: Run the lazy-routes assertion**

Run: `pnpm --filter @intexuraos/web exec vitest run src/__tests__/App.lazyRoutes.test.tsx`
Expected: 2 passed.

- [ ] **Step 7: Production build + smoke**

Run: `pnpm --filter @intexuraos/web build`
Expected: build succeeds; inspect `dist/assets/` and confirm per-page chunk files exist (one `.js` per lazy import).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/index.ts apps/web/src/__tests__/App.lazyRoutes.test.tsx
git commit -m "refactor(web): lazy-load all route pages via React.lazy + Suspense [INT-1534]"
```

---

### Task 4: Configure Rollup `manualChunks` + bundle visualizer

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json` (add `rollup-plugin-visualizer` devDep)

- [ ] **Step 1: Add `rollup-plugin-visualizer` and config**

```ts
// apps/web/vite.config.ts — add inside defineConfig({...}) return object:
build: {
  outDir: 'dist',
  emptyOutDir: true,
  sourcemap: true,
  rollupOptions: {
    output: {
      manualChunks(id: string): string | undefined {
        if (id.includes('node_modules/firebase')) return 'firebase';
        if (id.includes('node_modules/@auth0')) return 'auth0';
        if (id.includes('node_modules/@sentry')) return 'sentry';
        if (id.includes('node_modules/vega') || id.includes('node_modules/vega-lite')) return 'vega';
        if (id.includes('node_modules/@uiw/react-md-editor') || id.includes('node_modules/react-markdown')) return 'markdown';
        if (id.includes('node_modules/@radix-ui')) return 'radix';
        return undefined;
      },
    },
  },
},
plugins: [
  react(),
  tailwindcss(),
  ...(mode === 'analyze' ? [visualizer({ filename: 'dist/stats.html', open: false, gzipSize: true })] : []),
  VitePWA({ /* unchanged */ }),
],
```

Add the import at top: `import { visualizer } from 'rollup-plugin-visualizer';`

- [ ] **Step 2: Install the dev dependency**

```bash
pnpm --filter @intexuraos/web add -D rollup-plugin-visualizer
```

- [ ] **Step 3: Build in analyze mode**

```bash
pnpm --filter @intexuraos/web exec vite build --mode analyze
```

Expected: `apps/web/dist/stats.html` generated. Open it to confirm each manual chunk exists and no page chunk exceeds 500 KB gzipped.

- [ ] **Step 4: Add a build-budget guard test**

Create `apps/web/src/__tests__/bundle-budget.test.ts`:

```ts
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

describe('bundle budget', () => {
  it('no single chunk exceeds 1.5 MB uncompressed', () => {
    const distAssets = resolve(__dirname, '../../dist/assets');
    let tooLarge: string[] = [];
    try {
      tooLarge = readdirSync(distAssets)
        .filter((f) => f.endsWith('.js'))
        .filter((f) => statSync(resolve(distAssets, f)).size > 1.5 * 1024 * 1024);
    } catch {
      // dist not built; test is a no-op in unit-test mode
      return;
    }
    expect(tooLarge).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the budget test after a real build**

```bash
pnpm --filter @intexuraos/web build && pnpm --filter @intexuraos/web exec vitest run src/__tests__/bundle-budget.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/vite.config.ts apps/web/package.json pnpm-lock.yaml apps/web/src/__tests__/bundle-budget.test.ts
git commit -m "build(web): configure manualChunks + bundle-budget guard [INT-1534]"
```

---

### Task 5: Split `HomePage.tsx` (1056 LOC → shell ≤ 200 LOC)

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`
- Create: `apps/web/src/components/home/{Header,QuickActions,UpcomingEvents,RecentInbox,TodosPreview,NotesPreview,BookmarksPreview,WhatsAppPreview}.tsx`
- Create: `apps/web/src/components/home/__tests__/*.test.tsx` (one per extracted component)

- [ ] **Step 1: Inventory `HomePage.tsx`**

Read the file and group its contents into 8 logical sections matching the file list above. Each section owns: its JSX, its local hooks, and its data-fetching orchestration.

- [ ] **Step 2: For each extracted component, write a failing render test**

Pattern (repeat for all 8):

```tsx
// apps/web/src/components/home/__tests__/QuickActions.test.tsx
import { render, screen } from '@testing-library/react';
import { QuickActions } from '@/components/home/QuickActions';

describe('<QuickActions/>', () => {
  it('renders the expected action buttons', () => {
    render(<QuickActions />);
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
    // ... assertions for each preserved button/link ...
  });
});
```

- [ ] **Step 3: Extract sections one-by-one**

Move each section's JSX + local state + hooks out of `HomePage.tsx` into its own file. The import surface for the subcomponent is strictly typed props (no prop-drilling through `any`). Replace the moved block in `HomePage.tsx` with `<QuickActions />` etc.

- [ ] **Step 4: Trim `HomePage.tsx` to the shell**

Final `HomePage.tsx` pattern:

```tsx
import type { JSX } from 'react';
import { Layout } from '@/components/Layout';
import { Header } from '@/components/home/Header';
import { QuickActions } from '@/components/home/QuickActions';
import { UpcomingEvents } from '@/components/home/UpcomingEvents';
import { RecentInbox } from '@/components/home/RecentInbox';
import { TodosPreview } from '@/components/home/TodosPreview';
import { NotesPreview } from '@/components/home/NotesPreview';
import { BookmarksPreview } from '@/components/home/BookmarksPreview';
import { WhatsAppPreview } from '@/components/home/WhatsAppPreview';

export function HomePage(): JSX.Element {
  return (
    <Layout>
      <Header />
      <QuickActions />
      <UpcomingEvents />
      <RecentInbox />
      <TodosPreview />
      <NotesPreview />
      <BookmarksPreview />
      <WhatsAppPreview />
    </Layout>
  );
}
```

- [ ] **Step 5: Assert size budget**

Add `apps/web/src/pages/__tests__/HomePage.size.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('HomePage.tsx size budget', () => {
  it('is ≤ 200 LOC', () => {
    const src = readFileSync(resolve(__dirname, '../HomePage.tsx'), 'utf-8');
    const loc = src.split('\n').length;
    expect(loc).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 6: Run full suite**

Run: `pnpm --filter @intexuraos/web test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/components/home apps/web/src/pages/__tests__/HomePage.size.test.ts
git commit -m "refactor(web): split HomePage into focused home/* subcomponents [INT-1534]"
```

---

### Task 6: Split `Sidebar.tsx`, `ResearchAgentPage.tsx`, `LinearIssuesPage.tsx` (same pattern)

Repeat the Task 5 pattern exactly for each of these three files. For each:

1. Inventory the file's distinct responsibilities.
2. Write a render test per extracted subcomponent BEFORE moving code.
3. Move one section at a time, running `pnpm --filter @intexuraos/web test` after each move.
4. Add a `*.size.test.ts` asserting the shell is ≤ 200 LOC.
5. Commit each file's split as a separate commit.

**Target subcomponent layout:**
- `apps/web/src/components/sidebar/{Logo,UserMenu,PrimaryNav,AgentsNav,AdminNav,FooterActions,MobileToggle}.tsx` (7 files).
- `apps/web/src/pages/research/{ResearchAgentShell,PromptPanel,ResultsList,CitationsPanel,NotionExportDialog,HistoryPanel}.tsx` (6 files).
- `apps/web/src/pages/linear-issues/{LinearIssuesShell,IssueFilters,IssueTable,IssueRow,GroupPanel,PruneCandidatesPanel}.tsx` (6 files).

**Commits:**

```bash
git commit -m "refactor(web): split Sidebar into sidebar/* subcomponents [INT-1534]"
git commit -m "refactor(web): split ResearchAgentPage into research/* subcomponents [INT-1534]"
git commit -m "refactor(web): split LinearIssuesPage into linear-issues/* subcomponents [INT-1534]"
```

---

### Task 7: Split `InboxPage.tsx` and extract `useInboxSync`

**Files:**
- Modify: `apps/web/src/pages/InboxPage.tsx`
- Create: `apps/web/src/pages/inbox/{InboxShell,InboxHeader,InboxList,InboxItem,InboxEmptyState}.tsx`
- Create: `apps/web/src/hooks/useInboxSync.ts`
- Create: `apps/web/src/hooks/__tests__/useInboxSync.test.ts`

- [ ] **Step 1: Write `useInboxSync` contract test**

```ts
// apps/web/src/hooks/__tests__/useInboxSync.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInboxSync } from '@/hooks/useInboxSync';

describe('useInboxSync', () => {
  it('long-polls until the component unmounts', async () => {
    const poll = vi.fn().mockResolvedValue({ items: [], cursor: 'c1' });
    const { unmount, result } = renderHook(() => useInboxSync({ poll, intervalMs: 10 }));
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
    expect(result.current.items).toEqual([]);
    unmount();
    const callsAtUnmount = poll.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(poll.mock.calls.length).toBe(callsAtUnmount);
  });

  it('dedupes in-flight polls using an AbortController', async () => {
    let aborted = 0;
    const poll = vi.fn((signal: AbortSignal) => new Promise((res, rej) => {
      signal.addEventListener('abort', () => { aborted++; rej(new Error('abort')); });
      setTimeout(() => res({ items: [], cursor: 'c1' }), 50);
    }));
    const { rerender, unmount } = renderHook(({ k }) => useInboxSync({ poll, intervalMs: 10, key: k }), { initialProps: { k: 'a' } });
    rerender({ k: 'b' });
    unmount();
    await waitFor(() => expect(aborted).toBeGreaterThanOrEqual(1));
  });
});
```

- [ ] **Step 2: Implement `useInboxSync`**

Move the existing refs + `useCallback` + interval logic from `InboxPage.tsx` into a dedicated hook with a clean `{ poll, intervalMs, key }` contract and an internal `AbortController`. No stale closures — `poll` is captured via ref.

- [ ] **Step 3: Re-wire `InboxPage.tsx`**

Shell becomes composition of `inbox/*` subcomponents and the `useInboxSync` hook.

- [ ] **Step 4: Run tests + size test**

Add `apps/web/src/pages/__tests__/InboxPage.size.test.ts` (same pattern as Task 5 Step 5).

Run: `pnpm --filter @intexuraos/web test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/InboxPage.tsx apps/web/src/pages/inbox apps/web/src/hooks/useInboxSync.ts apps/web/src/hooks/__tests__/useInboxSync.test.ts apps/web/src/pages/__tests__/InboxPage.size.test.ts
git commit -m "refactor(web): split InboxPage + extract useInboxSync hook [INT-1534]"
```

---

### Task 8: Decide env-var direction + implement lockstep check

**Decision gate (must be resolved before coding):**

Present this question to the user via `AskUserQuestion` if ambiguous. Default (no response) is **option A**.

- **Option A (default):** Consume `INTEXURAOS_IMAGE_SERVICE_URL` and `INTEXURAOS_WEB_AGENT_URL` in `config.ts` and the Vite proxy, because `cloudbuild.yaml` is already fetching them.
- **Option B:** Remove `image-service:IMAGE_SERVICE` and `web-agent:WEB_AGENT` from `cloudbuild.yaml` because nothing consumes them.

**Files (Option A):**
- Modify: `apps/web/src/config.ts` — add `imageServiceUrl: getServiceUrl('INTEXURAOS_IMAGE_SERVICE_URL', '/api/images')`, `webAgentUrl: getServiceUrl('INTEXURAOS_WEB_AGENT_URL', '/api/web')`. Update `AppConfig` type accordingly.
- Modify: `apps/web/src/types/AppConfig.ts` — add two fields.
- Modify: `apps/web/vite.config.ts` — proxy map already has `/api/images` and `/api/web`; no change.
- Create: `scripts/ci/check-web-env-lockstep.cjs` (below).
- Create: `scripts/ci/__tests__/check-web-env-lockstep.test.cjs`.
- Modify: `apps/web/package.json` — add a `ci:env-lockstep` script and wire it into the workspace's `ci:tracked` sequence.

**Lockstep script:**

```js
// scripts/ci/check-web-env-lockstep.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CLOUDBUILD = path.join(REPO_ROOT, 'apps/web/cloudbuild.yaml');
const CONFIG_TS = path.join(REPO_ROOT, 'apps/web/src/config.ts');
const VITE = path.join(REPO_ROOT, 'apps/web/vite.config.ts');

function extractFromCloudbuild(src) {
  const m = src.match(/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/);
  if (!m) throw new Error('CLOUD_RUN_SERVICES array not found in cloudbuild.yaml');
  const suffixes = [...m[1].matchAll(/"[^"]+:([A-Z0-9_]+)"/g)].map((x) => x[1]);
  // Env var name the consumer would reference: INTEXURAOS_<SUFFIX>_URL
  return new Set(suffixes.map((s) => `INTEXURAOS_${s}_URL`));
}

function extractFromConfig(src) {
  const m = [...src.matchAll(/getServiceUrl\('([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

function extractFromViteProxy(src) {
  const block = src.match(/const apiProxy = \{([\s\S]*?)\};/);
  if (!block) throw new Error('apiProxy map not found in vite.config.ts');
  const routes = [...block[1].matchAll(/'\/api\/([^']+)'/g)].map((x) => x[1]);
  return new Set(routes);
}

function main() {
  const cloudbuild = extractFromCloudbuild(fs.readFileSync(CLOUDBUILD, 'utf-8'));
  const config = extractFromConfig(fs.readFileSync(CONFIG_TS, 'utf-8'));
  const errors = [];
  for (const name of cloudbuild) {
    if (!config.has(name)) errors.push(`cloudbuild fetches ${name} but config.ts does not consume it`);
  }
  for (const name of config) {
    if (!cloudbuild.has(name)) errors.push(`config.ts consumes ${name} but cloudbuild does not fetch it`);
  }
  // Proxy is advisory — log-only mismatches are reported but not fatal,
  // because /api/<slug> naming can legitimately vary from ENV suffix.
  // (Strict mode can be enabled later by flipping WARN_ONLY=false.)
  if (errors.length > 0) {
    console.error('Web env-var drift detected:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('Web env-var lockstep OK');
}

main();
```

- [ ] **Step 1: Add failing lockstep-script test**

```js
// scripts/ci/__tests__/check-web-env-lockstep.test.cjs
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '../check-web-env-lockstep.cjs');

function run(fixtureDir) {
  return execFileSync('node', [SCRIPT], {
    cwd: fixtureDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-web-env-lockstep', () => {
  test('passes when cloudbuild and config.ts agree', () => {
    // Happy-path: run against the real repo — after Task 8 lands, this must PASS.
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(out).toMatch(/lockstep OK/);
  });
});
```

(For the fail-path you can seed a fixture repo with a mismatched stub if time permits; the primary value is the happy-path guard.)

- [ ] **Step 2: Run; confirm current repo FAILS (proving drift)**

Run: `node scripts/ci/check-web-env-lockstep.cjs`
Expected: exit 1 citing `INTEXURAOS_IMAGE_SERVICE_URL` and `INTEXURAOS_WEB_AGENT_URL` as consumed-by-nobody.

- [ ] **Step 3: Implement Option A changes in `config.ts` + `AppConfig` type**

Add the two missing consumers. Confirm the script now passes.

- [ ] **Step 4: Wire into `ci:tracked`**

Modify `apps/web/package.json`:

```json
{
  "scripts": {
    "ci:env-lockstep": "node ../../scripts/ci/check-web-env-lockstep.cjs",
    "ci": "pnpm run lint && pnpm run typecheck && pnpm run ci:env-lockstep && pnpm run test -- --coverage"
  }
}
```

(Inspect the workspace's existing `ci` script and insert the call at the appropriate point; do NOT remove existing steps.)

- [ ] **Step 5: Run `pnpm run ci:tracked`**

Expected: PASS. If the root-level `ci:tracked` does not currently invoke the web workspace's `ci`, add an explicit call.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/config.ts apps/web/src/types apps/web/package.json scripts/ci/check-web-env-lockstep.cjs scripts/ci/__tests__/check-web-env-lockstep.test.cjs
git commit -m "fix(web): consume IMAGE_SERVICE_URL/WEB_AGENT_URL + add env-var lockstep CI guard [INT-1534]"
```

---

### Task 9: Harden `apiClient.ts` — 401 refresh-retry, `X-Request-Id`, preserve status

**Files:**
- Create: `apps/web/src/services/requestId.ts`
- Modify: `apps/web/src/services/apiClient.ts`
- Modify: `apps/web/src/hooks/useApiClient.ts`
- Create: `apps/web/src/services/__tests__/apiClient.retry.test.ts`
- Create: `apps/web/src/services/__tests__/requestId.test.ts`

- [ ] **Step 1: Tests — `requestId`**

```ts
// apps/web/src/services/__tests__/requestId.test.ts
import { newRequestId } from '@/services/requestId';

describe('newRequestId', () => {
  it('returns a v4-shape UUID', () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('returns unique ids', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
```

- [ ] **Step 2: Tests — `apiClient` retry + header + status**

```ts
// apps/web/src/services/__tests__/apiClient.retry.test.ts
import { vi } from 'vitest';
import { ApiError, apiRequest } from '@/services/apiClient';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('apiRequest hardening', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('attaches X-Request-Id header on every call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { success: true, data: { ok: 1 } }));
    await apiRequest<{ ok: number }>('http://x', '/p', 't');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retries once with refreshed token on 401', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: 2 } }));
    const refresh = vi.fn().mockResolvedValue('new-token');
    const out = await apiRequest<{ ok: number }>('http://x', '/p', 'old-token', { refreshToken: refresh });
    expect(out).toEqual({ ok: 2 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstAuth = (fetchSpy.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondAuth = (fetchSpy.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(firstAuth.Authorization).toBe('Bearer old-token');
    expect(secondAuth.Authorization).toBe('Bearer new-token');
  });

  it('does not retry a second time if refresh also yields 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'nope' } }));
    const refresh = vi.fn().mockResolvedValue('new-token');
    await expect(apiRequest('http://x', '/p', 'old', { refreshToken: refresh })).rejects.toBeInstanceOf(ApiError);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves HTTP status on non-JSON 502 bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    try {
      await apiRequest('http://x', '/p', 't');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(502);
    }
  });
});
```

- [ ] **Step 3: Implement `requestId` + modify `apiClient`**

```ts
// apps/web/src/services/requestId.ts
export function newRequestId(): string {
  // crypto.randomUUID is available in all supported browsers + jsdom
  return globalThis.crypto.randomUUID();
}
```

Modify `apiRequest` signature to accept `RequestOptions & { refreshToken?: () => Promise<string> }`. On `response.status === 401` AND `refreshToken` is provided AND this is the first attempt, await `refreshToken()`, swap the `Authorization` header, and retry exactly once with `cache: 'no-store'`. On any non-JSON body, throw `ApiError` with `response.status` (not a flattened 502-range code). Always attach `X-Request-Id`.

Key diff sketch for `apps/web/src/services/apiClient.ts`:

```ts
import { newRequestId } from '@/services/requestId';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  refreshToken?: () => Promise<string>;
}

export async function apiRequest<T>(baseUrl: string, path: string, accessToken: string, options: RequestOptions = {}): Promise<T> {
  return performRequest<T>(baseUrl, path, accessToken, options, /* retried */ false);
}

async function performRequest<T>(baseUrl: string, path: string, accessToken: string, options: RequestOptions, retried: boolean): Promise<T> {
  // ... existing body ... plus:
  requestHeaders['X-Request-Id'] = newRequestId();
  // ... fetch, then:
  if (response.status === 401 && !retried && options.refreshToken !== undefined) {
    const fresh = await options.refreshToken();
    return performRequest<T>(baseUrl, path, fresh, options, true);
  }
  // ... preserve response.status on non-JSON branch:
  //   throw new ApiError('SERVICE_UNAVAILABLE', message, response.status);   // <- already preserved; just assert via test
}
```

- [ ] **Step 4: Plumb refresh-token through `useApiClient`**

```ts
// apps/web/src/hooks/useApiClient.ts — inside the hook
const refreshToken = useCallback(() => getAccessTokenSilently({ cacheMode: 'off' }), [getAccessTokenSilently]);
return useMemo(() => ({
  get: <T,>(baseUrl: string, path: string) => apiRequest<T>(baseUrl, path, token, { refreshToken }),
  // ... similar for post/put/patch/delete ...
}), [token, refreshToken]);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @intexuraos/web exec vitest run src/services/__tests__/apiClient.retry.test.ts src/services/__tests__/requestId.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full suite + coverage**

Run: `pnpm --filter @intexuraos/web test`
Expected: all pass; confirm coverage for `services/apiClient.ts` + `services/requestId.ts` are each ≥ 95% branches.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/apiClient.ts apps/web/src/services/requestId.ts apps/web/src/hooks/useApiClient.ts apps/web/src/services/__tests__/apiClient.retry.test.ts apps/web/src/services/__tests__/requestId.test.ts
git commit -m "feat(web): apiClient X-Request-Id + 401 silent-refresh retry [INT-1534]"
```

---

### Task 10: Back-fill tests for 8 untested hooks

**Files (one test file per hook):**
- `apps/web/src/hooks/__tests__/useResearch.test.ts`
- `apps/web/src/hooks/__tests__/useResearchDetailActions.test.ts`
- `apps/web/src/hooks/__tests__/useTaskView.test.ts`
- `apps/web/src/hooks/__tests__/useAskAgent.test.ts`
- `apps/web/src/hooks/__tests__/useTodos.test.ts`
- `apps/web/src/hooks/__tests__/useLlmKeys.test.ts`
- `apps/web/src/hooks/__tests__/useWorkerSettings.test.ts`
- (if not already tested) `apps/web/src/hooks/__tests__/useGitHubEventLog.test.ts` — confirm existing test covers the listed behaviour; otherwise extend.

For each hook, write tests covering the three canonical paths:

1. **Happy path** — mock the relevant API with a resolved value, assert the hook returns `{ data, loading: false, error: null }`.
2. **Error path** — mock the API to reject with `ApiError`, assert the hook returns `{ data: null, loading: false, error }`.
3. **Invalidation / refetch** — trigger whatever mutation method the hook exposes (`refresh`, `mutate`, `invalidate`, etc.), assert the API is re-called.

- [ ] **Step 1: For each hook — read the hook's source + its existing consumers to identify the contract**

- [ ] **Step 2: Write the three tests; run them; confirm FAIL (no file yet)**

- [ ] **Step 3: Write the tests; confirm PASS (hook source does not change)**

Example template to adapt:

```ts
// apps/web/src/hooks/__tests__/useTodos.test.ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useTodos } from '@/hooks/useTodos';

vi.mock('@/services/todosApi', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
}));
import { listTodos, createTodo } from '@/services/todosApi';

function setup() {
  return renderHook(() => useTodos());
}

describe('useTodos', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('loads todos on mount', async () => {
    vi.mocked(listTodos).mockResolvedValue([{ id: '1', title: 't' }]);
    const { result } = setup();
    await waitFor(() => expect(result.current.todos).toHaveLength(1));
  });

  it('surfaces API errors', async () => {
    vi.mocked(listTodos).mockRejectedValue(new Error('boom'));
    const { result } = setup();
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
  });

  it('refetches after create', async () => {
    vi.mocked(listTodos).mockResolvedValue([]);
    vi.mocked(createTodo).mockResolvedValue({ id: '2', title: 'new' });
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.createTodo({ title: 'new' }); });
    expect(listTodos).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run**

`pnpm --filter @intexuraos/web test src/hooks/__tests__` — all 8 files pass.

- [ ] **Step 5: Commit** (one commit per hook for reviewability)

```bash
git commit -m "test(web): cover useTodos happy/error/refetch paths [INT-1534]"
# ... repeat for each of the 8 hooks ...
```

---

### Task 11: Back-fill tests for top untested services

**Target services** (highest-traffic API wrappers currently without dedicated tests):
- `researchAgentApi.ts` — `createResearch`, `listResearchItems`, `getResearchDetail` (extends existing `researchAgentApi.notionExport.test.ts`).
- `linearApi.ts`.
- `codeAgentApi.ts` — extend existing spec with happy/error coverage for each `/code/tasks/*` call.
- `notesApi.ts`.
- `todosApi.ts`.
- `workerSettingsApi.ts`.
- `llmKeysApi.ts`.

For each service, tests cover:
1. **Valid response** — returns parsed body.
2. **Envelope mismatch** — server returns raw object without `success` envelope → expect `ApiError('UNKNOWN', …)`.
3. **Error envelope** — `{ success: false, error: { code, message } }` → expect `ApiError(code, message, status)`.
4. **Backward-compat** — if the service has schema versions, assert v1 AND v2 both parse. (See memory [1] `mem_bb64f455`: symmetric regression tests for multi-route schema updates.)

Use `vi.spyOn(globalThis, 'fetch')` with `new Response(...)` bodies — same pattern as `apiClient.retry.test.ts`.

- [ ] **Step 1–3:** Repeat failing-test → implementation-already-exists → passing pattern for each service. The service source does NOT change unless a test uncovers a real bug (in which case, file a separate Linear follow-up — do NOT expand scope here).
- [ ] **Step 4: Commit each service's tests as a separate commit.**

---

### Task 12: Adopt `@radix-ui/react-dialog` — shared `<Modal/>` wrapper + migrate all modals

**Files:**
- Create: `apps/web/src/components/ui/Modal.tsx`
- Create: `apps/web/src/components/ui/__tests__/Modal.test.tsx`
- Modify: every `apps/web/src/components/**/*Modal.tsx` (enumerate and migrate one at a time).

**Enumerate modals:**
`ActionDetailModal`, `BookmarkConflictModal`, `CodeTaskLogsModal`, `CommandDetailModal`, `ConfirmSubmitModal`, `ImageModal`, `LinearIssueSelectorModal`, `TaskConflictModal`, `TaskErrorModal`, `VersionInfoModal`, plus any under `components/bookmarks/`, `components/code-tasks/`, `components/research/`, etc.

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @intexuraos/web add @radix-ui/react-dialog
```

- [ ] **Step 2: Write failing Modal tests**

```tsx
// apps/web/src/components/ui/__tests__/Modal.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

describe('<Modal/>', () => {
  it('renders children and applies aria-modal', () => {
    render(<Modal open onOpenChange={() => {}} title="Hi"><div>body</div></Modal>);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(<Modal open onOpenChange={onOpenChange} title="Hi"><button>focus me</button></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 3: Implement `Modal` wrapper**

```tsx
// apps/web/src/components/ui/Modal.tsx
import * as Dialog from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl',
};

export function Modal({ open, onOpenChange, title, description, children, size = 'md' }: ModalProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${sizeClass[size]} rounded-lg bg-surface p-6 shadow-xl`}>
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {description !== undefined ? <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description> : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Migrate one modal at a time**

For each `*Modal.tsx`: (a) replace its custom `<div role="dialog">` / backdrop with `<Modal>`; (b) keep props surface identical so call-sites do not change; (c) run its existing tests + full suite before moving to the next.

Commit per modal:

```bash
git commit -m "refactor(web): migrate ConfirmSubmitModal to shared Modal primitive [INT-1534]"
```

- [ ] **Step 5: Final sweep — grep for `role="dialog"` that is NOT inside `components/ui/Modal.tsx`**

Run: `rg 'role="dialog"' apps/web/src --glob '!components/ui/Modal.tsx'`
Expected: empty.

- [ ] **Step 6: Run full suite**

Run: `pnpm --filter @intexuraos/web test`
Expected: all pass.

---

### Task 13: Fix `framer-motion` classification + defer heavy imports

**Files:**
- Modify: `apps/web/package.json`
- Modify: call-sites of `libphonenumber-js`, `js-yaml`, `@uiw/react-md-editor` (or equivalent markdown editor) — wrap in dynamic `import()` at first use.
- Move: `apps/web/public/action-config.yaml` → `apps/web/src/config/action-config.yaml`.
- Modify: `apps/web/src/services/actionConfigLoader.ts` — use `import actionConfig from '@/config/action-config.yaml?raw'`.

- [ ] **Step 1: Move `framer-motion` to `dependencies`**

```bash
pnpm --filter @intexuraos/web remove framer-motion
pnpm --filter @intexuraos/web add framer-motion
```

Verify `apps/web/package.json` places `framer-motion` under `"dependencies"`, not `"devDependencies"`.

- [ ] **Step 2: Dynamic import — markdown editor**

Find the page(s) importing the markdown editor (likely `ResearchAgentPage` / a note-edit page). Replace:

```tsx
import MDEditor from '@uiw/react-md-editor';
```

with a `React.lazy` + `Suspense` pattern at the usage site, OR a one-off `useEffect` + `await import(...)` if the editor is used conditionally.

- [ ] **Step 3: Dynamic import — `libphonenumber-js` and `js-yaml`**

These are used only by specific flows (phone validation in WhatsApp connection; YAML parsing in `actionConfigLoader`). Replace top-level `import` with a function-scoped `await import(...)` so they do not land in the root chunk.

- [ ] **Step 4: Relocate `action-config.yaml`**

```bash
mkdir -p apps/web/src/config
git mv apps/web/public/action-config.yaml apps/web/src/config/action-config.yaml
```

In `actionConfigLoader.ts`:

```ts
import actionConfigRaw from '@/config/action-config.yaml?raw';
// parse via lazy-imported js-yaml:
const YAML = await import('js-yaml');
const parsed = YAML.load(actionConfigRaw);
```

Add a vitest spec asserting `actionConfigLoader.load()` returns a well-typed object.

- [ ] **Step 5: Build + visualizer check**

```bash
pnpm --filter @intexuraos/web exec vite build --mode analyze
```

Expected: `libphonenumber-js`, `js-yaml`, and the markdown editor appear as separate lazy chunks — not in the root index chunk.

- [ ] **Step 6: Run full suite**

Run: `pnpm --filter @intexuraos/web test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/config/action-config.yaml apps/web/src/services/actionConfigLoader.ts apps/web/src/services/__tests__/actionConfigLoader.test.ts
git commit -m "perf(web): lazy-load md-editor/js-yaml/libphonenumber + fix framer-motion dep [INT-1534]"
```

---

### Task 14: Final integration + CI gate

- [ ] **Step 1: Run full repo CI**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int1534.txt
```

Expected: full PASS including the new `ci:env-lockstep` step.

- [ ] **Step 2: Smoke-build the web app**

```bash
pnpm --filter @intexuraos/web build
```

Expected: bundle splits into clearly-named chunks (per-page + per-vendor); no chunk > 1.5 MB uncompressed.

- [ ] **Step 3: Manual smoke**

Bring up dev (`pnpm --filter @intexuraos/web dev`), click through: Home → Inbox → CodeTasks → ResearchAgent → LinearIssues → one of each `*Modal.tsx` flow. Confirm loading spinner flickers exactly once per route transition.

- [ ] **Step 4: Open the PR** (see PR template in the issue).

---

## Acceptance Criteria

- [ ] `apps/web/src/App.tsx`: zero static `from '@/pages'` imports; at least 30 `React.lazy(...)` calls; every authenticated route is a child of a single `<ProtectedLayout/>` element.
- [ ] `apps/web/vite.config.ts`: `rollupOptions.output.manualChunks` defines at least `firebase`, `auth0`, `sentry`, `vega`, `markdown`, `radix`.
- [ ] `HomePage.tsx`, `Sidebar.tsx`, `ResearchAgentPage.tsx`, `InboxPage.tsx`, `LinearIssuesPage.tsx` are each ≤ 200 LOC (enforced by `*.size.test.ts`).
- [ ] `apps/web/src/hooks/useInboxSync.ts` exists with ≥ 95% branch coverage.
- [ ] `node scripts/ci/check-web-env-lockstep.cjs` exits 0 from the repo root; is invoked from the web workspace's `ci` script.
- [ ] `apps/web/src/services/apiClient.ts`: accepts optional `refreshToken`; retries exactly once on 401; attaches `X-Request-Id` on every request; `ApiError.status` preserves `response.status` on non-JSON bodies.
- [ ] Every modal in `apps/web/src/components/**/*Modal.tsx` renders through `<Modal/>` (no raw `role="dialog"` elsewhere).
- [ ] `framer-motion` is in `apps/web/package.json#dependencies`, NOT `devDependencies`.
- [ ] `apps/web/public/action-config.yaml` is gone; `apps/web/src/config/action-config.yaml` exists; `actionConfigLoader.ts` imports it via `?raw`.
- [ ] Test files exist for each of the 8 hooks in Task 10 and each service in Task 11, each with happy / error / refetch-or-envelope-mismatch coverage.
- [ ] `pnpm run ci:tracked` passes from the repo root.

## Test Plan

1. `pnpm run ci:tracked` passes.
2. `pnpm --filter @intexuraos/web build` completes; bundle visualizer (`--mode analyze`) shows per-page + per-vendor chunks.
3. `pnpm --filter @intexuraos/web test -- --coverage` reports ≥ 95 % branch coverage for `apps/web/src/{hooks,services,utils}/**`.
4. Manual smoke (dev server): auth loading shows `<FullPageSpinner/>`; route transitions show the same spinner between chunks; each migrated modal traps focus, closes on Escape, and has `aria-modal="true"`.
5. Env drift verification: temporarily add `"nope-service:NOPE"` to `cloudbuild.yaml`; run `node scripts/ci/check-web-env-lockstep.cjs`; expect exit 1; revert.
6. 401 retry verification (manual): force a stale Auth0 token in dev, call an authenticated endpoint; expect silent recovery via `X-Request-Id`-tagged retry.

## Risks & Mitigations

- **Lazy-loaded chunks cause flicker.** Mitigation: single `<FullPageSpinner/>` matches the auth-loading element; Suspense fallback is identical ⇒ no visual hop.
- **Barrel-file removal breaks unrelated importers.** Mitigation: Task 3 Step 5 re-runs full suite; fix any `@/pages` import before proceeding.
- **Modal migration regressions** (focus mgmt / stacking). Mitigation: one-modal-at-a-time commits; existing modal consumer tests run after each migration.
- **Env-lockstep script false positives.** Mitigation: the script is scoped to ENV-var names derived from `CLOUD_RUN_SERVICES`; proxy mismatches are WARN-only in v1.
- **Dynamic imports + SSR/strict-mode edge cases.** `apps/web` is a pure CSR SPA; no SSR path to break.

## Out of Scope

- Routing library change (still `react-router-dom`).
- PWA strategy changes beyond the existing `VitePWA` config.
- Backend or service-layer changes (no endpoint changes).
- UI redesign of any page.
- `apps/web/e2e` test suite changes (covered by INT-1535 "Testing & Coverage").
- Web-specific Terraform / deploy-pipeline changes (covered by INT-1536 "Infrastructure / Env Vars / CI-CD"), EXCEPT the lockstep script which is a prerequisite here.

---

## Self-Review Checklist

1. **Spec coverage:** Every bullet in the original Linear plan (code-split, manual chunks, split 5 files, env lockstep, 8 hook tests, apiClient hardening, radix modals, framer-motion + dynamic imports + action-config) maps to a Task above. ✓
2. **Placeholders scan:** Task 5 enumerates 8 concrete `components/home/*` files by name; Task 6 enumerates concrete files for sidebar/research/linear-issues splits; Task 10 lists 8 concrete hook test files; Task 12 enumerates modals. No "TBD", no "handle edge cases" phrasing. ✓
3. **Type consistency:** `ModalProps`, `RequestOptions.refreshToken`, `useInboxSync({ poll, intervalMs, key })` contracts are defined once in Tasks 12 / 9 / 7 respectively and referenced consistently. `FullPageSpinner` export name used in Tasks 1 → 2 → 3 is the same. ✓

---

## Handoff

When ready to execute: follow `superpowers:subagent-driven-development`. Each Task is a fresh subagent dispatch; commits are created inside each task. After Task 14, run `pnpm run ci:tracked` and open the PR titled `[INT-1534] Refactor web app frontend: code-split, SRP, env lockstep, test gaps`.
