# Linear Cleanup Monitoring & Safe Execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the hourly Linear prune scheduler from overwriting unreviewed candidates, and add a visible status indicator in the web app header showing whether prune candidates are pending.

**Architecture:** Two changes: (1) The `pruneIssues` use case gains an early-exit guard that checks `pruneCandidateRepo.listAll()` and skips when candidates already exist. (2) The web app Header gains a "Linear Cleanup" row (below Workers) that fetches `GET /linear/prune-candidates` and renders a green/red dot based on whether the array is empty. No new backend endpoints needed — the existing `GET /linear/prune-candidates` already returns what the UI needs.

**Tech Stack:** TypeScript, Fastify, React, Vitest, TailwindCSS

---

## Endpoint Changes

- **Modified:** none
- **Created:** none
- **Removed:** none
- **Unchanged:** `GET /linear/prune-candidates`, `DELETE /linear/prune-candidates`, `POST /internal/linear/prune-issues`

The existing `GET /linear/prune-candidates` already returns `{ candidates: StoredPruneCandidate[] }` which is sufficient for both the existing prune candidates page and the new header indicator. No new endpoint is needed.

---

## File Structure

| Action   | File                                                                         | Responsibility                                                          |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Modify   | `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`                | Add early-exit when candidates already exist                            |
| Modify   | `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts` | Test the new skip-when-pending guard                                    |
| Modify   | `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`            | Integration test for the route-level skip behavior                      |
| Create   | `apps/web/src/hooks/usePruneCandidateStatus.ts`                              | Hook that fetches candidate count on mount + interval                   |
| Create   | `apps/web/src/hooks/__tests__/usePruneCandidateStatus.test.ts`               | Test hook polling, loading state, error state, and cleanup              |
| Modify   | `apps/web/src/hooks/index.ts`                                                | Re-export the new hook                                                  |
| Modify   | `apps/web/src/components/Header.tsx`                                         | Render "Linear Cleanup" indicator below workers section                 |
| Modify   | `apps/web/src/components/__tests__/Header.test.tsx`                          | Mock new hook and add Trash2 to lucide-react mock                       |

---

