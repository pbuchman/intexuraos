# Fix Collapsing/Expanding of Orchestrator and Entrypoint Log Items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken collapsible block detection for `[orchestrator]` and `[entrypoint]` log lines in the code task log viewer.

**Architecture:** The block detection logic in `CodeTaskLogViewer.tsx` was designed for `tool`/`cmd` patterns (one header line + indented body lines). Orchestrator/entrypoint logs are consecutive tagged lines with no indented body, so each line creates a zero-body block that gets discarded. The fix groups consecutive same-tag lines into a single collapsible block.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

## Root Cause

PR #1776 (commit `dbe317cb0`) added `orchestrator` and `entrypoint` to the collapsible block condition at line 157 of `CodeTaskLogViewer.tsx`:

```typescript
if (tag === 'tool' || tag === 'cmd' || tag === 'orchestrator' || tag === 'entrypoint') {
  finalizeBlock(index);
  current = { headerIdx: index, bodyStart: index + 1, bodyEnd: index + 1 };
}
```

**Problem:** Each `[orchestrator]` or `[entrypoint]` line triggers `finalizeBlock()` on the previous block. Since these logs are consecutive tagged lines (no indented body lines between them), every block has `bodyEnd === bodyStart` (zero body lines) and is discarded by the `bodyEnd > bodyStart` check. No collapsible blocks are ever created.

**Evidence from entrypoint.sh:** The container bootstrap emits 17+ consecutive `[entrypoint]` lines. Similarly, the orchestrator emits many consecutive `[orchestrator]` lines during task lifecycle. None of these produce collapsible blocks under the current logic.

**Expected behavior:** Consecutive `[orchestrator]` lines should form one collapsible group (first line = header, rest = body). Same for `[entrypoint]`.

## File Map

