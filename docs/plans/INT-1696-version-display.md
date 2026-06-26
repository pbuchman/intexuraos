# Fix IntexuraOS Version Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the version information display opened by clicking the IntexuraOS logo on both desktop web and mobile/PWA views.

**Architecture:** The fix stays inside the web app header and modal surface. `Header` owns the logo trigger state, `VersionInfoModal` owns build metadata presentation, and the shared Radix `Modal` primitive owns overlay/content stacking; implementation should remove brittle custom modal positioning and make build metadata rendering resilient to missing or malformed build-time env values.

**Tech Stack:** React, TypeScript strict mode, Vite `import.meta.env` build constants, TailwindCSS, Radix Dialog, Vitest, React Testing Library, Playwright/manual browser checks for mobile and desktop.

## Global Constraints

- Planning issue: INT-1696.
- Web app hash routing only; do not introduce runtime environment variables for web build metadata.
- Web app tests are optional broadly, but required here because this is a focused UI regression with existing `Header` and `Modal` test coverage.
- Do not create backend services, migrations, or new infrastructure.
- Keep global navigation stacking above page-level sticky bars; modal overlay/content must sit above the header and any mobile menu/sidebar overlay.

---

## Investigation Findings

- Logo click state already exists in `apps/web/src/components/Header.tsx`; clicking the logo sets `isVersionModalOpen` to `true` and renders `VersionInfoModal`.
- `apps/web/src/components/VersionInfoModal.tsx` assumes all build metadata exists and is parseable:
  - `commitSha.slice(0, 7)` will throw if `INTEXURAOS_COMMIT_SHA` is undefined in a test/dev build.
  - `new Date(buildDate).toLocaleString()` can render `Invalid Date` if `INTEXURAOS_BUILD_DATE` is absent or malformed.
  - GitHub commit links are generated even when the SHA is `unknown`.
- `VersionInfoModal` overrides the shared `Modal` content class with `fixed ... z-50 ... relative ...`, which duplicates the overlay's `z-50` and includes conflicting positioning classes. Because Radix renders overlay and content as siblings, equal z-index values can leave content behind the overlay depending on DOM/CSS interactions; this matches the reported mobile symptom of seeing only an overlay.
- Recent history shows the likely regression point: commit `30f8fbcd2cc98ea267a8999392c8709d6e212fa8` on 2026-04-26 migrated `VersionInfoModal` to the shared Radix modal primitive after the original version modal was introduced in commit `800ec466020ca416113a49c2b8e16803cd2b0e1f` on 2026-01-28.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Unchanged: all HTTP/API endpoints.

---

### Task 1: Add Regression Coverage For Logo-Opened Version Modal

**Files:**
- Modify: `apps/web/src/components/__tests__/Header.test.tsx`
- Test: `apps/web/src/components/__tests__/Header.test.tsx`

**Interfaces:**
- Consumes: `Header` logo button with accessible image text `IntexuraOS`.
- Produces: Regression tests proving desktop and mobile/PWA logo clicks reveal readable build metadata rather than only a backdrop.

- [ ] **Step 1: Add deterministic build metadata test env setup**

Add this near the top of the file, before the `describe('Header', () => {` block:

```typescript
const buildEnv = import.meta.env as Record<string, string>;
const originalEnv = { ...import.meta.env };
```

Then merge the build metadata setup into the existing `beforeEach` inside `describe('Header', () => {` so it runs alongside the existing `vi.clearAllMocks()` reset:

```typescript
beforeEach(() => {
  vi.clearAllMocks();

  buildEnv['INTEXURAOS_BUILD_VERSION'] = '3.8.0-test123';
  buildEnv['INTEXURAOS_COMMIT_SHA'] = 'test1234567890abcdef';
  buildEnv['INTEXURAOS_COMMIT_MESSAGE'] = 'Test build metadata';
  buildEnv['INTEXURAOS_BUILD_DATE'] = '2026-06-26T12:00:00.000Z';
});

afterEach(() => {
  Object.assign(import.meta.env, originalEnv);
});
```

- [ ] **Step 2: Add desktop logo click regression test**

Add this test under `describe('Non-PWA mode (regular web)', () => {`:

```typescript
it('opens readable version information from the logo on desktop web', () => {
  mockUsePWA.mockReturnValue({
    ...defaultPWAValue,
    isInstalled: false,
  });
  mockUseWorkersStatus.mockReturnValue(defaultWorkersStatusValue);

  render(<Header />);

  fireEvent.click(screen.getByRole('button', { name: /IntexuraOS/i }));

  expect(screen.getByRole('dialog', { name: /Version Information/i })).toBeInTheDocument();
  expect(screen.getByText('3.8.0-test123')).toBeInTheDocument();
  expect(screen.getByText('Test build metadata')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /test123/i })).toHaveAttribute(
    'href',
    'https://github.com/pbuchman/intexuraos/commit/test1234567890abcdef'
  );
});
```

