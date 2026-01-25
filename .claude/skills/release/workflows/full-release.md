# Full Release Workflow

**Trigger:** User calls `/release`

---

## Phase 1: Kickoff

### 1.1 Tool Verification

Verify all required tools are available:

```bash
git --version
gh auth status
node --version
```

If any fails, ABORT with clear error message.

### 1.2 Read Current State

```bash
# Current version
cat package.json | jq -r '.version'

# Last release tag
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
echo "Last tag: $LAST_TAG"

# Date of last release
git log -1 --format="%ci" $LAST_TAG
```

### 1.3 Get Merged PRs Since Last Release

```bash
# Get date of last tag for filtering
LAST_TAG_DATE=$(git log -1 --format="%ci" $LAST_TAG | cut -d' ' -f1)

# List merged PRs since that date
gh pr list --state merged --base development --json number,title,body,mergedAt,author --limit 100 | \
  jq --arg date "$LAST_TAG_DATE" '[.[] | select(.mergedAt > $date)]'
```

### 1.4 Detect Modified Services

```bash
# Find apps changed since last tag (excluding web app)
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
MODIFIED_SERVICES=$(git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web)
echo "Modified services: $MODIFIED_SERVICES"
```

### 1.5 Determine Version Bump

Follow the semver-release logic:

| Change Type       | Version Bump | Detection                            |
| ----------------- | ------------ | ------------------------------------ |
| Breaking changes  | MAJOR        | `breaking` label, API removal        |
| New features      | MINOR        | `feature` label, new endpoints       |
| Bug fixes/patches | PATCH        | `bug` label, `fix:` prefix           |

Calculate new version: `CURRENT_VERSION` → `NEW_VERSION`

### 1.6 Ask for Release Focus

Use `AskUserQuestion` tool:

```
Release Focus

Detected:
- Version: X.Y.Z → X.Y.Z+1
- Modified services: [list]
- PRs merged: [count]

What should be highlighted in this release? (optional)
```

**Options:**
1. "Auto-detect from PRs" (Recommended)
2. "Let me specify highlights"
3. "Skip highlights"

---

## Phase 2: Service Documentation (Silent Batch)

### 2.1 For Each Modified Service

For each service in `MODIFIED_SERVICES`:

```
Use Task tool with:
- subagent_type: "service-scribe"
- prompt: "Generate documentation for the <service-name> service"
- run_in_background: false (wait for completion)
```

### 2.2 Parallel Execution

Launch ALL service-scribe agents in a single message with multiple Task tool calls:

```
Task 1: service-scribe for actions-agent
Task 2: service-scribe for bookmarks-agent
Task 3: service-scribe for research-agent
... etc
```

### 2.3 Wait for Completion

All agents must complete before proceeding. Do NOT checkpoint here — this is silent batch processing.

---

## Phase 3: High-Level Docs (Checkpoint)

### 3.1 Read Current Overview

```bash
cat docs/overview.md
```

### 3.2 Analyze Changes

From merged PRs and modified services, identify:
- New capabilities added
- Significant architectural changes
- New integrations or patterns

### 3.3 Propose Updates

Draft specific additions/modifications to `docs/overview.md`:

```markdown
## Proposed Changes to docs/overview.md

### Section: [section name]
**Change type:** [Add | Modify | Remove]
**Current content:**
> [existing text if modifying]

**Proposed content:**
> [new text]

**Rationale:** [why this change]
```

### 3.4 CHECKPOINT

Use `AskUserQuestion` tool:

```
High-Level Documentation Update

[Show proposed changes]

Approve these changes to docs/overview.md?
```

**Options:**
1. "Approve" — Apply changes
2. "Revise" — Provide feedback
3. "Skip" — Proceed without changes

If "Revise": Ask for feedback, incorporate, re-present.

### 3.5 Apply Changes

If approved, use Edit tool to update `docs/overview.md`.

---

## Phase 4: README Update (Checkpoint)

### 4.1 Read Current README

```bash
head -150 README.md
```

### 4.2 Generate "What's New" Section

Use template from [`templates/readme-whats-new.md`](../templates/readme-whats-new.md).

