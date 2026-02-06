# Random Todo Workflow

**Trigger:** User calls `/linear` with no arguments.

---

## Purpose

Select a Todo issue and delegate to [work-existing.md](work-existing.md) for execution.

---

## Non-Interactive Contract (MANDATORY)

**This mode operates WITHOUT user interaction. The following rules are absolute:**

| Rule             | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| **NO PROMPTS**   | Never ask "what should I do?", "which task?", or "ready to start?" |
| **AUTO-PROCEED** | Always proceed with the selected Todo item automatically           |
| **NO TASKS**     | If Todo state is empty, print message and exit gracefully          |

---

## Verbose Transition Logging (MANDATORY)

```
🔍 SEARCH: Looking for Todo issues in IntexuraOS...
📋 FOUND: 3 issues in Todo state
🎯 SELECTED: INT-456 "[feature] Add user preferences" (priority: High)
🔀 ROUTING: Delegating to work-existing.md workflow
```

---

## Steps

### 1. Tool Verification

Verify Linear MCP, GitHub CLI, GCloud available. Fail fast if unavailable.

### 2. Query Todo Issues

```
Call mcp__linear__list_issues({
  state: "Todo",
  team: "IntexuraOS",
  limit: 10
})
```

**Print:** `🔍 SEARCH: Looking for Todo issues in IntexuraOS...`

### 3. Selection Algorithm

```
1. Filter to state: "Todo" (NOT Backlog)
2. Sort by priority (High → Low) then createdAt (newest first)
3. Pick first result
```

**Print:** `📋 FOUND: X issues in Todo state`

### 4. Handle Empty Queue

If no items in Todo state:

```
📋 FOUND: 0 issues in Todo state
✅ COMPLETE: No items in Todo state. Nothing to do.
```

**STOP.** Do NOT:

- Ask to create a new issue
- Ask what to do instead
- Pick from Backlog state

### 5. Select and Delegate

**Print:**

```
🎯 SELECTED: INT-XXX "<title>" (priority: <priority>)
🔀 ROUTING: Delegating to work-existing.md workflow
```

**Then:** Execute [work-existing.md](work-existing.md) with the selected issue ID.

> **Parameter passing:** The selected issue ID is passed to `work-existing.md` as if the user had typed `/linear INT-XXX`. The downstream workflow receives the issue identifier, not the raw UUID.

---

## What Happens Next

The `work-existing.md` router will:

1. Fetch full issue details
2. Check labels for phase routing
3. Execute Phase 1 or Phase 2 as appropriate

This file does NOT execute the issue — it only selects it.

---

## Two-Cycle Pattern (Non-Ready Issues)

If selected issue has NO `code-task` label:

```
Cycle 1: /linear → select issue → Phase 1 → enrich → add code-task → STOP
Cycle 2: /linear → select same issue (now has code-task) → Phase 2 → execute → PR
```

**This is intentional.** Phase 1 prepares the issue, Phase 2 executes it. Cron naturally handles this over two runs.

> ⚠️ **Assumption:** "Select same issue" assumes priority/recency sorting. If higher-priority issues exist in the queue, a different issue may be selected on Cycle 2. For guaranteed continuation, use `/linear INT-XXX` directly.
