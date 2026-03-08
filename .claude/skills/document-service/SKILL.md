---
name: document-service
description: Generate professional documentation for IntexuraOS services (apps, workers, packages). Produces 5 doc files per service, 3 per package, plus aggregated site content and cross-validation reports. Supports interactive, autonomous, and team-of-agents modes. Use when documenting services, generating docs, updating documentation, or validating doc consistency.
argument-hint: '[service-name]'
---

# Document Service

Generate comprehensive documentation for IntexuraOS services (apps, workers, and packages).

## Usage

```
/document-service                   # List available services (discovery mode)
/document-service <service-name>    # Document service interactively
```

**Autonomous mode:** Use Task tool with `subagent_type: service-scribe` for batch documentation without user interaction.

**Team mode:** Orchestrate parallel documentation agents for full monorepo coverage with cross-validation.

## Core Mandates

1. **Code-First Analysis**: Always analyze actual code before generating docs
2. **No Fabrication**: Never invent version numbers, endpoints, env vars, resource limits, line counts, or method names — only document what exists in source code. See `workflows/autonomous.md` Phase 3.5 for grounding rules
3. **Preserve User Insights**: Never lose user-provided context from previous runs
4. **Incremental Updates**: Website content updates are additive, not full regenerations
5. **Quality Assurance**: Self-critique before writing files to disk — includes mandatory factual validation (Phase 4.5)
6. **Debt Tracking**: Archive resolved items, never delete history
7. **Cross-Validation**: After generation, validate docs against code and other service docs
8. **Typographic Consistency**: Use em-dashes (`—`) not ASCII double-dashes (`--`) for parenthetical statements

## Output Files

### Per Service (apps/workers) — 5 files

| File                | Purpose                                      | Audience              |
| ------------------- | -------------------------------------------- | --------------------- |
| `features.md`       | Value propositions, capabilities, use cases  | Users, marketing      |
| `technical.md`      | Architecture, APIs, patterns, gotchas        | Developers, AI agents |
| `tutorial.md`       | Getting-started tutorial with exercises      | New developers        |
| `technical-debt.md` | Known issues, debt items, future plans       | Maintainers           |
| `agent.md`          | Machine-readable interface (autonomous only) | AI agents             |

### Per Package -- 3 files

| File                | Purpose                                | Audience    |
| ------------------- | -------------------------------------- | ----------- |
| `README.md`         | Overview, API, dependencies, usage     | Developers  |
| `technical-debt.md` | Known issues, debt items, future plans | Maintainers |
| `agent.md`          | Machine-readable interface             | AI agents   |

### Aggregation files

| File                    | Purpose             |
| ----------------------- | ------------------- |
| `services/index.md`     | Service catalog     |
| `site-index.json`       | Structured metadata |
| `overview.md`           | Project narrative   |
| `documentation-runs.md` | Run history log     |

### Cross-Validation reports

| File                               | Purpose                          |
| ---------------------------------- | -------------------------------- |
| `validation/http-contracts-*.md`   | HTTP endpoint consistency        |
| `validation/pubsub-contracts-*.md` | Pub/Sub topic/IAM consistency    |
| `validation/ai-models-*.md`        | AI model registry consistency    |
| `validation/firestore-*.md`        | Collection ownership consistency |
| `validation/package-deps-*.md`     | Package dependency consistency   |
| `validation/env-vars-*.md`         | Environment variable consistency |
| `validation/v*-run-report.md`      | Comprehensive run report         |

## Mode Selection

| Mode        | When to Use                           | Invocation                                |
| ----------- | ------------------------------------- | ----------------------------------------- |
| Discovery   | List services, check doc status       | `/document-service` (no args)             |
| Interactive | Document one service with user input  | `/document-service <service-name>`        |
| Autonomous  | Batch document one/few services       | Task tool -> `service-scribe`             |
| Team        | Full monorepo docs + cross-validation | Orchestrate parallel agents (see team.md) |

## Invocation Detection

| Input Pattern                       | Workflow                                             |
| ----------------------------------- | ---------------------------------------------------- |
| `/document-service`                 | [discovery.md](workflows/discovery.md)               |
| `/document-service <service>`       | [interactive.md](workflows/interactive.md)           |
| Task tool `service-scribe` subagent | [autonomous.md](workflows/autonomous.md)             |
| "Document all services" / team mode | [team.md](workflows/team.md)                         |
| "Validate docs" / "cross-validate"  | [cross-validation.md](workflows/cross-validation.md) |

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
