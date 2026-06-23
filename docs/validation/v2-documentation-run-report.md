# v2 Documentation Run Report

**Generated:** 2026-02-19
**Method:** Parallel agent orchestration (team: monorepo-docs)
**Model:** Claude Sonnet 4.6 (all agents)
**Duration:** ~20 minutes wall-clock (parallelized)

---

## Executive Summary

Full monorepo documentation refresh covering all 20 apps, 4 workers, and 22 packages. Produced 186 documentation files across 46 components, plus 4 aggregation files and 6 cross-validation reports. Cross-validation identified **33 discrepancies** across 6 domains, with **0 CRITICAL** runtime issues found.

| Metric                     | Count |
| -------------------------- | ----- |
| Apps documented            | 20    |
| Workers documented         | 4     |
| Packages documented        | 22    |
| Total doc files refreshed  | 186   |
| Aggregation files updated  | 4     |
| Validation reports created | 6     |
| Total discrepancies found  | 33    |
| Critical issues            | 0     |

---

## Phase 2: Documentation Generation

### Execution

| Wave   | Scope                                      | Agents | Status    |
| ------ | ------------------------------------------ | ------ | --------- |
| Wave 1 | 10 apps (actions-agent to image-service)   | 10     | Completed |
| Wave 2 | 10 apps (linear-agent to whatsapp-service) | 10     | Completed |
| Wave 3 | 4 workers + 4 package batches              | 8      | Completed |

**Total Phase 2 agents:** 28
**Concurrency:** 10-13 agents per wave (limited by tmux pane capacity)
**Agent type:** `service-scribe` (Sonnet)

### Files Generated Per Component

| Component Type | Files Per Component                            | Components | Total Files |
| -------------- | ---------------------------------------------- | ---------- | ----------- |
| Apps           | 5 (features, technical, tutorial, debt, agent) | 20         | 100         |
| Workers        | 5 (features, technical, tutorial, debt, agent) | 4          | 20          |
| Packages       | 3 (README, debt, agent)                        | 22         | 66          |
| **Total**      |                                                | 46         | 186         |

### New Documentation Created

| Component  | Status | Notes                    |
| ---------- | ------ | ------------------------ |
| infra-otel | NEW    | First-time documentation |

All other components were incremental updates preserving existing user insights.

---

## Phase 3: Aggregation

| File                    | Status  | Notes                               |
| ----------------------- | ------- | ----------------------------------- |
| `services/index.md`     | Updated | Full catalog with all 46 components |
| `overview.md`           | Updated | Project narrative refreshed         |
| `site-index.json`       | Updated | Structured metadata current         |
| `documentation-runs.md` | Updated | This run logged                     |

---

## Phase 4: Cross-Validation Findings

### Summary by Domain

| Domain                | Items Checked | Verified OK | Discrepancies | Severity Breakdown     |
| --------------------- | ------------- | ----------- | ------------- | ---------------------- |
| HTTP Contracts        | 52            | 40          | 12            | 0C / 4H / 5M / 3L      |
| Pub/Sub Contracts     | 14            | 12          | 9             | 0C / 1H / 5M / 3L      |
| AI Models             | 18            | 16          | 2             | 0C / 1H / 1M / 0L      |
| Firestore Collections | 45            | 43          | 2             | 0C / 0H / 2M / 0L      |
| Package Dependencies  | 21            | 21          | 0             | Clean                  |
| Environment Variables | 10 services   | 4           | 8+            | 0C / 3H / 5M / varies  |
| **Total**             |               |             | **33+**       | **0C / 9H / 18M / 6L** |

### Key Findings

#### HTTP Contracts (12 discrepancies)

1. **Phantom `/llm-client` endpoint** (HIGH): 4 services (calendar-agent, retired-checklist-service, linear-agent, image-service) document a non-existent `/internal/users/:id/llm-client` endpoint. The actual pattern uses `@intexuraos/internal-clients` which calls two separate user-service endpoints (`/llm-keys` + `/settings`).