Extract from merged PRs:
- Feature titles (user-facing language)
- Brief descriptions (1 sentence each)
- Sort by impact/importance

### 4.3 CHECKPOINT

Use `AskUserQuestion` tool:

```
README "What's New" Section

## What's New in vX.Y.Z

| Feature | Description |
|---------|-------------|
| **Feature A** | One-sentence description |
| **Feature B** | One-sentence description |
| ... |

Approve this "What's New" section?
```

**Options:**
1. "Approve" — Apply changes
2. "Revise" — Provide feedback
3. "Skip" — Proceed without changes

### 4.4 Apply Changes

If approved, use Edit tool to:
1. Replace existing "What's New in vX.Y.Z" section
2. Update version number in section header

---

## Phase 5: Website Improvements (Checkpoint)

### 5.1 Generate RecentUpdatesSection Content

Map release features to website-ready content:
- Transform PR/feature descriptions into user-facing language
- Group by category (Features, Improvements, Fixes)
- Prepare props for `RecentUpdatesSection.tsx`

### 5.2 Run Website Audit

Follow [`workflows/website-audit.md`](website-audit.md) to:
1. Analyze release impact on website sections
2. Review `HomePage.tsx` for staleness/improvements
3. Identify quick wins and high-impact changes

### 5.3 Compile Exactly 3 Suggestions

Combine audit results into EXACTLY 3 suggestions:

| Type        | What                          | Why                      | Effort |
| ----------- | ----------------------------- | ------------------------ | ------ |
| [FEATURE]   | Update RecentUpdatesSection   | New release content      | Low    |
| [IMPROVE]   | Enhance hero section          | Reflect new capabilities | Medium |
| [CONTENT]   | Add testimonial/case study    | Social proof             | Medium |

### 5.4 CHECKPOINT

Use `AskUserQuestion` tool:

```
Website Improvement Suggestions

Based on this release, here are 3 website improvements:

1. [TYPE] **What**: ...
   **Why**: ...
   **Effort**: Low/Medium/High

2. [TYPE] **What**: ...
   **Why**: ...
   **Effort**: Low/Medium/High

3. [TYPE] **What**: ...
   **Why**: ...
   **Effort**: Low/Medium/High

Which suggestions should I implement?
```

**Options (multiSelect: true):**
1. "Suggestion 1"
2. "Suggestion 2"
3. "Suggestion 3"
4. "None — skip website updates"

### 5.5 Implement Selected Suggestions

For EACH selected suggestion, invoke the frontend-design skill:

```
Use Skill tool with:
- skill: "frontend-design"
- args: "<description of the website change>"
```

Wait for each to complete before starting the next.

---

## Phase 6: Finalize

### 6.1 CI Gate (MANDATORY)

```bash
pnpm run ci:tracked
```

**This MUST pass.** If it fails:
1. Report the failure
2. Fix the issues
3. Re-run CI
4. Do NOT proceed until CI passes

### 6.2 Stage All Changes

```bash
git status
git add -A
```

### 6.3 Commit Release

```bash
NEW_VERSION="X.Y.Z"  # From Phase 1

git commit -m "$(cat <<'EOF'
Release vX.Y.Z

- Updated service documentation
- Updated docs/overview.md
- Updated README "What's New" section
- Website improvements

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 6.4 Create and Push Tag

```bash
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

### 6.5 Display Summary

Use template from [`templates/release-summary.md`](../templates/release-summary.md).

---

## Error Handling

### CI Failure in Phase 6

If `pnpm run ci:tracked` fails:

1. **Do NOT commit or tag**
2. Report which checks failed
3. Fix the issues
4. Re-run CI
5. Only after CI passes, proceed with commit/tag

### User Declines All Changes

If user skips all checkpoint phases (3, 4, 5):

1. Phase 6 still runs
2. Commit message reflects only version bump
3. Tag is still created and pushed

### Agent Failure in Phase 2

If a service-scribe agent fails:

1. Log the error
2. Continue with other agents
3. Report partial success in summary
4. Allow user to decide whether to proceed
