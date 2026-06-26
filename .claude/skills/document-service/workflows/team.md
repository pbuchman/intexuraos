# Team Workflow

Run when orchestrating documentation for multiple services using parallel agents.

## Purpose

Document the entire monorepo (or a subset) using a team of parallel agents, with cross-validation of inter-service contracts. This is the fastest and most thorough documentation approach, suitable for release documentation, full refreshes, and audits.

## When to Use

- Full monorepo documentation refresh
- Release documentation (many services changed)
- New service onboarding (batch of related services)
- Cross-validation audit

## Architecture

```
Orchestrator (team lead)
├── Phase 1: Discovery Agents (3 parallel)
│   ├── Apps diff agent
│   ├── Workers diff agent
│   └── Packages diff agent
├── Phase 2: Documentation Agents (N parallel)
│   ├── Existing service agents (Sonnet, incremental)
│   ├── New service agents (Opus, greenfield)
│   └── Package agents (Opus or Sonnet)
├── Phase 3: Aggregation Agents (4 parallel)
│   ├── services/index.md agent
│   ├── overview.md agent
│   ├── site-index.json agent
│   └── documentation-runs.md agent
└── Phase 4: Cross-Validation Agents (6 parallel)
    ├── HTTP contracts agent
    ├── Pub/Sub contracts agent
    ├── AI models agent
    ├── Firestore collections agent
    ├── Package dependencies agent
    └── Environment variables agent
```

---

## Phase 1: Discovery

### Goal

Identify which components need documentation by comparing the current branch against a base branch (usually `origin/main`).

### Agent Setup

Spawn 3 parallel `general-purpose` agents (model: haiku) with these prompts:

#### Agent 1: Apps Discovery

```
Compare apps/ directory between development and origin/main.
Run: git diff --name-only origin/main...HEAD -- apps/ | cut -d/ -f2 | sort -u
For each modified app, check if docs/services/<app>/ exists.
Categorize as: NEW (no docs), UPDATED (has docs), REMOVED (app deleted).
Return the categorized list.
```

#### Agent 2: Workers Discovery

```
Compare workers/ directory between development and origin/main.
Run: git diff --name-only origin/main...HEAD -- workers/ | cut -d/ -f2 | sort -u
For each modified worker, check if docs/services/<worker>/ exists.
Categorize as: NEW (no docs), UPDATED (has docs), REMOVED (worker deleted).
Return the categorized list.
```

#### Agent 3: Packages Discovery

```
Compare packages/ directory between development and origin/main.
Run: git diff --name-only origin/main...HEAD -- packages/ | cut -d/ -f2 | sort -u
For each modified package, check if docs/packages/<package>/ exists.
Categorize as: NEW (no docs), UPDATED (has docs).
Return the categorized list.
```

### Output

Merge results into a documentation plan:

```
APPS:
  NEW: [notes-agent, code-agent]          → Opus agents
  UPDATED: [user-service, whatsapp-service, ...]  → Sonnet agents
  REMOVED: [promptvault-service]          → Clean up docs

WORKERS:
  NEW: [orchestrator, claude-worker, ...]  → Opus agents
  UPDATED: []                              → Sonnet agents

PACKAGES:
  NEW: [common-core, infra-claude, ...]    → Opus agents
  UPDATED: []                              → Sonnet agents
```

---

## Phase 2: Documentation Generation

### Agent Model Selection

| Component Status     | Agent Model | Rationale                                         |
| -------------------- | ----------- | ------------------------------------------------- |
| NEW (no docs exist)  | Opus        | Greenfield needs deep code analysis and inference |
| UPDATED (docs exist) | Sonnet      | Incremental updates; preserves user insights      |
| REMOVED              | None        | Clean up with `rm -rf docs/services/<name>/`      |

### Agent Grouping Strategy

- **One agent per app/worker** -- each service is independent
- **Batch packages** -- group up to 6 related packages per agent to reduce overhead
  - LLM packages: llm-contract, llm-factory, llm-pricing, llm-prompts, llm-utils, llm-audit
  - Infra packages: infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity, infra-pubsub, infra-sentry, infra-firestore
  - Common + HTTP: common-core, common-http, http-contracts, http-server, infra-whatsapp
  - Integration: internal-clients, infra-notion

### Per-Agent Instructions

Each documentation agent receives:

```
You are documenting <service-name> for the IntexuraOS monorepo.

Component type: [app | worker | package]
Documentation status: [NEW | UPDATED]

For apps/workers, generate 5 files:
  - features.md (marketing-ready)
  - technical.md (developer reference)
  - tutorial.md (getting-started guide)
  - technical-debt.md (debt tracking)
  - agent.md (machine-readable interface)

For packages, generate 3 files:
  - README.md (overview, API, dependencies, usage)
  - technical-debt.md (debt tracking)
  - agent.md (machine-readable interface)

If UPDATED: Read existing docs first, preserve user-provided insights,
update only sections that changed. Use git log to find recent changes.

If NEW: Infer all context from code analysis. See inference-rules.md.

Output location:
  - Apps/Workers: docs/services/<service-name>/
  - Packages: docs/packages/<package-name>/
```