2. **Undocumented endpoints** (MEDIUM): 3 endpoints exist in code but not in documentation tables (e.g., `PATCH /internal/actions/:actionId/status` in actions-agent).

3. **Path mismatches** (HIGH): image-service docs reference `/api-keys` but actual endpoint is `/llm-keys`.

#### Pub/Sub Contracts (9 discrepancies)

1. **Docs-vs-code naming** (MEDIUM): 5 topic names in documentation use slightly different naming than Terraform modules.
2. **Stale references** (LOW): 2 obsolete topic references in older documentation.

#### AI Models (2 discrepancies)

1. **Model count mismatch** (HIGH): `overview.md` claims "17 models" but llm-contract defines 16, and 18 are actually in use (2 outside the registry: `gpt-4.1` in image-service, `text-embedding-3-small` in retired-chat-service).

2. **Unregistered models** (MEDIUM): 2 models used in code but not in the llm-contract registry.

#### Firestore Collections (2 discrepancies)

1. **Orphaned registry entries** (MEDIUM): `user_spend` and `visualizations` are in `firestore-collections.json` but not found in any service code. Possible dead collections or collections used by deprecated features.

#### Package Dependencies (0 discrepancies)

Clean. No circular dependencies. `common-core` is the foundational leaf package depended on by all 20 others.

#### Environment Variables (8+ discrepancies)

1. **Docs-code gaps** (HIGH): whatsapp-service and user-service each have 5 issues where documented env vars don't match REQUIRED_ENV or Terraform.
2. **Terraform coverage** (MEDIUM): Some vars in code but not in Terraform configs (potential startup probe failures in production).

---

## Systemic Patterns

1. **`/llm-client` documentation pattern**: Multiple services incorrectly document the LLM client acquisition as a single endpoint call. The actual mechanism goes through `@intexuraos/internal-clients` package. This is a documentation convention issue, not a code bug.

2. **Model count drift**: The model registry grows as new models are added, but high-level documentation (overview.md, index.md) doesn't auto-update counts. Suggest adding a script or CI check.

3. **Package batch agent context limits**: Agents processing 5-6 packages hit context window limits. Future runs should batch max 3-4 packages per agent for thorough coverage.

---

## Recommendations

### Priority 1 (Fix in docs)

- [ ] Correct `/llm-client` phantom endpoint in 4 service technical.md files
- [ ] Fix model count in overview.md and services/index.md (16 in registry, 18 in use)
- [ ] Add undocumented endpoints to actions-agent technical.md

### Priority 2 (Investigate)

- [ ] Verify if `user_spend` and `visualizations` Firestore collections are still used
- [ ] Register `gpt-4.1` and `text-embedding-3-small` in llm-contract or document as exceptions
- [ ] Align env var documentation with REQUIRED_ENV for whatsapp-service and user-service

### Priority 3 (Process improvement)

- [ ] Add CI check for model count consistency
- [ ] Consider smaller package batches (3-4) for future documentation runs
- [ ] Add pre-commit hook to validate env var documentation when index.ts changes

---

## Agent Execution Summary

| Phase          | Agents | Type            | Model  | Mode              |
| -------------- | ------ | --------------- | ------ | ----------------- |
| Phase 2 Wave 1 | 10     | service-scribe  | Sonnet | bypassPermissions |
| Phase 2 Wave 2 | 10     | service-scribe  | Sonnet | bypassPermissions |
| Phase 2 Wave 3 | 8      | service-scribe  | Sonnet | bypassPermissions |
| Phase 3        | 4      | general-purpose | Sonnet | bypassPermissions |
| Phase 4        | 6      | general-purpose | Sonnet | bypassPermissions |
| **Total**      | **38** |                 |        |                   |

---

_Report generated by team-lead orchestrator. See individual validation reports in `docs/validation/` for full details._