- [ ] **Step 3: Add mobile/PWA overlay regression test**

Add this test under `describe('PWA mode', () => {`:

```typescript
it('opens version information above the overlay from the logo in mobile PWA mode', () => {
  mockUsePWA.mockReturnValue({
    ...defaultPWAValue,
    isInstalled: true,
  });
  mockUseWorkersStatus.mockReturnValue(defaultWorkersStatusValue);

  render(<Header />);

  fireEvent.click(screen.getByRole('button', { name: /IntexuraOS/i }));

  const dialog = screen.getByRole('dialog', { name: /Version Information/i });
  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveClass('z-[60]');
  expect(screen.getByText('3.8.0-test123')).toBeVisible();
});
```

- [ ] **Step 4: Run the focused test and confirm it fails before implementation**

Run:

```bash
pnpm --filter web test -- Header.test.tsx --run
```

Expected before implementation: the mobile/PWA test fails because the dialog content does not use a higher z-index than the overlay, and any missing test env values may expose current metadata assumptions.

- [ ] **Step 5: Commit the failing test when it fails for the expected reason**

```bash
git add apps/web/src/components/__tests__/Header.test.tsx
git commit -m "test(web): cover version modal logo trigger"
```

---

### Task 2: Make The Version Modal Render Above The Overlay And Handle Missing Build Metadata

**Files:**
- Modify: `apps/web/src/components/VersionInfoModal.tsx`
- Test: `apps/web/src/components/__tests__/Header.test.tsx`

**Interfaces:**
- Consumes: `import.meta.env.INTEXURAOS_BUILD_VERSION`, `INTEXURAOS_COMMIT_SHA`, `INTEXURAOS_COMMIT_MESSAGE`, and `INTEXURAOS_BUILD_DATE`.
- Produces: A resilient `VersionInfoModal` that always renders a visible modal body when opened and displays fallback text instead of throwing or showing `Invalid Date`.

- [ ] **Step 1: Add metadata helpers in `VersionInfoModal.tsx`**

Replace the direct env reads and derived constants with:

```typescript
const UNKNOWN_VALUE = 'unknown';

function getBuildValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function formatBuildDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown build date' : date.toLocaleString();
}
```

Then inside `VersionInfoModal` use:

```typescript
const version = getBuildValue(import.meta.env.INTEXURAOS_BUILD_VERSION, 'Unknown version');
const commitSha = getBuildValue(import.meta.env.INTEXURAOS_COMMIT_SHA, UNKNOWN_VALUE);
const commitMessage = getBuildValue(import.meta.env.INTEXURAOS_COMMIT_MESSAGE, 'Unknown commit');
const buildDate = getBuildValue(import.meta.env.INTEXURAOS_BUILD_DATE, UNKNOWN_VALUE);

const hasCommitSha = commitSha !== UNKNOWN_VALUE;
const shortSha = hasCommitSha ? commitSha.slice(0, 7) : UNKNOWN_VALUE;
const commitUrl = `${GITHUB_REPO_URL}/commit/${commitSha}`;
const formattedDate = formatBuildDate(buildDate);
```

- [ ] **Step 2: Use the shared Modal sizing instead of overriding the entire content class**

Replace the current `contentClassName` prop with a class that only adds the higher stack level and mobile width constraints:

```tsx
contentClassName="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-2xl dark:bg-slate-800"
```

This keeps the modal content above the shared overlay (`z-50`) and above the fixed header (`z-50`), avoids equal z-index ordering, and prevents mobile content from overflowing the viewport.

- [ ] **Step 3: Avoid broken commit links when SHA is unavailable**

Replace the unconditional commit anchor with conditional rendering:

```tsx
{hasCommitSha ? (
  <a
    href={commitUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="mt-1 inline-flex items-center gap-1 font-mono text-sm text-blue-600 hover:underline dark:text-blue-400"
  >
    {shortSha}
    <ExternalLink className="h-3 w-3" />
  </a>
) : (
  <p className="mt-1 font-mono text-sm text-slate-500 dark:text-slate-400">{shortSha}</p>
)}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm --filter web test -- Header.test.tsx --run
```

