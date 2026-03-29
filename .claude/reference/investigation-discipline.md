# Investigation Discipline Reference

When something breaks, go all the way to root cause and fix. No stopping at symptoms, no blaming tools.

---

## The Five Rules

### 1. Investigate the Environment, Not Just the Tool

Tool crashes are symptoms, not causes. Check: architecture, platform, build config, runtime environment, resource limits.

**Real example:** Claude CLI segfault was NOT a Claude bug — it was an amd64 binary running under Rosetta 2 emulation on an arm64 Mac. The environment was wrong, not the tool.

### 2. Follow the Causal Chain to Its Root

Surface cause is rarely root cause. Keep asking "why?" — minimum 3 layers deep.

**Real example:** SIGSEGV → architecture mismatch → amd64-only Docker manifest → CI `grep -qw` pattern matched `claude-worker` but the service was renamed to `code-worker`. Four layers. Every premature stopping point would have left the bug unfixed.

### 3. Diagnosis Without Fix Is Incomplete

Finding the cause is 50% of the work. Implementing and verifying the fix is the other 50%. Never stop at "the problem is X" — continue to "and here is the fix, verified by [evidence]."

### 4. Act During Incident Triage

During active incidents on dev environments: rebuild images, restart services, apply hotfixes immediately. Do NOT ask "should I rebuild?" — just rebuild.

The User Control gate applies to planned work, not incident response. Exception: destructive actions (deleting data, force-pushing) still require permission.

### 5. Never Blame Upstream Without Evidence

Before attributing a failure to a third-party tool: reproduce the issue, check the environment, verify the inputs. Only after proving the tool crashes in its intended environment with correct inputs can you attribute it to the tool itself.

---

## Investigation Checklist

When a tool, service, or container crashes:

- [ ] What is the exact error? (signal, exit code, error message)
- [ ] What is the runtime environment? (OS, arch, container base image, runtime version)
- [ ] What built this artifact? (CI pipeline, manual build, registry pull)
- [ ] Does the artifact match the target environment? (arch, OS, libc)
- [ ] What was the last change to the build/deploy pipeline?
- [ ] Can you reproduce the issue in a minimal case?
- [ ] What does the fix look like? (implement it, don't just describe it)
- [ ] How do you verify the fix works? (run it, show output)

---

## Case Study: The Docker Segfault (March 2026)

**Symptom:** Claude CLI segfaults (exit code 139) inside code-worker container on mac-dev. 6/6 tasks fail. 0 ever succeeded.

**Naive conclusion:** "Claude CLI has a bug" — WRONG

**Actual causal chain:**

| Layer | Finding | Evidence |
|-------|---------|----------|
| 1 | SIGSEGV signal 11 | Firestore task doc: `fatal_exit_code_139` |
| 2 | Container running amd64 on arm64 host | `docker exec uname -m` → x86_64, host `uname -m` → arm64 |
| 3 | Registry manifest amd64-only | `docker manifest inspect` → single-platform `v2+json`, not OCI index |
| 4 | CI service name mismatch | `MULTI_ARCH_SERVICES="claude-worker"` but deploy passes `"code-worker"` → `grep -qw` → no match → single-arch path |

**Fix:** Corrected service name in CI script, rebuilt and pushed multi-arch image, verified arm64 container runs natively without crash.

**Lesson:** 4 layers deep. Stopping at any earlier layer would have produced a wrong or incomplete answer.

---

## Forbidden Patterns (Guidance)

These are behavioral guidelines, not hook-enforced. When you catch yourself using these patterns, stop and investigate deeper.

| Pattern | What to Do Instead |
|---------|-------------------|
| "This is an upstream/tool bug" | Investigate the environment first |
| "The tool is broken" | Check your inputs, config, and environment |
| "I found the root cause" (at layer 1) | Ask "why?" at least 2 more times |
| "The problem is X" (with no fix) | "The problem is X, fixing it by Y" |
| "Should I rebuild/restart?" | During incidents: act, don't ask |
| Speculating about internal mechanisms | Reproduce it or cite evidence |
| Presenting findings without action | Implement the fix, present results |
