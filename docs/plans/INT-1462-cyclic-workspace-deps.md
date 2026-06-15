# INT-1462 — Resolve cyclic workspace dependencies in core packages

> **For agentic workers:** Single-file, mechanical change. Execute the task below in one pass. Verify with `pnpm install` and `pnpm run ci:tracked`.

**Goal:** Remove the vestigial devDependency that causes pnpm to warn about cyclic workspace dependencies between `infra-gemini`, `llm-pricing`, `internal-clients`, and `llm-factory`.

**Architecture:** The four packages form a layered stack that is otherwise clean and unidirectional. The only back-edge that closes the cycle is an unused devDependency inside `llm-pricing` pointing up at `internal-clients`. Removing that edge breaks every reported cycle without touching any source code.

**Tech Stack:** pnpm workspaces, TypeScript strict, vitest.

---

## Investigation: what pnpm is warning about

Running `pnpm install` prints:

```
WARN There are cyclic workspace dependencies:
  /repo/packages/infra-gemini,
  /repo/packages/llm-pricing,
  /repo/packages/internal-clients,
  /repo/packages/llm-factory
```

### Full edge list (from each `package.json`)

| Package            | Depends on (prod)                                                                | Depends on (dev)                       |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| `llm-pricing`      | `common-core`, `infra-firestore`, `llm-contract`                                 | **`internal-clients`** ← the back-edge |
| `infra-gemini`     | `common-core`, `llm-prompts`, `llm-contract`, `llm-pricing`                      | —                                      |
| `llm-factory`      | `common-core`, `infra-gemini`, `infra-openrouter`, `llm-contract`, `llm-pricing` | —                                      |
| `internal-clients` | `common-core`, `infra-openrouter`, `llm-contract`, `llm-factory`, `llm-pricing`  | —                                      |

### Cycles produced by the back-edge

1. `llm-pricing` → `internal-clients` → `llm-pricing` (direct)
2. `llm-pricing` → `internal-clients` → `llm-factory` → `llm-pricing`
3. `llm-pricing` → `internal-clients` → `llm-factory` → `infra-gemini` → `llm-pricing`

Every cycle passes through the `llm-pricing → internal-clients` **devDependency** edge. The rest of the graph is unidirectional:

```
     infra-openrouter ──┐            infra-gemini ──┐
                        ▼                           ▼
common-core ← llm-contract ← llm-pricing ← llm-factory ← internal-clients
                                  ▲              ▲               ▲
                                  └──────────────┴───────────────┘
                                       (all downward — correct)
```

### Why the back-edge exists (and why it can be removed)

`packages/llm-pricing/package.json`:

```json
"devDependencies": {
  "@intexuraos/internal-clients": "workspace:*"
}
```

Grep proof that nothing in `llm-pricing` actually imports from `@intexuraos/internal-clients`:

```
$ grep -rn "@intexuraos/internal-clients" packages/llm-pricing/src
packages/llm-pricing/src/buildUsageEvent.ts:17: * @intexuraos/internal-clients' UsageEventInput. Sinks only JSON.stringify
```

The only mention is a JSDoc comment in `buildUsageEvent.ts` explaining that the function returns `Record<string, unknown>` **precisely to avoid a type-level dependency on `internal-clients`**. The author chose the opaque type to break the cycle in the source — but the package manifest still lists the devDep, which pnpm reports.

No test, fixture, or runtime code in `packages/llm-pricing/src/**` or `packages/llm-pricing/src/__tests__/**` imports anything from `@intexuraos/internal-clients`. The devDep is dead.

### Why not restructure further?

Alternatives considered and rejected:

- **Move `UsageSink` type into `llm-contract`:** valid long-term refactor, but unnecessary for the current warning. The real cycles are all anchored on the dead devDep; the "type-level" cycle is already severed in code.
- **Extract a `llm-usage-contract` package:** YAGNI. No consumer needs it today.
- **Flip ownership (make `internal-clients` depend only on a narrower slice of `llm-pricing`):** `internal-clients` already depends on `llm-pricing` purely for the `UsageSink` type and `createFakeUsageSink` (test helper). That direction is correct — clients sit above the pricing/usage primitives. No flip needed.

**Decision:** Remove the single unused devDependency. Minimal diff, zero risk, restores clean unidirectional layering (matches the layer-separation pattern called out in execution memory mem_b0b3dbbd).

---

## Endpoint Changes

- **Modified:** none
- **Created:** none
- **Removed:** none
- **Unchanged:** all HTTP endpoints

---

## Task 1: Remove the unused devDependency from `llm-pricing`

**Files:**
- Modify: `packages/llm-pricing/package.json` (remove `devDependencies["@intexuraos/internal-clients"]`; if that leaves the `devDependencies` block empty, remove the block entirely)

### Steps

- [ ] **Step 1: Confirm no runtime/test code depends on `@intexuraos/internal-clients` inside `llm-pricing`**

  Run:
  ```bash
  rg "@intexuraos/internal-clients" packages/llm-pricing/src
  ```
  Expected: a single match in `buildUsageEvent.ts` line 17 inside a `/** ... */` comment. No `import` statements. If any real import appears, STOP and re-plan.

- [ ] **Step 2: Edit `packages/llm-pricing/package.json`**

  Remove these lines:
  ```json
    "devDependencies": {
      "@intexuraos/internal-clients": "workspace:*"
    },
  ```
  The final file must keep all other top-level keys (`name`, `version`, `private`, `type`, `engines`, `exports`, `dependencies`, `scripts`) unchanged and remain valid JSON.

- [ ] **Step 3: Refresh the pnpm lockfile**

  Run:
  ```bash
  pnpm install
  ```
  Expected: no `WARN There are cyclic workspace dependencies` line in the output. `pnpm-lock.yaml` updates to drop the edge.

- [ ] **Step 4: Typecheck `llm-pricing` and the former cycle members**

  Run:
  ```bash
  pnpm --filter @intexuraos/llm-pricing typecheck
  pnpm --filter @intexuraos/infra-gemini typecheck
  pnpm --filter @intexuraos/llm-factory typecheck
  pnpm --filter @intexuraos/internal-clients typecheck
  ```
  Expected: all four pass with no errors.

- [ ] **Step 5: Run the full tracked CI**

  Run:
  ```bash
  pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1462.txt
  ```
  Expected: pass. If anything fails, investigate — a failure here would mean some transitive consumer silently relied on `internal-clients` being hoisted into `llm-pricing`'s `node_modules`, which would itself be a bug to fix, not a reason to revert.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/llm-pricing/package.json pnpm-lock.yaml
  git commit -m "fix(llm-pricing): drop vestigial internal-clients devDep to break workspace cycle [INT-1462]"
  ```

---

## Verification Checklist

- [ ] `pnpm install` prints no `cyclic workspace dependencies` warning.
- [ ] `pnpm run ci:tracked` passes completely.
- [ ] `packages/llm-pricing/src/buildUsageEvent.ts` comment on line 17 still reads correctly (it references `@intexuraos/internal-clients` as documentation only; that is fine).
- [ ] No source file imports `@intexuraos/internal-clients` from anywhere under `packages/llm-pricing/`.

---

## Rollback

If anything unexpected breaks, revert the commit — the change is isolated to `package.json` + `pnpm-lock.yaml` and has no runtime surface.