Expected: PASS, including both desktop and mobile/PWA logo-click tests.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/web/src/components/VersionInfoModal.tsx apps/web/src/components/__tests__/Header.test.tsx
git commit -m "fix(web): restore logo version modal visibility"
```

---

### Task 3: Add Focused Modal Fallback Tests

**Files:**
- Create: `apps/web/src/components/__tests__/VersionInfoModal.test.tsx`
- Modify: `apps/web/src/components/VersionInfoModal.tsx`
- Test: `apps/web/src/components/__tests__/VersionInfoModal.test.tsx`

**Interfaces:**
- Consumes: `VersionInfoModal({ onClose })`.
- Produces: Unit coverage for fallback display behavior when build metadata is absent or malformed.

- [ ] **Step 1: Create fallback metadata test file**

Create `apps/web/src/components/__tests__/VersionInfoModal.test.tsx`:

```typescript
/**
 * Tests for VersionInfoModal component.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VersionInfoModal } from '../VersionInfoModal.js';

const originalEnv = { ...import.meta.env };

describe('VersionInfoModal', () => {
  afterEach(() => {
    cleanup();
    Object.assign(import.meta.env, originalEnv);
  });

  it('renders fallback metadata when build env values are missing or malformed', () => {
    const buildEnv = import.meta.env as Record<string, string | undefined>;
    buildEnv['INTEXURAOS_BUILD_VERSION'] = undefined;
    buildEnv['INTEXURAOS_COMMIT_SHA'] = undefined;
    buildEnv['INTEXURAOS_COMMIT_MESSAGE'] = '';
    buildEnv['INTEXURAOS_BUILD_DATE'] = 'not-a-date';

    render(<VersionInfoModal onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: /Version Information/i })).toBeInTheDocument();
    expect(screen.getByText('Unknown version')).toBeInTheDocument();
    expect(screen.getByText('Unknown commit')).toBeInTheDocument();
    expect(screen.getByText('Unknown build date')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /unknown/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the modal fallback test**

Run:

```bash
pnpm --filter web test -- VersionInfoModal.test.tsx --run
```

Expected: PASS.

- [ ] **Step 3: Run all web component tests touched by this change**

Run:

```bash
pnpm --filter web test -- Header.test.tsx VersionInfoModal.test.tsx --run
```

Expected: PASS.

- [ ] **Step 4: Commit fallback coverage**

```bash
git add apps/web/src/components/__tests__/VersionInfoModal.test.tsx apps/web/src/components/VersionInfoModal.tsx
git commit -m "test(web): cover version modal metadata fallbacks"
```

---

### Task 4: Browser Verification Across Desktop And Mobile

**Files:**
- Modify: none expected unless verification exposes a defect in `apps/web/src/components/VersionInfoModal.tsx` or `apps/web/src/components/Header.tsx`
- Test: browser runtime behavior

**Interfaces:**
- Consumes: built Vite web app with `INTEXURAOS_*` build constants.
- Produces: Verification evidence that users can click the logo and read the version on desktop and mobile/PWA-sized viewports.

- [ ] **Step 1: Start the web dev server**

Run:

```bash
pnpm --filter web dev -- --host 0.0.0.0
```

Expected: Vite serves the web app and prints a local URL.

- [ ] **Step 2: Verify desktop behavior with Playwright or browser**

Use a desktop viewport such as `1280x800` and verify:

```text
1. Open the authenticated web app shell.
2. Click the IntexuraOS logo in the fixed header.
3. Confirm the modal body, not just the overlay, is visible.
4. Confirm Version, Last Commit, and Build Date fields are readable.
5. Press Escape and confirm the modal closes.
```

- [ ] **Step 3: Verify mobile behavior with Playwright or browser**

Use a mobile viewport such as `390x844` and verify:

```text
1. Open the same shell in a mobile-sized viewport.
2. Click the IntexuraOS logo.
3. Confirm the modal content appears above the dark overlay.
4. Confirm the modal fits within the viewport with no horizontal scrolling.
5. Tap the close button and confirm the modal closes.
```

- [ ] **Step 4: Check z-index interactions**

Verify the content order:

```text
Modal content z-[60] > modal overlay z-50 == header z-50 > page-level sticky bars z-30 or lower.
```

If a page-level sticky component uses `z-50` or higher, lower it or document why it must remain above the header before committing.

- [ ] **Step 5: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 6: Commit any verification-driven fix**

Only if browser verification required an additional code change:

```bash
git add apps/web/src/components/VersionInfoModal.tsx apps/web/src/components/Header.tsx apps/web/src/components/__tests__/Header.test.tsx apps/web/src/components/__tests__/VersionInfoModal.test.tsx
git commit -m "fix(web): polish version modal mobile behavior"
```

---

## Self-Review Notes

- Spec coverage: The plan restores logo-click version display for desktop web and mobile/PWA, includes investigation findings, and verifies mobile overlay behavior.
- Placeholder scan: No task uses placeholder instructions; each step names exact files and expected commands.
- Type consistency: `VersionInfoModal` remains the same public component with `onClose: () => void`; `Header` continues to own `isVersionModalOpen`.
