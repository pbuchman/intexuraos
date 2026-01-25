# Phase Checklist Reference

Quick reference for all release phases and their requirements.

---

## Phase 1: Kickoff

- [ ] Verify tools: `git`, `gh`, `node`
- [ ] Read current version from `package.json`
- [ ] Find last release tag
- [ ] List merged PRs since last release
- [ ] Detect modified services
- [ ] Calculate version bump (major/minor/patch)
- [ ] Ask user for release focus (AskUserQuestion)

**Commands:**

```bash
cat package.json | jq -r '.version'
git tag -l "v*" --sort=-v:refname | head -1
gh pr list --state merged --base development --limit 100
git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web
```

---

## Phase 2: Service Docs (Silent)

- [ ] For each modified service: spawn service-scribe agent
- [ ] Run all agents in parallel
- [ ] Wait for all completions
- [ ] No checkpoint — silent batch processing

**Tool Usage:**

```
Task tool with subagent_type: "service-scribe"
Multiple Task calls in single message for parallel execution
```

---

## Phase 3: High-Level Docs (Checkpoint)

- [ ] Read `docs/overview.md`
- [ ] Analyze changes from release
- [ ] Draft proposed updates
- [ ] **CHECKPOINT**: Present, wait for approval
- [ ] If approved: apply changes with Edit tool

**Checkpoint Options:**

1. Approve — Apply changes
2. Revise — Incorporate feedback, re-present
3. Skip — Proceed without changes

---

## Phase 4: README (Checkpoint)

- [ ] Read current README.md
- [ ] Generate "What's New" section using template
- [ ] **CHECKPOINT**: Present, wait for approval
- [ ] If approved: replace section with Edit tool

**Template:** `templates/readme-whats-new.md`

**Checkpoint Options:**

1. Approve — Apply changes
2. Revise — Incorporate feedback, re-present
3. Skip — Proceed without changes

---

## Phase 5: Website (Checkpoint)

- [ ] Generate RecentUpdatesSection content
- [ ] Run website audit (see `workflows/website-audit.md`)
- [ ] Compile EXACTLY 3 suggestions
- [ ] **CHECKPOINT**: Present, wait for selection
- [ ] For each selected: invoke `/frontend-design` skill

**Template:** `templates/website-suggestions.md`

**Selection Rules:**

- At least 1 release-driven
- At least 1 Low effort
- Maximum 1 High effort

**Checkpoint Options (multiSelect):**

1. Suggestion 1
2. Suggestion 2
3. Suggestion 3
4. None — skip website updates

---

## Phase 6: Finalize

- [ ] Run `pnpm run ci:tracked` — **MUST PASS**
- [ ] Stage all changes: `git add -A`
- [ ] Commit with release message
- [ ] Create tag: `git tag -a "vX.Y.Z"`
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Display summary using template

**Commands:**

```bash
pnpm run ci:tracked
git add -A
git commit -m "Release vX.Y.Z..."
git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
git push origin "vX.Y.Z"
```

**Template:** `templates/release-summary.md`

---

## Quick Commands Reference

| Action                   | Command                                        |
| ------------------------ | ---------------------------------------------- |
| Get current version      | `cat package.json \| jq -r '.version'`         |
| Get last tag             | `git tag -l "v*" --sort=-v:refname \| head -1` |
| List merged PRs          | `gh pr list --state merged --base development` |
| Detect modified services | `git diff --name-only $TAG..HEAD -- apps/`     |
| Run CI                   | `pnpm run ci:tracked`                          |
| Create tag               | `git tag -a "vX.Y.Z" -m "Release vX.Y.Z"`      |
| Push tag                 | `git push origin vX.Y.Z`                       |

---

## Checkpoint Pattern Explained

At each checkpoint (Phases 3, 4, 5):

```
┌─────────────────────────────────────────┐
│ 1. Present proposed changes             │
│    - Clear formatting                   │
│    - Explain what will change           │
│    - Show before/after if applicable    │
├─────────────────────────────────────────┤
│ 2. STOP execution                       │
│    - Do NOT proceed automatically       │
│    - Wait for user input                │
├─────────────────────────────────────────┤
│ 3. Use AskUserQuestion                  │
│    - Approve: Apply and continue        │
│    - Revise: Get feedback, redo         │
│    - Skip: Continue without changes     │
├─────────────────────────────────────────┤
│ 4. Handle response                      │
│    - If approved: Edit tool to apply    │
│    - If revise: Loop back to step 1     │
│    - If skip: Move to next phase        │
└─────────────────────────────────────────┘
```

---

## Error Recovery

| Error                         | Recovery                                |
| ----------------------------- | --------------------------------------- |
| CI fails in Phase 6           | Fix issues, re-run CI, then commit      |
| service-scribe agent fails    | Log error, continue with other services |
| User declines all checkpoints | Proceed with version-only release       |
| Tool unavailable              | ABORT immediately with clear error      |

---

## Resume from Phase

To resume from a specific phase after interruption:

```
/release --phase N
```

| N   | Phase Name      | What Gets Skipped          |
| --- | --------------- | -------------------------- |
| 2   | Service Docs    | Kickoff (uses cached data) |
| 3   | High-Level Docs | Phases 1-2                 |
| 4   | README          | Phases 1-3                 |
| 5   | Website         | Phases 1-4                 |
| 6   | Finalize        | All documentation phases   |