### Task 1: Backend — Skip pruning when candidates are pending (use case)

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`
- Test: `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`

- [ ] **Step 1: Write failing test — skips when pending candidates exist**

Add this test to the existing `describe('pruneIssues', ...)` block in `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`:

```typescript
it('skips pruning when prune candidates are already pending review', async () => {
  const issues = Array.from({ length: 210 }, (_, i) =>
    createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
  );
  (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

  // Seed existing candidates — simulates a previous run that hasn't been reviewed yet
  (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
    ok([
      {
        id: 'existing-1',
        identifier: 'INT-999',
        title: 'Old candidate',
        score: 80,
        reason: 'Cancelled',
        category: 'cancelled' as const,
        classifiedAt: '2026-04-01T00:00:00.000Z',
      },
    ])
  );

  const result = await pruneIssues(deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.skipped).toBe(true);
  expect(result.value.skipReason).toContain('pending review');
  expect(result.value.stored).toBe(0);
  expect(result.value.storedCandidates).toEqual([]);
  expect(deps.classifier.classifyCandidates).not.toHaveBeenCalled();
  expect(deps.pruneCandidateRepo.clearAll).not.toHaveBeenCalled();
  expect(deps.pruneCandidateRepo.storeAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing test — returns error when listAll fails during pending check**

Add this test to the same describe block:

```typescript
it('returns error when checking pending candidates fails', async () => {
  (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
    err({ code: 'INTERNAL_ERROR', message: 'Firestore read failed' })
  );

  const result = await pruneIssues(deps);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe('INTERNAL_ERROR');
  expect(result.error.message).toContain('Firestore read failed');
});
```

- [ ] **Step 3: Run tests to verify both fail**

```bash
cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts
```

Expected: 2 new tests FAIL (the skip-when-pending test fails because the guard doesn't exist yet; the error test fails because listAll isn't called in the current flow before classification).

- [ ] **Step 4: Implement the pending-candidates guard in pruneIssuesUseCase.ts**

In `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`, add the guard **after** the `No connected users` early-return and **before** the issue aggregation loop. Insert right after the `userIds.length === 0` block (after line 57).

> **Note:** Placing the guard before the activation threshold check means every hourly run with connected users calls `pruneCandidateRepo.listAll()` even when the issue count is below threshold. This is an acceptable tradeoff — the single Firestore read is cheap, and placing the guard early ensures candidates are never overwritten regardless of threshold logic changes:

```typescript
  // Guard: skip if previous candidates are still pending user review
  const pendingResult = await pruneCandidateRepo.listAll();
  if (!pendingResult.ok) {
    return pendingResult;
  }

  if (pendingResult.value.length > 0) {
    logger.info(
      { pendingCount: pendingResult.value.length },
      'Prune candidates already pending review, skipping new classification'
    );
    return ok({
      skipped: true,
      skipReason: `${String(pendingResult.value.length)} candidates pending review`,
      totalActive: 0,
      stored: 0,
      remaining: 0,
      storedCandidates: [],
      durationMs: Date.now() - startTime,
    });
  }
```

- [ ] **Step 5: Run tests to verify both pass**

```bash
cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts
```

Expected: ALL tests PASS including the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts
git commit -m "feat(linear-agent): skip pruning when candidates are pending review

The hourly prune scheduler now checks for existing unreviewed candidates
before running a new classification. This prevents overwriting candidates
that the user hasn't reviewed yet."
```

---

### Task 2: Backend — Integration test for skip-when-pending at route level

**Files:**
- Test: `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`

- [ ] **Step 1: Write failing integration test**

Add this test to the existing `describe('POST /internal/linear/prune-issues', ...)` block in `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`:

```typescript
it('returns 200 with skipped stats when candidates are pending review', async () => {
  // Seed existing candidates via the pruneCandidateRepository
  services.pruneCandidateRepository.listAll = vi.fn().mockResolvedValue(
    ok([
      {
        id: 'existing-1',
        identifier: 'INT-999',
        title: 'Old candidate',
        score: 80,
        reason: 'Cancelled',
        category: 'cancelled',
        classifiedAt: '2026-04-01T00:00:00.000Z',
      },
    ])
  );

  const response = await app.inject({
    method: 'POST',
    url: '/internal/linear/prune-issues',
    headers: { 'x-internal-auth': 'test-internal-token' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  expect(body.success).toBe(true);
  expect(body.data.skipped).toBe(true);
  expect(body.data.skipReason).toContain('pending review');
});
```

- [ ] **Step 2: Run test to verify it passes**

This should pass immediately because Task 1 already implemented the guard.

```bash
cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts
```

Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts
git commit -m "test(linear-agent): integration test for skip-when-pending at route level"
```

---

### Task 3: Frontend — Create usePruneCandidateStatus hook

**Files:**
- Create: `apps/web/src/hooks/usePruneCandidateStatus.ts`
- Modify: `apps/web/src/hooks/index.ts`

- [ ] **Step 1: Create the hook**

Create `apps/web/src/hooks/usePruneCandidateStatus.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listPruneCandidates } from '@/services/linearApi';

export interface PruneCandidateStatus {
  /** Number of candidates pending review */
  pendingCount: number;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

const POLL_INTERVAL_MS = 120_000; // 2 minutes

/**
 * Hook that polls Linear prune candidate count for the header indicator.
 * Returns the number of pending prune candidates (0 = green, >0 = red).
 */
export function usePruneCandidateStatus(): PruneCandidateStatus {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      const token = await getAccessToken();
      const candidates = await listPruneCandidates(token);
      if (isMountedRef.current) {
        setPendingCount(candidates.length);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to check prune status'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, isAuthenticated]);

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();

    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return (): void => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  return { pendingCount, loading, error };
}
```

- [ ] **Step 2: Re-export from hooks/index.ts**

Add this line to `apps/web/src/hooks/index.ts`:

```typescript
export { usePruneCandidateStatus, type PruneCandidateStatus } from './usePruneCandidateStatus.js';
```

- [ ] **Step 3: Verify build passes**

```bash
cd /repo && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/usePruneCandidateStatus.ts apps/web/src/hooks/index.ts
git commit -m "feat(web): add usePruneCandidateStatus hook for header indicator

Polls GET /linear/prune-candidates every 2 minutes and exposes the
pending count for the header status dot."
```

---

### Task 3.5: Frontend — Test usePruneCandidateStatus hook

**Files:**
- Create: `apps/web/src/hooks/__tests__/usePruneCandidateStatus.test.ts`

Per CLAUDE.md: _"Web app exception: coverage not enforced, tests optional for UI, **required for `utils/`, `services/`, `hooks/`**."_ This hook follows the same `vi.hoisted` + `vi.mock` pattern as `useFailedLinearIssues.test.ts`.

- [ ] **Step 1: Write tests for the hook**

Create `apps/web/src/hooks/__tests__/usePruneCandidateStatus.test.ts` following the existing pattern from `apps/web/src/hooks/__tests__/useFailedLinearIssues.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('test-token'));
const mockIsAuthenticated = vi.hoisted(() => ({ value: true }));
const mockListPruneCandidates = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@/context', () => ({
  useAuth: () => ({
    getAccessToken: mockGetAccessToken(),
    isAuthenticated: mockIsAuthenticated.value,
  }),
}));

vi.mock('@/services/linearApi', () => ({
  listPruneCandidates: mockListPruneCandidates(),
}));

import { usePruneCandidateStatus } from '../usePruneCandidateStatus.js';

describe('usePruneCandidateStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsAuthenticated.value = true;
    mockListPruneCandidates().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches candidates on mount and sets pendingCount', async () => {
    mockListPruneCandidates().mockResolvedValue([
      { id: '1', identifier: 'INT-1', title: 'Test', score: 80, reason: 'Cancelled', category: 'cancelled', classifiedAt: '2026-01-01' },
    ]);

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pendingCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('sets error when fetch fails', async () => {
    mockListPruneCandidates().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('sets loading false when not authenticated', async () => {
    mockIsAuthenticated.value = false;

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it('cleans up interval on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() => usePruneCandidateStatus());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /repo && pnpm vitest run apps/web/src/hooks/__tests__/usePruneCandidateStatus.test.ts
```

Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/__tests__/usePruneCandidateStatus.test.ts
git commit -m "test(web): add tests for usePruneCandidateStatus hook

Covers mount fetch, success/error paths, unauthenticated state, and
cleanup on unmount. Required per CLAUDE.md hooks coverage rule."
```

---

### Task 4: Frontend — Add Linear Cleanup indicator to Header

**Files:**
- Modify: `apps/web/src/components/Header.tsx`

The indicator should appear in two places, mirroring the worker status pattern:
1. **Desktop**: A standalone icon+dot next to the workers icon (between workers and theme toggle).
2. **Mobile/PWA menu**: A menu item inside the user dropdown, below the workers section.

- [ ] **Step 1: Add imports and hook call**

In `apps/web/src/components/Header.tsx`:

Add `Trash2` to the lucide-react import (this icon represents cleanup/deletion):

```typescript
import { ChevronDown, LogOut, Moon, Sun, User, RefreshCw, RotateCcw, Server, Trash2 } from 'lucide-react';
```

Add the hook import:

```typescript
import { usePruneCandidateStatus } from '@/hooks';
```

Inside the `Header` function body, after the `useWorkersStatus()` call (after line 78), add:

```typescript
const { pendingCount: prunePendingCount, loading: pruneLoading } = usePruneCandidateStatus();
```

- [ ] **Step 2: Add desktop indicator**

Insert right **after** the closing `</div>` of the workers status desktop block (after the `{/* Worker Status Indicator - desktop only, non-PWA mode */}` section, around line 270) and **before** the `{/* Theme Toggle */}` comment:

```tsx
{/* Linear Cleanup Status - desktop only */}
{isAuthenticated && !isInstalled && !pruneLoading && (
  <Link
    to="/linear/prune-candidates"
    className="relative hidden items-center gap-1 rounded-lg p-2 text-sm transition-colors hover:bg-slate-100 md:flex dark:hover:bg-slate-700"
    title={prunePendingCount > 0
      ? `${String(prunePendingCount)} issues to clean up`
      : 'No issues to clean up'}
  >
    <Trash2 className="h-4 w-4 text-slate-500" />
    <span
      className={`h-2 w-2 rounded-full ${prunePendingCount > 0 ? 'bg-red-500' : 'bg-green-500'}`}
    />
  </Link>
)}
```

- [ ] **Step 3: Add mobile/PWA menu indicator**

Inside the dropdown menu (the `{isMenuOpen ? (` block), insert a "Linear Cleanup" menu item **after** the workers status section's closing `</div>` tag (after the `{/* Workers status menu item */}` block, around line 433) and **before** the `{isInstalled && (` Force Refresh button:

```tsx
{/* Linear Cleanup status menu item — shown in PWA mode or on mobile */}
{isAuthenticated && !pruneLoading && (
  <div className={isInstalled ? '' : 'md:hidden'}>
    <Link
      to="/linear/prune-candidates"
      onClick={(): void => {
        setIsMenuOpen(false);
      }}
      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Trash2 className="h-4 w-4 text-slate-500" />
      <span>Linear Cleanup</span>
      <span
        className={`ml-auto h-2 w-2 rounded-full ${prunePendingCount > 0 ? 'bg-red-500' : 'bg-green-500'}`}
      />
    </Link>
  </div>
)}
```

- [ ] **Step 4: Update Header.test.tsx for new hook mock**

In `apps/web/src/components/__tests__/Header.test.tsx`, update the `@/hooks/index.js` mock (lines 77–83) to include `usePruneCandidateStatus`:

```typescript
vi.mock('@/hooks/index.js', async () => {
  const actual = await vi.importActual('@/hooks/index.js');
  return {
    ...(actual as object),
    useWorkersStatus: () => mockUseWorkersStatus(),
    usePruneCandidateStatus: () => ({ pendingCount: 0, loading: false, error: null }),
  } as Record<string, unknown>;
});
```

Also add `Trash2` to the lucide-react mock block (lines 94–98 in `Header.test.tsx`):

```typescript
Trash2: (): React.JSX.Element => <div data-testid="trash2-icon" />,
```

- [ ] **Step 5: Verify build and tests pass**

```bash
cd /repo && pnpm build
cd /repo && pnpm vitest run apps/web/src/components/__tests__/Header.test.tsx
```

Expected: Build succeeds and all Header tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Header.tsx apps/web/src/components/__tests__/Header.test.tsx
git commit -m "feat(web): add Linear Cleanup status indicator to header

Shows a Trash2 icon with a red dot when prune candidates are pending
review, green when none exist. Visible on desktop next to workers,
and in the mobile dropdown menu below workers. Links to the prune
candidates page. Updates Header.test.tsx with new hook mock."
```

---

### Task 5: Verify full CI

- [ ] **Step 1: Run workspace verification for linear-agent**

```bash
cd /repo && pnpm run verify:workspace:tracked -- linear-agent
```

Expected: ALL tests pass, coverage meets thresholds.

- [ ] **Step 2: Run full CI**

```bash
cd /repo && pnpm run ci:tracked
```

Expected: ALL workspaces pass.

- [ ] **Step 3: Final commit if any fixes were needed**

Only if CI revealed issues that needed fixing.
