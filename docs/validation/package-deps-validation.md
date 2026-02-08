# Package Dependency Cross-Validation Report

**Generated:** 2026-02-08
**Scope:** All 21 `@intexuraos/*` packages -- internal dependency relationships only

---

## 1. Package Dependency Matrix

Each row shows what a package depends on. Only `@intexuraos/*` dependencies are listed.

| Package              | Actual Dependencies (package.json)                                                     |
| -------------------- | -------------------------------------------------------------------------------------- |
| `common-core`        | (none)                                                                                 |
| `common-http`        | `common-core`, `llm-utils`                                                             |
| `http-contracts`     | (none)                                                                                 |
| `http-server`        | `common-core`, `common-http`, `infra-firestore`                                        |
| `infra-claude`       | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-firestore`    | `common-core`                                                                          |
| `infra-gemini`       | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-glm`          | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-gpt`          | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-notion`       | `common-core`                                                                          |
| `infra-perplexity`   | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-pubsub`       | `common-core`                                                                          |
| `infra-sentry`       | `common-core`                                                                          |
| `infra-whatsapp`     | `common-core`                                                                          |
| `internal-clients`   | `common-core`, `llm-contract`, `llm-factory`, `llm-pricing`                            |
| `llm-audit`          | `common-core`, `infra-firestore`, `llm-contract`                                       |
| `llm-contract`       | `common-core`                                                                          |
| `llm-factory`        | `common-core`, `infra-gemini`, `infra-glm`, `llm-contract`, `llm-pricing`              |
| `llm-pricing`        | `common-core`, `infra-firestore`, `llm-contract`                                       |
| `llm-prompts`        | `common-core`, `llm-contract`, `llm-utils`                                             |
| `llm-utils`          | `common-core`                                                                          |

---

## 2. Reverse Dependency Map (Who Depends On Each Package)

| Package              | Depended On By (packages only)                                                          |
| -------------------- | --------------------------------------------------------------------------------------- |
| `common-core`        | ALL 20 other packages                                                                   |
| `common-http`        | `http-server`                                                                           |
| `http-contracts`     | (none -- only used by apps)                                                             |
| `http-server`        | (none -- only used by apps)                                                             |
| `infra-claude`       | (none -- only used by apps)                                                             |
| `infra-firestore`    | `http-server`, `llm-audit`, `llm-pricing`                                               |
| `infra-gemini`       | `llm-factory`                                                                           |
| `infra-glm`          | `llm-factory`                                                                           |
| `infra-gpt`          | (none -- only used by apps)                                                             |
| `infra-notion`       | (none -- only used by apps)                                                             |
| `infra-perplexity`   | (none -- only used by apps)                                                             |
| `infra-pubsub`       | (none -- only used by apps)                                                             |
| `infra-sentry`       | (none -- only used by apps)                                                             |
| `infra-whatsapp`     | (none -- only used by apps)                                                             |
| `internal-clients`   | (none -- only used by apps)                                                             |
| `llm-audit`          | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`            |
| `llm-contract`       | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`, `internal-clients`, `llm-audit`, `llm-factory`, `llm-pricing`, `llm-prompts` |
| `llm-factory`        | `internal-clients`                                                                      |
| `llm-pricing`        | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`, `internal-clients`, `llm-factory` |
| `llm-prompts`        | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`            |
| `llm-utils`          | `common-http`, `llm-prompts`                                                           |

---

## 3. Documentation vs Actual Dependencies -- Discrepancies

### 3.1 Documented Dependencies NOT in package.json

These dependencies are mentioned in README docs but do NOT appear in the actual `package.json` file.

| Package            | Doc Claims Dependency On | Status                                                                      |
| ------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `infra-firestore`  | (none documented)        | OK -- docs list no internal deps, package.json has only `common-core`       |
| `infra-notion`     | (none documented)        | OK -- docs list no internal deps, package.json has only `common-core`       |
| `infra-whatsapp`   | (none documented)        | OK -- docs list no internal deps, package.json has only `common-core`       |

No phantom documented dependencies found. All documented `@intexuraos/*` dependencies exist in the corresponding `package.json` files.

### 3.2 Actual Dependencies NOT Documented

These dependencies exist in `package.json` but are NOT mentioned in the README documentation.

| Package            | Undocumented Dependency | Severity | Notes                                                                        |
| ------------------ | ----------------------- | -------- | ---------------------------------------------------------------------------- |
| `infra-claude`     | `llm-prompts`           | HIGH     | package.json lists it; README mentions it in "Cross-Cutting Concerns" but NOT in the Dependencies section |
| `infra-claude`     | `llm-audit`             | HIGH     | package.json lists it; README mentions it in "Cross-Cutting Concerns" but NOT in the Dependencies section |
| `infra-claude`     | `llm-pricing`           | HIGH     | package.json lists it; README mentions it in "Cross-Cutting Concerns" but NOT in the Dependencies section |
| `infra-claude`     | `llm-contract`          | HIGH     | package.json lists it; README mentions types from it but has no Dependencies section table |
| `infra-claude`     | `common-core`           | HIGH     | package.json lists it; no Dependencies section in README at all              |
| `infra-gemini`     | `llm-prompts`           | HIGH     | Same pattern as infra-claude -- no Dependencies section table                |
| `infra-gemini`     | `llm-audit`             | HIGH     | Same pattern                                                                 |
| `infra-gemini`     | `llm-pricing`           | HIGH     | Same pattern                                                                 |
| `infra-gemini`     | `llm-contract`          | HIGH     | Same pattern                                                                 |
| `infra-gemini`     | `common-core`           | HIGH     | Same pattern                                                                 |
| `infra-glm`        | `llm-prompts`           | HIGH     | Same pattern as infra-claude -- no Dependencies section table                |
| `infra-glm`        | `llm-audit`             | HIGH     | Same pattern                                                                 |
| `infra-glm`        | `llm-pricing`           | HIGH     | Same pattern                                                                 |
| `infra-glm`        | `llm-contract`          | HIGH     | Same pattern                                                                 |
| `infra-glm`        | `common-core`           | HIGH     | Same pattern                                                                 |
| `infra-gpt`        | `llm-prompts`           | HIGH     | Same pattern as infra-claude -- no Dependencies section table                |
| `infra-gpt`        | `llm-audit`             | HIGH     | Same pattern                                                                 |
| `infra-gpt`        | `llm-pricing`           | HIGH     | Same pattern                                                                 |
| `infra-gpt`        | `llm-contract`          | HIGH     | Same pattern                                                                 |
| `infra-gpt`        | `common-core`           | HIGH     | Same pattern                                                                 |
| `infra-perplexity` | `llm-prompts`           | HIGH     | Same pattern as infra-claude -- no Dependencies section table                |
| `infra-perplexity` | `llm-audit`             | HIGH     | Same pattern                                                                 |
| `infra-perplexity` | `llm-pricing`           | HIGH     | Same pattern                                                                 |
| `infra-perplexity` | `llm-contract`          | HIGH     | Same pattern                                                                 |
| `infra-perplexity` | `common-core`           | HIGH     | Same pattern                                                                 |
| `infra-notion`     | `common-core`           | MEDIUM   | package.json lists it; no Dependencies section in README                     |

**Pattern:** The five LLM provider packages (`infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`) all share the same 5 internal dependencies (`common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`) but none of them have a formal "Dependencies" table in their README. They reference the deps informally in "Cross-Cutting Concerns" sections. `infra-whatsapp` and `infra-notion` similarly lack a Dependencies section.

### 3.3 "Used By" Section Accuracy

Verified the "Used By" sections in documentation against actual `package.json` files for key packages.

| Package         | Doc "Used By" Packages Claim                                      | Actual Package Dependents                                                          | Match? |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `common-core`   | 13 packages listed + `llm-audit`                                  | All 20 other packages                                                              | PARTIAL -- count says 13 but lists include `llm-audit` making 14; actual is 20 since `http-contracts` has no dep but is in code |
| `infra-firestore`| `http-server`, `llm-audit`, `llm-pricing`                        | `http-server`, `llm-audit`, `llm-pricing`                                          | MATCH  |
| `llm-contract`  | 7 packages: `llm-factory`, `llm-pricing`, `llm-audit`, `llm-prompts`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-glm`, `infra-perplexity`, `internal-clients` | Same set                                                                           | PARTIAL -- doc says "7" but lists 10 items |
| `llm-pricing`   | 6 packages: `llm-factory`, `internal-clients`, `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` | Same set                                                                           | PARTIAL -- doc says "6" but lists 7 items |
| `llm-prompts`   | 5 packages: `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` | Same set                                                                           | MATCH  |
| `llm-audit`     | 5 packages: `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` | Same set                                                                           | MATCH  |
| `llm-utils`     | 2 packages: `llm-prompts`, `common-http`                         | `llm-prompts`, `common-http`                                                       | MATCH  |
| `llm-factory`   | 1 package: `internal-clients`                                     | `internal-clients`                                                                 | MATCH  |
| `common-http`   | 1 package: `http-server`                                          | `http-server`                                                                      | MATCH  |

---

## 4. "Used By" Count Mismatches

Several README files state a package count in their "Used By" section that does not match the number of items actually listed.

| Package        | Stated Count       | Actually Listed | Correct Count |
| -------------- | ------------------ | --------------- | ------------- |
| `common-core`  | "Packages (13)"    | 14 items listed | 14 (or more)  |
| `llm-contract` | "Packages (7)"     | 10 items listed | 10            |
| `llm-pricing`  | "Packages (6)"     | 7 items listed  | 7             |

---

## 5. Missing Documentation

The package `llm-audit` exists in the codebase (`packages/llm-audit/`) with a README at `docs/packages/llm-audit/README.md`, but it was NOT included in the original validation checklist. It has been validated as part of this report anyway.

| Package      | Has README? | Has package.json? | Docs Consistent? |
| ------------ | ----------- | ------------------ | ----------------- |
| `llm-audit`  | Yes         | Yes                | Yes               |

---

## 6. Circular Dependency Check

Analyzed the dependency graph for cycles among all 21 packages.

**Result: No circular dependencies detected.**

The dependency graph forms a DAG (directed acyclic graph) with `common-core` at the root. The deepest dependency chain is:

```
internal-clients -> llm-factory -> infra-gemini -> llm-prompts -> llm-utils -> common-core
                                               \-> llm-audit  -> infra-firestore -> common-core
                                               \-> llm-pricing -> infra-firestore -> common-core
                                               \-> llm-contract -> common-core
```

Maximum depth: 6 levels from `internal-clients` to `common-core`.

---

## 7. Service-to-Package Relationship Accuracy (Spot Checks)

### 7.1 research-agent

| Package in service package.json    | Documented in any package "Used By"? |
| ---------------------------------- | ------------------------------------ |
| `common-core`                      | Yes (common-core README)             |
| `common-http`                      | Yes (common-http README)             |
| `http-contracts`                   | Yes (http-contracts README)          |
| `http-server`                      | Yes (http-server README)             |
| `infra-claude`                     | Yes (infra-claude README)            |
| `infra-firestore`                  | Yes (infra-firestore README)         |
| `infra-notion`                     | Yes (infra-notion README)            |
| `infra-gemini`                     | Yes (infra-gemini README)            |
| `infra-glm`                        | Not in infra-glm "Used By"           |
| `infra-gpt`                        | Yes (infra-gpt README)              |
| `infra-perplexity`                 | Yes (infra-perplexity README)        |
| `infra-pubsub`                     | Yes (infra-pubsub README)            |
| `infra-sentry`                     | Yes (infra-sentry README)            |
| `internal-clients`                 | Yes (internal-clients README)        |
| `llm-prompts`                      | Yes (llm-prompts README)             |
| `llm-utils`                        | Yes (llm-utils README)               |
| `llm-contract`                     | Yes (llm-contract README)            |
| `llm-factory`                      | Yes (llm-factory README)             |
| `llm-pricing`                      | Yes (llm-pricing README)             |

**Issue:** `research-agent` depends on `infra-glm` (in package.json) but `infra-glm` README does not list `research-agent` in "Used By".

### 7.2 chat-agent

| Package in service package.json    | Documented in any package "Used By"? |
| ---------------------------------- | ------------------------------------ |
| `infra-glm`                        | Yes (infra-glm lists chat-agent)     |
| `internal-clients`                 | Yes                                  |
| `llm-factory`                      | Not in llm-factory "Used By"         |

**Issue:** `chat-agent` depends on `llm-factory` (in package.json) but `llm-factory` README lists only 10 apps and does include `chat-agent`. Actually, checking again: llm-factory "Used By" lists `chat-agent`. No issue.

### 7.3 commands-agent

| Package in service package.json    | Documented in infra-gemini "Used By"? |
| ---------------------------------- | ------------------------------------- |
| `infra-gemini`                     | Yes (infra-gemini lists commands-agent) |

### 7.4 image-service

| Package in service package.json    | Documented?                            |
| ---------------------------------- | -------------------------------------- |
| `llm-audit`                        | Yes (llm-audit lists image-service)    |
| `llm-factory`                      | Not in package.json, not expected      |
| `infra-gemini`                     | Yes (infra-gemini lists image-service) |
| `infra-gpt`                        | Yes (infra-gpt lists image-service)    |

**Issue:** `image-service` does NOT have `llm-factory` in package.json, and `llm-factory` README does not list it. However, `infra-gemini` README lists `image-service` in "Used By" which is correct since image-service has infra-gemini in its deps.

### 7.5 todos-agent

| Package in service package.json    | Documented in infra-glm "Used By"?    |
| ---------------------------------- | ------------------------------------- |
| `infra-glm`                        | Not listed. infra-glm lists `todos-agent`. Wait -- checking again: infra-glm README lists `todos-agent` in Used By. Correct. |
| `infra-gemini`                     | Yes (infra-gemini lists `todos-agent`) |

### 7.6 Missing service entries in "Used By" sections

| Package        | Service actually depends on it | Service NOT listed in "Used By" |
| -------------- | ----------------------------- | ------------------------------- |
| `infra-glm`    | `research-agent`              | `research-agent` missing        |

---

## 8. Summary of All Issues Found

### HIGH Priority (Documentation structure)

| # | Issue                                                                                                     | Affected Packages                                                           |
| - | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1 | No formal "Dependencies" table in README despite having 5 internal deps each                              | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` |
| 2 | No formal "Dependencies" section in README despite having `common-core` as a dependency                   | `infra-notion`, `infra-whatsapp`                                            |

### MEDIUM Priority (Count mismatches in "Used By")

| # | Issue                                                              | Affected Packages                     |
| - | ------------------------------------------------------------------ | ------------------------------------- |
| 3 | "Used By" count says 13 packages but 14 are actually listed       | `common-core`                         |
| 4 | "Used By" count says 7 packages but 10 are actually listed        | `llm-contract`                        |
| 5 | "Used By" count says 6 packages but 7 are actually listed         | `llm-pricing`                         |

### LOW Priority (Missing service in "Used By")

| # | Issue                                                              | Affected Packages |
| - | ------------------------------------------------------------------ | ----------------- |
| 6 | `research-agent` depends on `infra-glm` but not listed in Used By | `infra-glm`       |

### Positive Findings

- No circular dependencies exist in the package graph
- No phantom dependencies documented that do not exist in code
- All documented internal dependencies in formal "Dependencies" tables match actual package.json
- The `llm-audit` package (not in original checklist) is fully documented with accurate dependency information
- Packages that DO have formal Dependencies tables (`common-http`, `http-server`, `infra-pubsub`, `infra-sentry`, `llm-factory`, `llm-pricing`, `llm-prompts`, `llm-utils`, `internal-clients`, `llm-contract`, `llm-audit`) are accurate
- `http-contracts` correctly documents having no dependencies (and indeed has none)
- `common-core` correctly documents being a leaf package with no dependencies
