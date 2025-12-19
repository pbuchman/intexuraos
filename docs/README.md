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

For API response formats and service contracts, see [API Contracts](./architecture/api-contracts.md).

For aggregated API documentation from all services, see [API Docs Hub](./architecture/api-contracts.md#runtime-openapi-aggregation).

For branding guidelines and assets, see [Branding](./assets/branding/README.md).

## Setup Guides

Step-by-step guides for setting up PraxOS infrastructure:

1. [GCP Project Setup](./setup/01-gcp-project.md) - Create and configure GCP project
2. [Terraform Bootstrap](./setup/02-terraform-bootstrap.md) - Initialize infrastructure
3. [Cloud Build Trigger](./setup/03-cloud-build-trigger.md) - Configure CI/CD pipeline
4. [Cloud Run Services](./setup/04-cloud-run-services.md) - Deploy and manage services
5. [Local Development](./setup/05-local-dev-with-gcp-deps.md) - Run locally with GCP dependencies

## Infrastructure

- [Terraform Configuration](../terraform/README.md) - Infrastructure as code
- [Cloud Build Pipeline](../cloudbuild/cloudbuild.yaml) - CI/CD configuration

## Status

This is **sandbox v1** - a minimal viable scaffold for validating the architecture and workflows before production deployment.
