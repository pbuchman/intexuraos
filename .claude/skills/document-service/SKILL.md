---
name: document-service
description: |
  Generate professional documentation for IntexuraOS services.
  Produces 5 doc files per service plus updates aggregated site content.
  Supports interactive mode (asks questions) and autonomous mode (infers from code).

invocation: both

triggers:
  - '/document-service'
  - 'document.*service'
  - 'generate.*documentation'
  - 'update.*docs.*for'

modes:
  interactive:
    description: Asks 3 open questions (Q1, Q5, Q8), infers the rest from code
    invocation: '/document-service <service-name>'
  autonomous:
    description: Infers ALL answers from code analysis and git history
    invocation: 'Task tool with subagent_type: service-scribe'
---

# Document Service

Generate comprehensive documentation for IntexuraOS services.

## Usage

```
/document-service                   # List available services (discovery mode)
/document-service <service-name>    # Document service interactively
```

**Autonomous mode:** Use Task tool with `subagent_type: service-scribe` for batch documentation without user interaction.

## Core Mandates

1. **Code-First Analysis**: Always analyze actual code before generating docs
2. **Preserve User Insights**: Never lose user-provided context from previous runs
3. **Incremental Updates**: Website content updates are additive, not full regenerations
4. **Quality Assurance**: Self-critique before writing files to disk
5. **Debt Tracking**: Archive resolved items, never delete history

## Output Files

Each service produces 5 documentation files:

| File                | Purpose                                      | Audience              |
| ------------------- | -------------------------------------------- | --------------------- |
| `features.md`       | Value propositions, capabilities, use cases  | Users, marketing      |
| `technical.md`      | Architecture, APIs, patterns, gotchas        | Developers, AI agents |
| `tutorial.md`       | Getting-started tutorial with exercises      | New developers        |
| `technical-debt.md` | Known issues, debt items, future plans       | Maintainers           |
| `agent.md`          | Machine-readable interface (autonomous only) | AI agents             |

Plus website content updates:

| File                | Purpose                |
| ------------------- | ---------------------- |
| `services/index.md` | Service catalog        |
| `site-marketing.md` | Marketing pages source |
| `site-developer.md` | Developer docs source  |
| `site-index.json`   | Structured metadata    |
| `overview.md`       | Project narrative      |

## Mode Selection

| Mode        | When to Use                          | Invocation                         |
| ----------- | ------------------------------------ | ---------------------------------- |
| Discovery   | List services, check doc status      | `/document-service` (no args)      |
| Interactive | Document one service with user input | `/document-service <service-name>` |
| Autonomous  | Batch document all/multiple services | Task tool → `service-scribe`       |

## Invocation Detection

| Input Pattern                       | Workflow                                   |
| ----------------------------------- | ------------------------------------------ |
| `/document-service`                 | [discovery.md](workflows/discovery.md)     |
| `/document-service <service>`       | [interactive.md](workflows/interactive.md) |
| Task tool `service-scribe` subagent | [autonomous.md](workflows/autonomous.md)   |

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
