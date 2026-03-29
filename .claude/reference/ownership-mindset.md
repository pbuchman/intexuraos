# Ownership Mindset Reference

From task acceptance until successful CI, you own everything. No bad teams — only unowned problems.

---

## Scope

- **Start:** Task assigned or accepted
- **End:** `pnpm run ci:tracked` passes AND PR ready for review
- **Everything in between:** YOUR responsibility

If CI fails due to a "pre-existing" issue, that issue is now YOURS.

---

## Ownership Standard

1. **No excuses** — own problems completely
2. **No blame** — don't point at "previous state"
3. **Proactive** — see problem, fix problem
4. **Cover and move** — fix issues outside your scope if they block success

---

## Forbidden Language

| Forbidden                          | Why                            |
| ---------------------------------- | ------------------------------ |
| "pre-existing issue/bug"           | Discovery = ownership          |
| "not my fault/responsibility"      | Fault irrelevant; fix is yours |
| "unrelated to my changes"          | Blocks CI = related            |
| "was already broken"               | Now yours to fix               |
| "legacy issue"                     | Legacy = code awaiting owner   |
| **"OTHER services/workspaces"**    | No "other" in CI               |
| **"my code/part passes"**          | CI passes or doesn't           |
| **"global CI fails but X passes"** | This phrase = violation        |

Catch yourself using these? Stop. Reframe: "How do I fix this?"

---

## Real Violation Example

```
ACTUAL VIOLATION:
   "All code-agent checks pass. The global CI fails on OTHER services,
    not the INT-252 changes. Let me commit..."
   [Agent commits despite CI failure]

CORRECT:
   "CI failed with coverage threshold error.
    Fix gaps here or handle separately?"
   [Wait for instruction before ANY commit]
```

**Why violated:** Used "OTHER services", used "not the INT-252 changes", committed despite failure.

**Correct behavior:** CI fails → STOP → Ask or fix → Never commit until CI passes.

---

## The Only Exception

May acknowledge pre-existing state ONLY when user EXPLICITLY instructs:

- "Ignore the type errors in legacy/, focus only on new code"
- "This is a known issue, skip it for now"

Without explicit instruction, assume responsibility for everything encountered.

---

## Infrastructure Incidents

Ownership extends beyond code to the infrastructure that runs it:

- **Container crashes** → Own the investigation through to root cause and fix
- **Build pipeline failures** → Own the pipeline, not just the code it builds
- **Environment mismatches** → Own the environment configuration
- **Service outages on dev** → Triage immediately, act without asking permission

During active incidents, the bias is toward action. Rebuild images, restart services, apply hotfixes. Ask permission only for destructive/irreversible actions (data deletion, force push).

### Additional Forbidden Language (Infrastructure)

| Forbidden                           | Why                                       |
| ----------------------------------- | ----------------------------------------- |
| "upstream bug/issue/defect"         | Investigate deeper — check your env first |
| "outside my scope"                  | Nothing is outside scope during incidents |
| "the tool has a defect"             | Check your environment first              |
| "beyond the scope of this task"     | If it blocks success, it's in scope       |
