# INT-1298: Implement Investigation Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the investigation findings documented in `docs/plans/INT-1297-investigation.md`.

**Architecture:** The plan in `docs/plans/INT-1297-investigation.md` contains the full implementation specification. This document delegates execution to that plan without modification.

**Tech Stack:** As specified in `docs/plans/INT-1297-investigation.md`.

---

## Delegated Plan

- [ ] **Step 1: Execute the plan at `docs/plans/INT-1297-investigation.md`**

Read and implement every task defined in `docs/plans/INT-1297-investigation.md` from top to bottom, following all steps exactly as written.

Run all verification commands specified in that plan and confirm they pass before proceeding to the next step.

- [ ] **Step 2: Verify CI passes**

Run from repo root:
```bash
pnpm run ci:tracked
```
Expected: all workspaces pass with no errors.

- [ ] **Step 3: Commit and push**

```bash
git add -p
git commit -m "fix: implement INT-1297 investigation findings"
```
