# INT-1393: Expand Code Task Logs to Support Both Claude and MSG Patterns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Claude" filter button to "Worker" in the code task log viewer and expand its filter logic to match both `[claude]` and `[msg]` tagged log lines.

**Architecture:** All changes are confined to a single component file (`CodeTaskLogViewer.tsx`) and its test file. The filter state variable is renamed from `claudeFilter` to `workerFilter`, the button label changes to "Worker", and the filtering predicate is extended to pass through lines tagged with either `[claude]` or `[msg]`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

## Files

| File                                                                      | Change                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`                | Rename filter state/callbacks, update button label, extend filter predicate |
| `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx` | Update existing filter tests, add `[msg]` coverage                          |

---

### Task 1: Update CodeTaskLogViewer component

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`

- [ ] **Step 1: Write the failing tests** (in test file, before touching implementation)

In `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`:

Replace the two existing tests in the `describe('CodeTaskLogViewer URL detection')` block that reference "Claude":

```typescript
it('worker filter button has aria-pressed attribute', () => {
  const props = makeProps({
    logs: [makeLog(1, '[claude] Some worker output with https://example.com/filter')],
  });

  render(<CodeTaskLogViewer {...props} />);

  const buttons = screen.getAllByRole('button');
  const workerButton = buttons.find((b) => b.textContent?.trim() === 'Worker');
  expect(workerButton).toBeDefined();
  expect(workerButton).toHaveAttribute('aria-pressed', 'false');
});

it('when worker filter is active, only [claude] and [msg] tagged lines are shown', async () => {
  const claudeUrl = 'https://example.com/claude-line';
  const msgUrl = 'https://example.com/msg-line';
  const otherUrl = 'https://example.com/other-line';
  const logs: LogLine[] = [
    makeLog(1, `[claude] Claude output: ${claudeUrl}`),
    makeLog(2, `[msg] Msg output: ${msgUrl}`),
    makeLog(3, `[tool] Tool output: ${otherUrl}`),
  ];

  render(<CodeTaskLogViewer {...makeProps({ logs })} />);

  // All links visible before filter
  expect(screen.getByRole('link', { name: claudeUrl })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: msgUrl })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: otherUrl })).toBeInTheDocument();

  // Activate the Worker filter
  const buttons = screen.getAllByRole('button');
  const workerButton = buttons.find((b) => b.textContent?.trim() === 'Worker');
  if (workerButton === undefined) throw new Error('Worker filter button not found');
  await userEvent.click(workerButton);

  // Both [claude] and [msg] tagged lines remain visible; [tool] is hidden
  expect(screen.getByRole('link', { name: claudeUrl })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: msgUrl })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: otherUrl })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /repo && pnpm run verify:workspace:tracked -- web 2>&1 | grep -E "FAIL|PASS|worker filter|claude filter"
```

Expected: tests named "worker filter button" and "when worker filter is active" fail (button not found / wrong label).

- [ ] **Step 3: Update the component**

In `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`:

**3a. Rename state (line ~134):**
```typescript
// Before:
const [claudeFilter, setClaudeFilter] = useState(false);

// After:
const [workerFilter, setWorkerFilter] = useState(false);
```

**3b. Rename callback (lines ~272-274):**
```typescript
// Before:
const toggleClaudeFilter = useCallback((): void => {
  setClaudeFilter((prev) => !prev);
}, []);

// After:
const toggleWorkerFilter = useCallback((): void => {
  setWorkerFilter((prev) => !prev);
}, []);
```

**3c. Update the filter button JSX (lines ~323-334):**
```tsx
// Before:
<button
  type="button"
  onClick={toggleClaudeFilter}
  aria-pressed={claudeFilter}
  className={`rounded-md px-2 py-1 text-xs transition-colors ${
    claudeFilter
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
  }`}
>
  Claude
</button>

// After:
<button
  type="button"
  onClick={toggleWorkerFilter}
  aria-pressed={workerFilter}
  className={`rounded-md px-2 py-1 text-xs transition-colors ${
    workerFilter
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
  }`}
>
  Worker
</button>
```

**3d. Update filter predicate (lines ~378-381):**
```typescript
// Before:
if (claudeFilter) {
  const tag = extractTag(line.text);
  if (tag !== 'claude') return null;
}

// After:
if (workerFilter) {
  const tag = extractTag(line.text);
  if (tag !== 'claude' && tag !== 'msg') return null;
}
```

**3e. Update whitespace class condition (line ~409):**
```tsx
// Before:
<pre className={`min-w-0 ${claudeFilter ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${getLogLineClass(line.text)}`}>

// After:
<pre className={`min-w-0 ${workerFilter ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${getLogLineClass(line.text)}`}>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /repo && pnpm run verify:workspace:tracked -- web
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx \
        apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
git commit -m "feat(web): rename Claude filter to Worker, support [claude] and [msg] patterns (INT-1393)"
```

---

## Evidence

- Task ID: `task_507eabd8-1952-4e43-8be0-a7c8d9a8ab9d`
- Linear: [INT-1393](https://linear.app/pbuchman/issue/INT-1393)
- Planned: 2026-04-16
