# PraxOS Documentation

## Philosophy

**Notion models the world. PraxOS executes.**

PraxOS is the execution layer for a personal operating system where Notion serves as the single source of truth for goals, projects, actions, and context. PraxOS bridges the gap between structured planning in Notion and automated execution via LLM-powered agents.

## Core Principles

### No Dummy Success

Every operation must either:

- Succeed with verifiable results
- Fail explicitly with actionable error information

Silent failures, empty results masquerading as success, and optimistic assumptions are forbidden. If something cannot be verified, it did not happen.

### Determinism

Given the same inputs and state, operations must produce the same outputs. Side effects must be predictable and auditable.

### Idempotency

Operations should be safe to retry. Running the same action twice with the same inputs must not corrupt state or produce duplicates.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Notion (Truth)                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  PraxOS (Execution)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ auth-service│  │notion-gpt   │  │ future services │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐│
│  │                 Domain Layer                        ││
│  │  identity │ promptvault │ actions                   ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │              Infrastructure Layer                   ││
│  │  auth0 │ notion │ firestore                         ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

For detailed package contracts and dependency rules, see [Package Contracts](./architecture/package-contracts.md).

## Status

This is **sandbox v1** - a minimal viable scaffold for validating the architecture and workflows before production deployment.

---

_For setup instructions, see the forthcoming setup guide._
