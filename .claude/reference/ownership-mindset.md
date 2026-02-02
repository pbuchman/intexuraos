# Ownership Mindset Reference

Detailed examples and forbidden language patterns for the ownership mindset principle.

---

## Forbidden Language Table

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
❌ ACTUAL VIOLATION:
   "All code-agent checks pass. The global CI fails on OTHER services,
    not the INT-252 changes. Let me commit..."
   [Agent commits despite CI failure]

✅ CORRECT:
   "CI failed with coverage threshold error.
    Fix gaps here or handle separately?"
   [Wait for instruction before ANY commit]
```

**Why violated:** Used "OTHER services", used "not the INT-252 changes", committed despite failure.

**Correct behavior:** CI fails → STOP → Ask or fix → Never commit until CI passes.
