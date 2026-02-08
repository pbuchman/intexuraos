# Cross-Validation Workflow

Validate documentation consistency across services by tracing documented claims back to actual code.

## Purpose

After documentation generation, cross-validate that:
1. Service docs agree with each other (caller docs match callee docs)
2. Service docs agree with actual code (endpoints, models, collections match)
3. Code agrees with infrastructure (Terraform IAM, env vars, topic definitions)

## Methodology

**CRITICAL: Start from docs, trace to code.** Not the reverse.

Each validation agent:
1. Reads all relevant documentation files
2. Extracts claims (endpoints, topics, models, collections, env vars)
3. Reads the actual code to verify each claim
4. Reports discrepancies with severity, location, and fix instructions

## Validation Domains

### 1. HTTP Contracts

**Agent prompt:**

```
Cross-validate all internal HTTP endpoints documented across services.

Steps:
1. Read docs/services/*/technical.md -- extract all Internal Endpoints tables
2. For each endpoint: read the actual route file to verify path and method
3. For each cross-service call: verify caller docs match callee docs AND code
4. Look for endpoints in code NOT in docs (undocumented endpoints)
5. Look for endpoints in docs NOT in code (phantom endpoints)

Report format: docs/validation/http-contracts-validation.md
Include: complete endpoint registry, cross-service call matrix, discrepancy list
```

**Sources to check:**
- `docs/services/*/technical.md` -- Internal Endpoints tables
- `apps/*/src/routes/internalRoutes.ts` -- actual route definitions
- `docs/services/*/agent.md` -- machine-readable endpoint specs

### 2. Pub/Sub Contracts

**Agent prompt:**

```
Cross-validate all Pub/Sub topics, publishers, and subscribers.

Steps:
1. Read docs/services/*/technical.md -- extract Published Events and Subscribed Events tables
2. Read terraform/environments/dev/main.tf -- extract all pubsub_* modules
3. For each topic: verify publisher IAM permissions match actual publishers in code
4. For each publisher: verify the topic env var exists in REQUIRED_ENV
5. Check docs/architecture/pubsub-standards.md for consistency

Report format: docs/validation/pubsub-contracts-validation.md
Include: complete topic inventory, publisher-subscriber map, IAM permission matrix
```

**Sources to check:**
- `docs/services/*/technical.md` -- Event tables
- `terraform/environments/dev/main.tf` -- Module definitions and IAM
- `apps/*/src/infra/pubsub/*.ts` -- Publisher implementations
- `apps/*/src/index.ts` -- REQUIRED_ENV arrays

### 3. AI Models

**Agent prompt:**

```
Cross-validate AI model documentation against the llm-contract registry.

Steps:
1. Read packages/llm-contract/src/supportedModels.ts -- the source of truth
2. Read docs/overview.md and docs/services/index.md -- model counts and listings
3. Read each service technical.md -- model references
4. Search code for hardcoded model strings not in llm-contract
5. Verify model naming consistency (display name vs model ID vs short form)

Report format: docs/validation/ai-models-validation.md
Include: master model inventory, count inconsistencies, naming variations
```

**Sources to check:**
- `packages/llm-contract/src/supportedModels.ts` -- Master registry
- `packages/llm-factory/src/*.ts` -- Factory provider support
- `apps/*/src/**/*.ts` -- Hardcoded model references
- `docs/overview.md`, `docs/services/index.md` -- High-level model claims

### 4. Firestore Collections

**Agent prompt:**

```
Cross-validate Firestore collection documentation against the registry.

Steps:
1. Read firestore-collections.json -- the ownership registry
2. Read docs/services/*/technical.md -- collection references
3. Grep code for Firestore collection names to verify ownership
4. Check for cross-service direct Firestore access violations
5. Verify collection names match between docs and code (casing, prefixes)

Report format: docs/validation/firestore-validation.md
Include: master inventory, ownership conflicts, naming discrepancies
```

**Sources to check:**
- `firestore-collections.json` -- Registry
- `apps/*/src/infra/*.ts` -- Firestore repository implementations
- `docs/services/*/technical.md` -- Collection references

### 5. Package Dependencies

**Agent prompt:**

```
Cross-validate package dependency documentation.

Steps:
1. Read each packages/*/package.json -- actual dependencies
2. Read docs/packages/*/README.md -- documented dependencies and "Used By"
3. Verify no circular dependencies exist
4. Verify "Used By" counts match actual dependents
5. Check for undocumented dependencies and phantom documented deps

Report format: docs/validation/package-deps-validation.md
Include: dependency matrix, reverse dependency map, circular dep check
```

**Sources to check:**
- `packages/*/package.json` -- Actual dependencies
- `docs/packages/*/README.md` -- Documented dependencies
- `apps/*/package.json` -- App-level package usage

### 6. Environment Variables

**Agent prompt:**

```
Cross-validate environment variable documentation against 4 sources.

Steps:
1. Read docs/services/*/technical.md -- documented env vars
2. Read apps/*/src/index.ts -- REQUIRED_ENV arrays
3. Read terraform/environments/dev/main.tf -- terraform-provided vars
4. Read ecosystem.config.cjs -- local dev configuration
5. Compare all 4 sources for each service

Report format: docs/validation/env-vars-validation.md
Include: per-service comparison tables, systemic issues, terraform coverage
```

**Sources to check:**
- `docs/services/*/technical.md` -- Configuration tables
- `apps/*/src/index.ts` -- REQUIRED_ENV arrays
- `terraform/environments/dev/main.tf` -- env_vars and secrets blocks
- `ecosystem.config.cjs` -- COMMON_SERVICE_ENV and SERVICE_ENV_MAPPINGS

---

## Severity Classification

| Severity | Definition                                                          | Examples                                        |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| CRITICAL | Production bug; service will fail at runtime                        | Missing IAM permission, wrong endpoint path     |
| HIGH     | Incorrect documentation that would mislead developers significantly | Wrong env var names, missing required endpoints  |
| MEDIUM   | Incomplete documentation or minor inconsistencies                   | Missing endpoints from table, count mismatches  |
| LOW      | Cosmetic issues, naming conventions, minor omissions                | Naming style differences, optional vars missing |

---

## Report Template

Each validation report should follow this structure:

```markdown
# <Domain> Cross-Validation Report

**Generated:** YYYY-MM-DD
**Scope:** <what was checked>
**Method:** Documentation-first, traced to code

---

## Summary

| Metric              | Count |
| ------------------- | ----- |
| Total items checked | N     |
| Items verified OK   | N     |
| Discrepancies found | N     |

---

## Complete Inventory
<tables showing all items checked>

## Discrepancies
<D1, D2, ... with severity, location, problem, fix>

## Action Items
<Prioritized list of fixes needed>
```

---

## Running Cross-Validation Independently

Cross-validation can run independently of a full documentation run:

```
User: "Validate the HTTP contracts across all services"
→ Spawn one cross-validation agent for HTTP contracts domain
→ Produces docs/validation/http-contracts-validation.md
```

This is useful for:
- Spot-checking after code changes
- Pre-release validation
- Debugging integration issues between services
