# Work on Existing Issue - Phase 2 (Strict Execution)

**Trigger:** Issue HAS `code-task` label

---

## Purpose

Execute the task autonomously. The issue has been prepared (Phase 1) and is ready for implementation.

---

## Verbose Transition Logging (MANDATORY)

```
🚀 PHASE 2: Starting Strict Execution for INT-123
🌿 BRANCH: Creating fix/INT-123 from origin/development
📍 STATE: Backlog → In Progress
🔨 BUILD: Running pnpm build...
💻 IMPLEMENT: Starting implementation...
✅ CI: pnpm run ci:tracked passed
📦 COMMIT: [INT-123] <description>
🔀 MERGE: Merging origin/development...
📤 PUSH: Pushing to origin/fix/INT-123
🔗 PR: Created PR #XXX
📍 STATE: In Progress → In Review
✅ PHASE 2 COMPLETE: PR created, CI passed, Linear updated to In Review
```

---

## Non-Interactive Contract (MANDATORY)

**This mode operates WITHOUT user interaction. The following rules are absolute:**

| Rule             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| **NO PROMPTS**   | Never ask "Should I commit?", "Ready to push?", etc.            |
| **AUTO-PROCEED** | Execute all steps automatically after CI passes                 |
| **NO WAITING**   | Don't pause for confirmation between steps                      |
| **FIX CI**       | On CI failure, fix and retry (up to 3 attempts before stopping) |

---

## Steps

### 0. Execute GLM Delegation Plan (if present)

**0a. Check for GLM Delegation Plan**

Look for `## GLM Delegation Plan` section in the Linear issue description:

| Section Found   | Action                            |
| --------------- | --------------------------------- |
| Section exists  | Execute it (steps 0b-0d)          |
| Section missing | Skip to Step 1 (normal execution) |

**0b. Verify MCP Tools Available**

```
ToolSearch: "select:mcp__glm-coder__generate_code"
```

| Result            | Action                                         |
| ----------------- | ---------------------------------------------- |
| Tools available   | Proceed with delegation                        |
| Tools unavailable | Log warning: "GLM unavailable", skip to Step 1 |

**0c. Execute GLM-Generated Files FIRST**

For EACH file in the "GLM-Generated" table:

1. Load context files specified in the table
2. Call the specified tool (`generate_code` or `generate_tests`)
3. Review output for correctness
4. **If output acceptable:** Write to file using Write tool
5. **If GLM fails or output incorrect:** Fall back to Direct Implementation with warning:
   ```
   ⚠️ GLM FALLBACK: <file> - <reason>. Implementing directly.
   ```
6. Run relevant tests to verify

**0d. Then Proceed to Direct Implementation**

Only after ALL GLM files are handled (written or fallen back), proceed to Step 5 for "Direct Implementation" items only. Do NOT re-implement GLM files in Step 5.

**RULE:** Prefer GLM tools, but fall back to Direct if GLM produces unusable output.

---

### 1. Verify Tools

Verify Linear MCP, GitHub CLI, GCloud available. Fail fast if unavailable.

### 2. Create Branch

```bash
git fetch origin
git checkout -b fix/INT-XXX origin/development  # or feature/INT-XXX
```

**Branch naming:**

| Issue Type | Pattern            |
| ---------- | ------------------ |
| Bug        | `fix/INT-XXX`      |
| Feature    | `feature/INT-XXX`  |
| Refactor   | `refactor/INT-XXX` |

### 3. Build Packages

```bash
pnpm build
```

Required before any implementation work.

### 4. Update Linear State

```
Set state: "In Progress"
```

BEFORE any code changes.

### 5. Implement (Direct Implementation Only)

Implement items from the "Direct Implementation" table (GLM files already handled in Step 0):

1. Write tests first (from Test Requirements section)
2. Implement code for "Modified Files" and any GLM fallbacks
3. Do NOT re-implement files already written by GLM

### 6. CI Gate (MANDATORY)

```bash
pnpm run ci:tracked
```

**On failure:** Fix issues, re-run. Stop only after 3 failed attempts.

### 7. Commit and Push

```bash
git add -A
git commit -m "[INT-XXX] Implementation description"
git fetch origin && git merge origin/development
git push -u origin fix/INT-XXX
```

### 8. Create PR

```bash
gh pr create --base development \
  --title "[INT-XXX] Issue title" \
  --body "Fixes INT-XXX

## Summary
...

## Test Plan
..."
```

### 9. Update Linear State

```
Set state: "In Review"
```

Verify PR appears in Linear attachments.

### 10. Completion Statement (MANDATORY)

Output ALL of the following:

```
- PR: "PR created: <URL>" or "PR #XXX created"
- CI: "CI passed" or "pnpm run ci:tracked passed"
- Linear: "Linear updated to In Review" or "Linear state: In Review"
```

---

## Completion Validation

The completion-validator hook checks:

- [ ] PR created (URL or #XXX format)
- [ ] CI passed mentioned
- [ ] Linear updated to "In Review" mentioned

---

## Forbidden Actions

| Action                  | Why Forbidden                     |
| ----------------------- | --------------------------------- |
| Asking for confirmation | Non-interactive mode              |
| Skipping CI             | CI is mandatory gate              |
| Partial commits         | Complete the full cycle           |
| Manual Linear updates   | Use MCP for all state transitions |