### Execution

1. Spawn all documentation agents in parallel using `run_in_background: true`
2. Monitor completion via output files
3. Track which agents completed successfully
4. Re-run failed agents if needed

### Batching for Large Runs

For 20+ components, batch in waves of 10-15 concurrent agents to avoid resource saturation.

---

## Phase 3: Aggregation

### Prerequisite

All Phase 2 agents must complete before starting Phase 3.

### Agent Setup

Spawn 4 parallel `general-purpose` agents (model: haiku for simple aggregation):

#### Agent 1: services/index.md

```
Read all docs/services/*/features.md and docs/packages/*/README.md files.
Update docs/services/index.md to reflect current state:
- Add newly documented services to appropriate sections
- Remove deleted services
- Update documentation counts and completion percentages
- Add Workers and Packages sections if missing
```

#### Agent 2: overview.md

```
Read docs/services/index.md (freshly updated by Agent 1 is ideal but work from existing).
Read existing docs/overview.md.
Update the project narrative to reflect new capabilities:
- Add new service categories if applicable
- Update architecture diagrams
- Update statistics (service count, model count, etc.)
```

#### Agent 3: site-index.json

```
Read all docs/services/*/agent.md and docs/packages/*/agent.md files.
Update docs/site-index.json with:
- New service entries in the services array
- New package entries (add packages array if missing)
- Updated stats (totalServices, documentedServices, completion)
- Updated lastUpdated date
```

#### Agent 4: documentation-runs.md

```
Append a new entry to docs/documentation-runs.md for this run.
Include: date, version, scope, method, files created/updated,
new/removed services, package documentation summary.
```

---

## Phase 4: Cross-Validation

### Prerequisite

Phase 2 must complete. Phase 3 can run in parallel with Phase 4 (they are independent).

### Purpose

Verify that documentation across services is consistent with actual code, Terraform, and other service docs. Each agent starts from documentation and traces claims to code.

### Agent Setup

Spawn 6 parallel `general-purpose` agents (model: sonnet for thorough analysis):

See [cross-validation.md](cross-validation.md) for detailed agent prompts and methodology.

#### Agent 1: HTTP Contracts

Validate all `/internal/*` endpoint documentation against actual route code and cross-service caller/callee docs.

#### Agent 2: Pub/Sub Contracts

Validate all topic documentation against publisher code, Terraform modules, and IAM permissions.

#### Agent 3: AI Models

Validate model inventory in docs against `llm-contract`, `llm-factory`, and individual service code.

#### Agent 4: Firestore Collections

Validate collection names and ownership against `firestore-collections.json` registry and actual code.

#### Agent 5: Package Dependencies

Validate documented dependencies against `package.json` files and "Used By" sections.

#### Agent 6: Environment Variables

Validate documented env vars against REQUIRED_ENV arrays, Terraform, and ecosystem.config.cjs.

### Output

Each agent produces a report at `docs/validation/<domain>-validation.md`.

---

## Phase 5: Report Generation

### Prerequisite

All phases 2-4 complete.

### Final Report

Generate `docs/validation/v<version>-documentation-run-report.md` consolidating:

1. Executive summary with key numbers
2. Discovery results (what changed)
3. Documentation generation summary (files created/updated)
4. Aggregation changes
5. Cross-validation findings organized by priority
6. Systemic patterns discovered
7. Recommendations for fixes
8. Agent execution summary

---

## Orchestrator Checklist

```
□ Phase 1: Discovery agents complete
  □ Apps diff results collected
  □ Workers diff results collected
  □ Packages diff results collected
  □ Documentation plan created

□ Phase 2: Documentation agents complete
  □ All app agents finished
  □ All worker agents finished
  □ All package agents finished
  □ Removed services cleaned up

□ Phase 3: Aggregation agents complete
  □ services/index.md updated
  □ overview.md updated
  □ site-index.json updated
  □ documentation-runs.md logged

□ Phase 4: Cross-validation agents complete
  □ HTTP contracts report generated
  □ Pub/Sub contracts report generated
  □ AI models report generated
  □ Firestore collections report generated
  □ Package dependencies report generated
  □ Environment variables report generated

□ Phase 5: Report generation
  □ Comprehensive report generated
  □ All validation reports in docs/validation/
```

---

## Tips for Orchestrators

1. **Launch Phase 2 agents with `run_in_background: true`** -- they are independent and can run in parallel
2. **Use `bypassPermissions` mode** for autonomous agents that only write to `docs/`
3. **Monitor via filesystem** -- check `docs/services/<name>/technical.md` existence to track completion
4. **Batch large package groups** -- 6 packages per agent is efficient; more risks context overflow
5. **Phases 3 and 4 can overlap** -- aggregation and validation are independent
6. **Re-read validation reports before generating the final report** -- they contain the source data
