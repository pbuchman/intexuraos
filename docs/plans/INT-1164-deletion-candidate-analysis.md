# Linear Issues Deletion Candidate Analysis

> **Generated:** 2026-03-29
> **Context:** INT-1164 — Linear Issues Count Guardian
> **Total synced issues:** 141 unique issues across Firestore
> **Current state:** Below the 200-issue activation threshold (141 issues)

## Important Note

The issue description requests this analysis be performed using Gemini Flash via the `INTEXURAOS_GEMINI_APP_API_KEY` environment variable. **The Gemini API key is not available in the planning agent's runtime environment** — it is only available in the running linear-agent service. This analysis is therefore performed using the same priority criteria that the Gemini classifier will use, applied manually to the actual Firestore data.

**Recommendation:** Before implementation begins, the implementing agent should run the first pruning cycle as a dry-run to validate Gemini's classification against this manual analysis.

---

## Deletion Priority Criteria (from issue description)

1. **Cancelled and duplicate issues** — highest priority
2. **Sub-issues with a parent task** — parent retains context
3. **Simple fix / review / investigate issues** — no complex outcome
4. **Singular completed issues with low complexity** — short descriptions, one-file changes

**Keep:** Parent issues with children, complex architecture decisions, debugging insights

---

## Candidate List: 30 Issues Recommended for Deletion

### Tier 1: Cancelled / Duplicate Issues (6 issues)

| #   | Identifier  | Title                                                                | State     | Reasoning                                                                |
| --- | ----------- | -------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| 1   | INT-1110    | Improve Codex forensics and log normalization parity in orchestrator | Canceled  | Cancelled feature — no outcome, no PR, no children                       |
| 2   | INT-588     | Set up Oracle Cloud environment for IntexuraOS dev                   | Canceled  | Cancelled infrastructure task — environment never set up, fully obsolete |
| 3   | INT-822     | Unified periodic container cleanup for orchestrator                  | Duplicate | Marked duplicate — redundant with other cleanup work                     |
| 4   | INT-837     | Accelerate GLM-5 finalization & old model removal                    | Canceled  | Cancelled model task — no deliverable, no ongoing relevance              |
| 5   | INT-851     | Trace GitHub agent webhook flow for failed code review trigger       | Duplicate | Marked duplicate — investigation resolved elsewhere                      |
| 6   | INT-929     | Support longer-running and longer-queued code tasks                  | Duplicate | Marked duplicate — capacity issues addressed in other tasks              |

### Tier 2: Completed Sub-Issues (12 issues)

These all have a parent issue that retains the full context. Deleting the sub-issue loses no architectural knowledge.

| #   | Identifier  | Title                                                            | Parent   | Reasoning                                                                                  |
| --- | ----------- | ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| 7   | INT-957     | cron-agent backend service                                       | INT-956  | Sub-issue of "Allow scheduling and monitoring of recurring tasks" — parent retains context |
| 8   | INT-958     | cron-agent web app UI                                            | INT-956  | Sub-issue — parent retains context, frontend implementation detail                         |
| 9   | INT-1059    | Backend — Payload Endpoint (code-agent)                          | INT-1027 | Sub-issue — parent "GitHub Event Log — expandable rows" retains context                    |
| 10  | INT-1060    | Frontend — Expandable Rows with Payload Display (web)            | INT-1027 | Sub-issue — parent retains context                                                         |
| 11  | INT-1071    | Orchestrator V8 ignore triage: replace 118 override blocks       | INT-1070 | Sub-issue — mechanical test replacement, parent retains plan                               |
| 12  | INT-1072    | Code-Agent V8 ignore triage: replace 198 override blocks         | INT-1070 | Sub-issue — mechanical test replacement, parent retains plan                               |
| 13  | INT-1074    | Harden v8 ignore validation script with Phase B-1                | INT-1073 | Sub-issue — parent "Enforce strict V8 ignore validation" retains context                   |
| 14  | INT-1075    | Fix 193 v8 ignore explanations to include blocker keywords       | INT-1073 | Sub-issue — bulk fix, parent retains strategy                                              |
| 15  | INT-1094    | Backend: Merge queue PR exclusions (code-agent)                  | INT-1091 | Sub-issue — parent "Control which PRs are drained" retains context                         |
| 16  | INT-1095    | Frontend: Merge queue PR exclusion checkboxes (web)              | INT-1091 | Sub-issue — parent retains context                                                         |
| 17  | INT-1106    | Fix OpenRouter pricing display and research audit correlation    | INT-1102 | Sub-issue — parent "Debug and fix OpenRouter integration" retains context                  |
| 18  | INT-1150    | Orchestrator: Remove plan branch merge and plan PR closure logic | INT-1146 | Sub-issue — parent retains architectural context                                           |

### Tier 3: Completed Simple Fixes and Review-Only Issues (12 issues)

