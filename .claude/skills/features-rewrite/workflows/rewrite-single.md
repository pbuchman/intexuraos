# Workflow: Rewrite Single Service

Main convergence loop for rewriting one service's `features.md`.

## Phase 1: Gather Inputs

### 1.1 Read Required Files

Read all three inputs:

```
docs/services/<name>/features.md      → {{CURRENT_CONTENT}}
docs/services/<name>/technical.md     → source for {{FACTS}}
memory/feature-review-log.md          → extract {{VISION}} for this service
```

If any file is missing, STOP and inform the user.

### 1.2 Extract Vision

Search `memory/feature-review-log.md` for the section matching `### <N>. <service-name>`. Extract the entire section including:

- User's vision paragraph
- Key emphasis bullets
- De-emphasize bullets
- The story quote

This entire section becomes `{{VISION}}`.

If no vision entry exists for this service, use AskUserQuestion:

> "No vision found for {{SERVICE_NAME}} in feature-review-log.md. Please describe: What is this service's core story? What should features.md emphasize?"

### 1.3 Extract Facts

Read `technical.md` and filter to user-facing facts only. Remove:

- Environment variable names and configurations
- Terraform/infrastructure details
- Internal architecture (DI containers, service patterns)
- Testing details
- Migration details
- Package dependency lists

Keep:

- Endpoints and what they do (in user terms)
- Capabilities and features
- Integrations with other services (what they enable for the user)
- Configuration options users interact with
- Limitations and constraints

The filtered content becomes `{{FACTS}}`.

### 1.4 Initialize Round Counter

Set `{{ROUND}}` = 1, `{{FEEDBACK}}` = "This is the first draft. No prior feedback."

---

## Phase 2: Draft

### 2.1 Prepare Writer Prompt

Read `templates/writer-prompt.md` and substitute all placeholders:

- `{{SERVICE_NAME}}` → service display name (title case, e.g., "Calendar Agent")
- `{{VISION}}` → from Phase 1.2
- `{{FACTS}}` → from Phase 1.3
- `{{CURRENT_CONTENT}}` → current features.md content
- `{{ROUND}}` → current round number
- `{{FEEDBACK}}` → consolidated feedback (or first-draft message)

### 2.2 Spawn Writer Agent

Spawn 1 Opus writer agent via the Task tool:

```
Task tool:
  subagent_type: general-purpose
  model: opus
  name: "features-writer"
  prompt: <substituted writer prompt>
```

The writer returns the full markdown content for features.md.

### 2.3 Write Draft

Write the writer's output to `docs/services/<name>/features.md`.

### 2.4 User Checkpoint

Display the draft to the user. Ask:

> **Round {{ROUND}} draft written to `docs/services/<name>/features.md`.**
>
> Options:
>
> 1. "Proceed to critics" — send to 6 critics for evaluation
> 2. "Redirect" — provide feedback to incorporate before critics see it

If user provides feedback, incorporate it into `{{FEEDBACK}}` and return to Phase 2.1.

---

## Phase 3: Critic Evaluation

### 3.1 Prepare Critic Prompts

Read all 6 critic templates and substitute placeholders:

- `{{SERVICE_NAME}}` → service display name
- `{{DRAFT}}` → the current features.md content
- `{{VISION}}` → from Phase 1.2
- `{{TECHNICAL_MD}}` → full technical.md content (PA only)

### 3.2 Spawn 6 Critics in Parallel

Spawn all 6 critics simultaneously via the Task tool:

```
# Platform Architect (PA) — Opus
Task tool:
  subagent_type: general-purpose
  model: opus
  name: "critic-pa"
  prompt: <substituted PA prompt>

# External Developer — Sonnet
Task tool:
  subagent_type: general-purpose
  model: sonnet
  name: "critic-developer"
  prompt: <substituted developer prompt>

# Product Strategist — Sonnet
Task tool:
  subagent_type: general-purpose
  model: sonnet
  name: "critic-strategist"
  prompt: <substituted strategist prompt>

# End User — Sonnet
Task tool:
  subagent_type: general-purpose
  model: sonnet
  name: "critic-enduser"
  prompt: <substituted end user prompt>

# First-Time Builder — Sonnet
Task tool:
  subagent_type: general-purpose
  model: sonnet
  name: "critic-builder"
  prompt: <substituted builder prompt>

# Competitor Analyst — Sonnet
Task tool:
  subagent_type: general-purpose
  model: sonnet
  name: "critic-competitor"
  prompt: <substituted competitor prompt>
```

### 3.3 Print Convergence Table

After all 6 return, display a summary table:

```
## Round {{ROUND}} Results

| Critic              | Model  | Score | Verdict |
|---------------------|--------|-------|---------|
| Platform Architect  | Opus   | X/10  | SHIP/REVISE |
| External Developer  | Sonnet | X/10  | SHIP/REVISE |
| Product Strategist  | Sonnet | X/10  | SHIP/REVISE |
| End User            | Sonnet | X/10  | SHIP/REVISE |
| First-Time Builder  | Sonnet | X/10  | SHIP/REVISE |
| Competitor Analyst  | Sonnet | X/10  | SHIP/REVISE |

**Average:** X.XX | **SHIP votes:** N/6
```