| File                                                                      | Action   | Purpose                                                   |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`                | Modify   | Fix block detection logic + add `groupTag` to `ToolBlock` |
| `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx` | Modify   | Add tests for orchestrator/entrypoint collapsible groups  |

## Implementation

### Task 1: Add failing tests for orchestrator/entrypoint collapsible groups

**Files:**
- Modify: `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`

- [ ] **Step 1: Write test for consecutive orchestrator lines forming a collapsible block**

Add a new `describe` block at the end of the test file:

```typescript
describe('CodeTaskLogViewer orchestrator/entrypoint collapsible groups', () => {
  it('collapses consecutive orchestrator lines into a single block', () => {
    const logs: LogLine[] = [
      makeLog(1, '[orchestrator] Task started: id=task_123'),
      makeLog(2, '[orchestrator] Worker config: type=opus'),
      makeLog(3, '[orchestrator] Container config: worktree=/repo'),
      makeLog(4, '[orchestrator] Creating new container'),
      makeLog(5, '[orchestrator] Worker attempt completed'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Default compactMode=true, 4+ body lines -> collapsed
    const hiddenLabels = screen.queryAllByText(/\d+ lines hidden/i);
    expect(hiddenLabels.length).toBeGreaterThan(0);
  });

  it('collapses consecutive entrypoint lines into a single block', () => {
    const logs: LogLine[] = [
      makeLog(1, '[entrypoint] Code worker starting'),
      makeLog(2, '[entrypoint] Task ID: task_123'),
      makeLog(3, '[entrypoint] Running as user: claude'),
      makeLog(4, '[entrypoint] Git repo verified: /repo'),
      makeLog(5, '[entrypoint] GCP auth successful'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    const hiddenLabels = screen.queryAllByText(/\d+ lines hidden/i);
    expect(hiddenLabels.length).toBeGreaterThan(0);
  });

  it('expands a collapsed orchestrator group when the chevron is clicked', async () => {
    const logs: LogLine[] = [
      makeLog(1, '[orchestrator] Task started'),
      makeLog(2, '[orchestrator] Worker config'),
      makeLog(3, '[orchestrator] Container config'),
      makeLog(4, '[orchestrator] Creating container'),
      makeLog(5, '[orchestrator] Attempt completed'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Initially collapsed
    expect(screen.queryAllByText(/\d+ lines hidden/i).length).toBeGreaterThan(0);

    // Expand
    const expandButton = screen.getByRole('button', { name: /expand tool output/i });
    await userEvent.click(expandButton);

    // Body lines should now be visible
    expect(screen.getByText(/Worker config/)).toBeInTheDocument();
    expect(screen.getByText(/Container config/)).toBeInTheDocument();
  });

  it('does not group different consecutive tags together', () => {
    const logs: LogLine[] = [
      makeLog(1, '[orchestrator] Task started'),
      makeLog(2, '[orchestrator] Worker config'),
      makeLog(3, '[orchestrator] Container config'),
      makeLog(4, '[orchestrator] Creating container'),
      makeLog(5, '[orchestrator] Attempt started'),
      makeLog(6, '[entrypoint] Code worker starting'),
      makeLog(7, '[entrypoint] Task ID: task_123'),
      makeLog(8, '[entrypoint] Running as user: claude'),
      makeLog(9, '[entrypoint] Git repo verified'),
      makeLog(10, '[entrypoint] GCP auth successful'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Two separate collapsible groups
    const hiddenLabels = screen.queryAllByText(/\d+ lines hidden/i);
    expect(hiddenLabels.length).toBe(2);
  });

  it('breaks orchestrator group when a different tag appears mid-sequence', () => {
    const logs: LogLine[] = [
      makeLog(1, '[orchestrator] Task started'),
      makeLog(2, '[orchestrator] Worker config'),
      makeLog(3, '[claude] Hello, I will help'),
      makeLog(4, '[orchestrator] Attempt completed'),
      makeLog(5, '[orchestrator] Running verification'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // First group: 2 orchestrator lines (1 header + 1 body) -> < 4 visual lines -> not collapsible
    // Second group: 2 orchestrator lines -> also not collapsible
    // No collapsible blocks expected
    const hiddenLabels = screen.queryAllByText(/\d+ lines hidden/i);
    expect(hiddenLabels.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`
Expected: New orchestrator/entrypoint tests FAIL (no collapsible blocks found)

### Task 2: Fix block detection logic to group consecutive same-tag lines

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`

- [ ] **Step 3: Add `groupTag` field to ToolBlock interface**

Change the `ToolBlock` interface (around line 25):

```typescript
interface ToolBlock {
  headerIdx: number;
  bodyStart: number;
  bodyEnd: number;
  groupTag?: string;
}
```

- [ ] **Step 4: Modify `bodyLineMap` useMemo to track group tags**

In the `bodyLineMap` useMemo (starting at line 139), add a `currentGroupTag` tracker and update the block detection logic. Replace the block detection loop body (lines 152-167) with:

```typescript
    let currentGroupTag: string | null = null;

    for (let index = 0; index < logs.length; index++) {
      const line = logs[index];
      if (line === undefined) continue;
      const tag = extractTag(line.text);

      if (tag === 'orchestrator' || tag === 'entrypoint') {
        if (currentGroupTag === tag && current !== null) {
          // Same consecutive tag — extend group body
          current.bodyEnd = index + 1;
        } else {
          // New group or different tag
          finalizeBlock(index);
          current = { headerIdx: index, bodyStart: index + 1, bodyEnd: index + 1, groupTag: tag };
          currentGroupTag = tag;
        }
      } else if (tag === 'tool' || tag === 'cmd') {
        finalizeBlock(index);
        current = { headerIdx: index, bodyStart: index + 1, bodyEnd: index + 1 };
        currentGroupTag = null;
      } else if (tag !== null) {
        finalizeBlock(index);
        currentGroupTag = null;
      } else if (current !== null && isBodyLine(line.text)) {
        current.bodyEnd = index + 1;
      } else {
        finalizeBlock(index);
        currentGroupTag = null;
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`
Expected: ALL tests PASS (both existing and new)

- [ ] **Step 6: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
git commit -m "fix(web): group consecutive orchestrator/entrypoint lines into collapsible blocks (INT-1367)"
```