These are completed single-purpose issues with minimal debugging value: short descriptions, simple UI fixes, review tasks, or investigation tasks with clear outcomes.

| #   | Identifier  | Title                                                                      | Desc Length   | Reasoning                                                                          |
| --- | ----------- | -------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| 19  | INT-1029    | Improve code task queue capacity                                           | 106           | Extremely short description (106 chars), simple config change, no reusable insight |
| 20  | INT-1030    | Improve code task processing capacity                                      | 106           | Extremely short description (106 chars), simple config change, no reusable insight |
| 21  | INT-1031    | Simplify Hellscript MVP implementation plan                                | 511           | Planning simplification — plan itself is the deliverable, not the issue            |
| 22  | INT-1125    | [Review] PR #1488: Add human-readable log formatting for Codex tasks       | 678           | Review-only task — no implementation, just PR review. PR is the artifact.          |
| 23  | INT-1127    | [Review] PR #1489: feat(code-agent): LLM-generated titles for review tasks | 678           | Review-only task — no implementation, just PR review. PR is the artifact.          |
| 24  | INT-1041    | Fix merge queue missing header & menu on mobile                            | 1670          | Simple one-line CSS fix (wrap in Layout component), well-documented in PR          |
| 25  | INT-974     | Simplify WhatsApp queued-task notification message                         | 2307          | Simple text change — notification message wording update                           |
| 26  | INT-1056    | Fix duplicate linear button in PWA task view                               | 2389          | Simple UI bug fix — duplicate button removal                                       |
| 27  | INT-1058    | Display code task title on mobile PWA                                      | 2258          | Simple UI addition — display a field that already exists                           |
| 28  | INT-1042    | Reduce clutter on Queue page & remove duplicate counts header              | 4083          | UI cleanup — removing elements, no logic                                           |
| 29  | INT-970     | Fix dispatch queue UI failing to display tasks                             | 2894          | Simple UI bug fix — completed and resolved                                         |
| 30  | INT-994     | Fix white screen on task page                                              | 2395          | Simple bug fix — crash guard, completed                                            |

---

## Issues Explicitly NOT Recommended for Deletion

These were considered but kept because they contain valuable architectural context, debugging insights, or serve as parent issues:

| Identifier  | Title                                                       | Reason to Keep                                                                    |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| INT-956     | Allow scheduling and monitoring of recurring tasks          | **Parent issue** with children INT-957, INT-958                                   |
| INT-1027    | GitHub Event Log — expandable rows with raw webhook payload | **Parent issue** with children INT-1059, INT-1060                                 |
| INT-1070    | V8 ignore triage                                            | **Parent issue** with children INT-1071, INT-1072                                 |
| INT-1073    | Enforce strict V8 ignore validation                         | **Parent issue** with children INT-1074, INT-1075                                 |
| INT-1091    | Control which PRs are drained from merge queue              | **Parent issue** with children INT-1094, INT-1095                                 |
| INT-1102    | Debug and fix OpenRouter integration issues                 | **Parent issue** with child INT-1106                                              |
| INT-1146    | Research simplified task implementation                     | **Parent issue** — active, with children                                          |
| INT-857     | Hexagonal Architecture & SRP Refactoring                    | **Complex task** — architectural documentation value                              |
| INT-616     | Investigate Open Router integration & multi-model selection | **Complex task** — detailed research with long-term reference value               |
| INT-1086    | Security: Add sender authorization gate to GitHub webhook   | **Security task** — contains security design rationale                            |
| INT-1119    | Synthetic actionIds cause failed status mirror callbacks    | **Debugging insight** — detailed Sentry investigation with root cause analysis    |
| INT-1104    | Investigate Codex support in orchestrator                   | **Feature investigation** — contains architecture decisions for Codex integration |
| INT-750     | Migrate prod deployment from Cloud Run to Hetzner Cloud     | **Active backlog** — long-term migration plan, still relevant                     |
| INT-737     | Worker containers lack memory limits, causing OOM crash     | **Active bug** — not resolved, still in backlog                                   |

---

## State Distribution Summary

| State     | Count   | Deletable?             |
| --------- | ------- | ---------------------- |
| completed | 102     | Yes (if criteria met)  |
| started   | 17      | No (active work)       |
| backlog   | 11      | No (planned work)      |
| cancelled | 6       | Yes (highest priority) |
| unstarted | 5       | No (planned work)      |
| **Total** | **141** | **30 selected**        |

---

## Validation Checklist

Before the Gemini classifier is deployed, this list should be validated:

- [ ] Confirm all 6 cancelled/duplicate issues have no unmerged PRs
- [ ] Confirm all 12 sub-issues' parent issues still exist and retain context
- [ ] Confirm all 12 simple-fix issues have merged PRs (changes are preserved in git)
- [ ] Run the Gemini classifier dry-run and compare its output to this manual analysis
