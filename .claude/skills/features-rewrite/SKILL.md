---
name: features-rewrite
description: Multi-agent convergence loop for rewriting service features.md. Spawns Opus writer + 6 critic agents, iterates until quality threshold met. Use when rewriting features docs or running the convergence review loop.
argument-hint: '<service-name> | --list'
---

# Features Rewrite — Multi-Agent Convergence Loop

Rewrite a service's `features.md` using 1 Opus writer + 6 critic agents iterating until convergence.

## Usage

```
/features-rewrite <service-name>     # Rewrite a specific service's features.md
/features-rewrite overview           # Rewrite docs/overview.md with full 6-critic loop
/features-rewrite --list             # Show all services with features.md + last modified
```

## Core Mandates

1. **Never write without vision input** — Extract from `memory/feature-review-log.md` or ask the user
2. **`technical.md` is the sole fact source** — Every claim must be verifiable against it
3. **Maximum 3 rounds** — Diminishing returns proven over 24 rewrites
4. **User approves final output** — Never overwrite features.md without explicit approval
5. **Log every run** — Append scores, outcome, and key corrections to `docs/features-rewrite-history.md`
6. **Check overview drift** — After every service rewrite, validate `docs/overview.md` for stale claims about that service

## Invocation Detection

| User Says                       | Action                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `/features-rewrite <name>`      | Execute `workflows/rewrite-single.md` for `<name>`       |
| `/features-rewrite overview`    | Execute `workflows/rewrite-overview.md`                  |
| `/features-rewrite --list`      | List all `docs/services/*/features.md` with `stat` dates |
| "rewrite features for X"        | Execute `workflows/rewrite-single.md` for X              |
| "rewrite the overview"          | Execute `workflows/rewrite-overview.md`                  |
| "run the convergence loop on X" | Execute `workflows/rewrite-single.md` for X              |

## Pre-Flight Checks

Before starting, verify all 3 inputs exist:

| Input               | Path                                 | If Missing                   |
| ------------------- | ------------------------------------ | ---------------------------- |
| Current features.md | `docs/services/<name>/features.md`   | STOP — service may not exist |
| Technical reference | `docs/services/<name>/technical.md`  | STOP — no fact source        |
| Owner's vision      | `memory/feature-review-log.md` entry | Ask user via AskUserQuestion |

## Agent Architecture

| Role                    | Model  | Count | Purpose                                         |
| ----------------------- | ------ | ----- | ----------------------------------------------- |
| Writer                  | Opus   | 1     | NYT-quality prose, structure template adherence |
| Platform Architect (PA) | Opus   | 1     | Technical accuracy, cross-service correctness   |
| External Developer      | Sonnet | 1     | Zero-context comprehensibility                  |
| Product Strategist      | Sonnet | 1     | Value proposition, differentiation              |
| End User                | Sonnet | 1     | Non-technical accessibility, jargon detection   |
| First-Time Builder      | Sonnet | 1     | Architecture clarity, inspiration               |
| Competitor Analyst      | Sonnet | 1     | Competitive positioning, moat communication     |

## User Checkpoints

| When                              | What User Sees                   | Options                                         |
| --------------------------------- | -------------------------------- | ----------------------------------------------- |
| After writer's draft (each round) | Full draft in features.md        | "Proceed to critics" / "Redirect with feedback" |
| After final convergence           | Final draft + scorecard summary  | "Accept" / "Provide additional direction"       |
| After overview drift check        | Drift report for changed service | "Rewrite overview now" / "Defer" / "Ignore"     |

## Workflows

| Target            | Workflow                        | Trigger                                                              |
| ----------------- | ------------------------------- | -------------------------------------------------------------------- |
| Single service    | `workflows/rewrite-single.md`   | `/features-rewrite <service-name>`                                   |
| Platform overview | `workflows/rewrite-overview.md` | `/features-rewrite overview` or drift check → "Rewrite overview now" |

## References

| File                                | Contains                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `reference/writing-rules.md`        | NYT style, banned words, structure template                     |
| `reference/convergence-criteria.md` | Scoring thresholds, decision matrix, max rounds                 |
| `reference/critic-roles.md`         | 6 critic personas and evaluation axes                           |
| `templates/writer-prompt.md`        | Writer agent prompt with placeholders                           |
| `templates/critic-*.md`             | 6 critic prompts with placeholders                              |
| `templates/scorecard.md`            | Structured output format for all critics                        |
| `workflows/rewrite-overview.md`     | Overview convergence loop (all 24 features.md as input)         |
| `docs/features-rewrite-history.md`  | Rewrite audit trail — scores, outcomes, corrections per service |