---

## Phase 4: Convergence Decision

Apply the decision matrix from `reference/convergence-criteria.md`:

| Condition             | Action             | Next                        |
| --------------------- | ------------------ | --------------------------- |
| 6/6 SHIP              | Done               | → Phase 6                   |
| Mixed, avg >= 6.5     | Targeted edits     | → Phase 5                   |
| 0/6 SHIP or avg < 6.5 | Full rewrite       | → Phase 2 (increment round) |
| Round 3 reached       | Polish and present | → Phase 6                   |

When looping back to Phase 2:

- Increment `{{ROUND}}`
- Consolidate feedback per `reference/convergence-criteria.md` priority tiers
- Set `{{FEEDBACK}}` to the consolidated feedback

---

## Phase 5: Targeted Edit Pass

Only reached when some critics voted SHIP and avg >= 6.5.

### 5.1 Consolidate REVISE Feedback

Collect feedback ONLY from critics who voted REVISE. Skip SHIP critics' suggestions — what they approved should be preserved.

### 5.2 Apply Edits

Use the Edit tool to make specific targeted changes to the existing draft in `docs/services/<name>/features.md`. Do NOT spawn a new writer — apply edits directly.

### 5.3 Proceed to Final

→ Phase 6

---

## Phase 6: Present Final

### 6.1 Display Final Output

Show the user:

1. The final features.md content
2. The most recent convergence table
3. A brief summary of what changed across rounds

### 6.2 User Approval

Ask:

> **Final draft ready.**
>
> Options:
>
> 1. "Accept" — features.md is done
> 2. "Additional direction" — provide feedback for another pass

If user accepts → log the run (Phase 6.3), then done.
If user provides direction → incorporate as `{{FEEDBACK}}`, return to Phase 2 (respecting 3-round max for automated loops, but user-directed rounds can continue).

### 6.3 Log to Rewrite History

Append a row to the service table in `docs/features-rewrite-history.md` under the current date heading. If today's date heading doesn't exist, create a new section.

Each row records:

```
| <service-name> | <PA score> | <Dev score> | <Strat score> | <EU score> | <Build score> | <Comp score> | <avg> | <SHIP count>/6 | <outcome> |
```

Append **R** after scores with REVISE verdicts. Outcome is one of: Done, Targeted edits, Full rewrite.

If the PA applied factual corrections, append a row to the "Key PA Corrections Applied" table:

```
| <service-name> | <1-line summary of each correction> |
```

---

## Phase 7: Overview Drift Check

**MANDATORY** — runs after every service rewrite, regardless of outcome.

### 7.1 Read Overview

Read `docs/overview.md` and find all mentions of `{{SERVICE_NAME}}`. Extract every sentence or bullet that references this service.

### 7.2 Compare Against New Features

Spawn 1 Haiku agent to compare the service's overview.md mentions against the new features.md:

```
Task tool:
  subagent_type: general-purpose
  model: haiku
  name: "overview-drift-check"
  prompt: |
    Compare these two texts about {{SERVICE_NAME}}.

    OVERVIEW.MD MENTIONS:
    {{OVERVIEW_MENTIONS}}

    NEW FEATURES.MD (Key Benefits + first paragraph of each "How It Helps" section):
    {{FEATURES_SUMMARY}}

    Report:
    1. DRIFT DETECTED or NO DRIFT
    2. If drift: list each discrepancy (what overview says vs what features says)
    3. If drift: severity (STALE = overview describes old behavior, MINOR = emphasis shift, MISSING = overview doesn't mention this service at all)
```

### 7.3 Report to User

Display the drift check result. If drift detected:

> **Overview drift detected for {{SERVICE_NAME}}.**
>
> {{DISCREPANCIES}}
>
> Options:
>
> 1. "Rewrite overview now" — triggers `workflows/rewrite-overview.md`
> 2. "Defer" — noted in rewrite history, overview rewrite deferred
> 3. "Ignore" — no action needed

If no drift: print "Overview check: no drift detected for {{SERVICE_NAME}}." and proceed.

### 7.4 Log Drift Status

Append to the rewrite history entry for this service:

```
Overview drift: NONE | STALE | MINOR | MISSING (deferred/resolved/ignored)
```

---

## --list Mode

When invoked with `--list`, skip the convergence loop entirely. Instead:

```bash
for dir in docs/services/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/features.md" ]; then
    mod=$(stat -c %Y "$dir/features.md" 2>/dev/null || stat -f %m "$dir/features.md")
    date=$(date -d "@$mod" "+%Y-%m-%d %H:%M" 2>/dev/null || date -r "$mod" "+%Y-%m-%d %H:%M")
    echo "$name  $date"
  fi
done
```

Display as a table:

```
| Service | Last Modified |
|---------|---------------|
| ...     | ...           |
```
