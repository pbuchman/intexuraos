# Package Dependency Documentation Validation

**Generated:** 2026-03-16 (v3 — Full Refresh)
**Scope:** All package directories in `packages/`, cross-validated against `docs/architecture/package-contracts.md`.
**Previous version:** v2 (2026-02-19)

---

## Summary

| Check                                     | Result | Details                                                                   |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Actual package count vs documented count  | FAIL   | Docs claim 22 packages; 21 active packages exist (`infra-glm` deleted)    |
| Ghost package directory — `infra-glm`     | FAIL   | Directory exists with only `node_modules`; no `package.json` or `src/`    |
| `common-http` leaf contract               | FAIL   | Documented as leaf (no deps); actually depends on `@intexuraos/llm-utils` |
| `http-contracts` categorization           | INFO   | Truly a leaf; omitted from "Common Packages (leaf)" table in docs         |
| `llm-factory` dependency matrix (prev v2) | FAIL   | v2 listed `infra-glm` as a dep; `package.json` has never had it           |
| Circular dependencies                     | PASS   | No cycles in @intexuraos/\* graph                                         |
| Version pinning — @intexuraos deps        | PASS   | All use `workspace:*`                                                     |
| `infra-*` as external service wrappers    | PASS   | All 10 active `infra-*` packages wrap external SDKs only                  |
| `common-core` is a true leaf              | PASS   | No `@intexuraos/*` dependencies                                           |
| `http-contracts` is a true leaf           | PASS   | No `@intexuraos/*` dependencies                                           |
| `llm-contract` is a true leaf             | PASS   | Only depends on `common-core`                                             |

**Open discrepancies: 4** (F1 ghost package, F2 wrong count, F3 common-http leaf violation, F4 v2 matrix error)

---

## Active Package Inventory

21 packages have a `package.json`. 1 directory (`infra-glm`) has only `node_modules` and no source.

| Package                        | Has `package.json` | Status        |
| ------------------------------ | ------------------ | ------------- |
| `common-core`                  | Yes                | Active        |
| `common-http`                  | Yes                | Active        |
| `http-contracts`               | Yes                | Active        |
| `http-server`                  | Yes                | Active        |
| `infra-claude`                 | Yes                | Active        |
| `infra-firestore`              | Yes                | Active        |
| `infra-gemini`                 | Yes                | Active        |
| `infra-glm`                    | **No**             | **GHOST**     |
| `infra-gpt`                    | Yes                | Active        |
| `infra-notion`                 | Yes                | Active        |
| `infra-otel`                   | Yes                | Active        |
| `infra-perplexity`             | Yes                | Active        |
| `infra-pubsub`                 | Yes                | Active        |
| `infra-sentry`                 | Yes                | Active        |
| `infra-whatsapp`               | Yes                | Active        |
| `internal-clients`             | Yes                | Active        |
| `llm-audit`                    | Yes                | Active        |
| `llm-contract`                 | Yes                | Active        |
| `llm-factory`                  | Yes                | Active        |
| `llm-pricing`                  | Yes                | Active        |
| `llm-prompts`                  | Yes                | Active        |
| `llm-utils`                    | Yes                | Active        |

---

## Dependency Matrix — Package-to-Package (v3, from actual `package.json`)

All `@intexuraos/*` direct dependencies as read from each package's `package.json`. Changes from v2 are marked.

| Package            | Depends On (@intexuraos/\*)                                               | Changed from v2?         |
| ------------------ | ------------------------------------------------------------------------- | ------------------------ |
| `common-core`      | _(none — leaf)_                                                           | No                       |
| `common-http`      | `common-core`, `llm-utils`                                                | No                       |
| `http-contracts`   | _(none — leaf)_                                                           | No                       |
| `http-server`      | `common-core`, `common-http`, `infra-firestore`                           | No                       |
| `infra-claude`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`  | No                       |
| `infra-firestore`  | `common-core`                                                             | No                       |
| `infra-gemini`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`  | No                       |
| `infra-glm`        | **DELETED** — no `package.json`                                           | **Yes (deleted)**        |
| `infra-gpt`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`  | No                       |
| `infra-notion`     | `common-core`                                                             | No                       |
| `infra-otel`       | _(none — standalone OTel wrapper, no @intexuraos/\* deps)_                | No                       |
| `infra-perplexity` | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`  | No                       |
| `infra-pubsub`     | `common-core`                                                             | No                       |
| `infra-sentry`     | `common-core`                                                             | No                       |
| `infra-whatsapp`   | `common-core`                                                             | No                       |
| `internal-clients` | `common-core`, `llm-contract`, `llm-factory`, `llm-pricing`               | No                       |
| `llm-audit`        | `common-core`, `infra-firestore`, `llm-contract`                          | No                       |
| `llm-contract`     | `common-core`                                                             | No                       |
| `llm-factory`      | `common-core`, `llm-audit`, `infra-gemini`, `llm-contract`, `llm-pricing` | **Yes** (no `infra-glm`) |
| `llm-pricing`      | `common-core`, `infra-firestore`, `llm-contract`                          | No                       |
| `llm-prompts`      | `common-core`, `llm-contract`, `llm-utils`                                | No                       |
| `llm-utils`        | `common-core`                                                             | No                       |

---

## Circular Dependency Check

Full transitive trace of all dependency chains (based on actual `package.json` data):

- `llm-factory` → `infra-gemini` → `llm-audit`, `llm-pricing`, `llm-prompts` → (leaf deps only) PASS
- `llm-factory` → `llm-audit` → `infra-firestore` → `common-core` PASS
- `llm-factory` → `llm-pricing` → `infra-firestore` → `common-core` PASS
- `internal-clients` → `llm-factory` → (no back-edge to `internal-clients`) PASS
- `common-http` → `llm-utils` → `common-core` PASS
- `http-server` → `infra-firestore` → `common-core` PASS
- `http-server` → `common-http` → `llm-utils` → `common-core` PASS

**Result: No circular dependencies found.**

Notable transitive chains:
- `llm-factory` transitively depends on `infra-firestore` (via `llm-audit` and `llm-pricing`) even though it doesn't list it directly.
- Any app using `http-server` transitively pulls in `infra-firestore` and `llm-utils`.
- `common-http` → `llm-utils` means any consumer of `common-http` transitively pulls in `llm-utils`.

---

## Contract Verification: Common Packages as Leaf Packages

The docs define `common-core` and `common-http` as **leaf packages with no internal deps**.

### `common-core` — PASS

`package.json` has no `dependencies` field. Confirmed leaf.

### `common-http` — FAIL (F3)

`package.json` lists:

```json
"dependencies": {
  "@intexuraos/common-core": "workspace:*",
  "@intexuraos/llm-utils": "workspace:*",
  ...
}
```

The dependency on `@intexuraos/llm-utils` violates the documented "leaf package" contract. The docs at `docs/architecture/package-contracts.md` state:

> **Dependencies:** None (leaf packages).

`common-http` is not a leaf — it is a mid-level utility package. The contract docs need to be updated to either:
1. Remove the leaf claim for `common-http` and document its actual dependency on `llm-utils`, or
2. Move the `llm-utils`-dependent functionality out of `common-http` to restore leaf status.

### `http-contracts` — INFO

`package.json` has no `dependencies` field. Confirmed true leaf. However, the docs catalog groups it under "### Common Packages (leaf)" only for `common-core` and `common-http`, and separately lists `http-contracts` under "### Server & Transport" without the "leaf" label. The absence of a leaf label is slightly misleading — `http-contracts` is in practice also a leaf — but this is a documentation clarity issue, not an accuracy error.

---

## Contract Verification: infra-* as External Service Wrappers

Checked all 10 active `infra-*` packages. Each wraps exactly one external SDK with no domain logic:

| Package            | External SDK                                   | Internal @intexuraos deps     | Wrapper contract |
| ------------------ | ---------------------------------------------- | ----------------------------- | ---------------- |
| `infra-claude`     | `@anthropic-ai/sdk`                            | `common-core`, llm-\* support | PASS             |
| `infra-firestore`  | `@google-cloud/firestore`                      | `common-core`                 | PASS             |
| `infra-gemini`     | `@google/genai`                                | `common-core`, llm-\* support | PASS             |
| `infra-gpt`        | `openai`                                       | `common-core`, llm-\* support | PASS             |
| `infra-notion`     | `@notionhq/client`                             | `common-core`                 | PASS             |
| `infra-otel`       | `@opentelemetry/*` (11 packages)               | _(none)_                      | PASS             |
| `infra-perplexity` | _(HTTP-based, no SDK — uses `nock` for tests)_ | `common-core`, llm-\* support | PASS             |
| `infra-pubsub`     | `@google-cloud/pubsub`                         | `common-core`                 | PASS             |
| `infra-sentry`     | `@sentry/node`, `pino-opentelemetry-transport` | `common-core`                 | PASS             |
| `infra-whatsapp`   | _(HTTP-based, no third-party SDK)_             | `common-core`                 | PASS             |

Note: The four LLM adapter packages (`infra-claude`, `infra-gemini`, `infra-gpt`, `infra-perplexity`) also depend on `llm-prompts`, `llm-audit`, `llm-contract`, and `llm-pricing`. These are LLM-layer support packages, not domain logic, so the wrapper contract is satisfied.

---

## Discrepancies Found

### F1 — `infra-glm` is a ghost package (NEW — not in v2)

**Severity: HIGH**

`packages/infra-glm/` exists as a directory containing only `node_modules` (a leftover from `pnpm install`). There is no `package.json` and no `src/` directory.

**Evidence:**
- `git log -- packages/infra-glm/package.json` shows the last commit touching this file is `93aeac4a3` ("feat: remove ZAI provider and GLM-4.7 models, finalize GLM-5"), which deleted it.
- `ls packages/infra-glm/` returns only `node_modules`.
- The commit message explicitly states: "Deleted infra-glm package (GLM now via DashScope in code-task subsystem)".

**Impact:**
- `docs/architecture/package-contracts.md` still lists `@intexuraos/infra-glm` in the Package Catalog table.
- The package count claim ("22 packages") is wrong — there are 21 active packages.
- The v2 validation report's dependency matrix lists `infra-glm` as having deps and as being a consumer of `llm-audit`, `llm-pricing`, etc.
- The ghost directory may cause confusion during `pnpm install` or workspace commands.

**Fix:**
1. Remove `packages/infra-glm/` directory entirely (or run `pnpm install` to let pnpm clean it).
2. Update `docs/architecture/package-contracts.md`: remove `infra-glm` from the Package Catalog table, change "22 packages" to "21 packages".

---

### F2 — Package count in `package-contracts.md` is wrong (NEW)

**Severity: MEDIUM**

`docs/architecture/package-contracts.md` line 30 states: "The monorepo contains 22 packages."

**Evidence:** Only 21 directories in `packages/` have a `package.json`. `infra-glm` was deleted in v3.3.0.

**Fix:** Change "22 packages" to "21 packages" and remove `infra-glm` from the catalog table.

---

### F3 — `common-http` documented as leaf but has `llm-utils` dependency (pre-existing, not noted in v2)

**Severity: MEDIUM**

`docs/architecture/package-contracts.md` states under "packages/common-core and packages/common-http":

> **Dependencies:** None (leaf packages).

**Evidence:** `packages/common-http/package.json` contains:
```json
"@intexuraos/llm-utils": "workspace:*"
```

This has been present since at least v2 (the v2 matrix correctly listed it), yet the contract doc still claims `common-http` is a no-dependency leaf.

**Impact:** Any consumer of `common-http` transitively depends on `llm-utils` and `pino`/`zod`. The Import Rules table in the docs also shows `packages/common-http` can import `@intexuraos/common-core` — omitting `llm-utils`.

**Fix:** Update the contract doc section for `common-http` to document `llm-utils` as an allowed dependency, and remove the blanket "Dependencies: None (leaf packages)" claim for `common-http`.

---

### F4 — v2 `package-deps-validation.md` matrix listed `infra-glm` as `llm-factory` dependency (CORRECTED in v3)

**Severity: LOW** (v2 report error, corrected here)

The v2 dependency matrix stated:
> `llm-factory` | `common-core`, `llm-audit`, `infra-gemini`, `infra-glm`, `llm-contract`, `llm-pricing`

**Evidence:** `packages/llm-factory/package.json` (both current HEAD and the v3.2.0 commit `93aeac4a3`) does not list `infra-glm`. `llm-factory` never depended on `infra-glm` — the v2 report contained a factual error.

**Fix:** This is corrected in the v3 matrix above. No action needed beyond noting the correction.

---

### D1 — `common-core` README: Package count label wrong (OPEN — carried from v2)

**Severity: HIGH**

`docs/packages/common-core/README.md` line 223 says `**Packages (13):**` but lists 19 packages.

**Fix:** Change `Packages (13)` → `Packages (19)`.

---

### D4 — `infra-otel` README: Phantom `infra-sentry` dependency claim (OPEN — carried from v2)

**Severity: MEDIUM**

`docs/packages/infra-otel/README.md` claims `@intexuraos/infra-sentry` imports `buildOtelConfig` and `getInstrumentations` from `infra-otel`. This is false — `infra-sentry/package.json` has no `infra-otel` dependency.

**Fix:** Remove both sentences making that claim from the `infra-otel` README.

---

## Open Items Summary

| ID  | Severity | Description                                                                 | File(s)                                                         |
| --- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| F1  | HIGH     | Ghost `infra-glm` directory; remove dir and update catalog                  | `packages/infra-glm/`, `docs/architecture/package-contracts.md` |
| F2  | MEDIUM   | Package count says 22, should be 21                                         | `docs/architecture/package-contracts.md`                        |
| F3  | MEDIUM   | `common-http` documented as leaf but depends on `llm-utils`                 | `docs/architecture/package-contracts.md`                        |
| D1  | HIGH     | `common-core` README "Used By Packages (13)" should be (19)                 | `docs/packages/common-core/README.md`                           |
| D4  | MEDIUM   | `infra-otel` README phantom claim that `infra-sentry` imports from it       | `docs/packages/infra-otel/README.md`                            |

**Total open: 5**

---

## Resolved Items (no action needed)

| ID  | Description                                                 | Status                   |
| --- | ----------------------------------------------------------- | ------------------------ |
| D2  | `llm-audit` README missing `llm-factory` in Used By         | FIXED in v2              |
| D3  | `llm-factory` README missing `llm-audit` in deps list       | FIXED in v2              |
| F4  | v2 matrix incorrectly listed `infra-glm` as llm-factory dep | CORRECTED in this report |

---

## v3 vs v2 Comparison

| Area                              | v2 Status                            | v3 Status                                               |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Package count                     | 22 (correct at time of v2)           | FAIL — still says 22, should be 21 (infra-glm deleted)  |
| Ghost `infra-glm` directory       | Not checked                          | NEW FAIL — directory exists with no package.json        |
| `common-http` leaf violation      | Not flagged (matrix was correct)     | NEW FAIL — contract doc wrong, not the matrix           |
| `llm-factory` dep on `infra-glm`  | Listed in matrix (incorrect)         | CORRECTED — `infra-glm` was never a dep                 |
| Circular dependencies             | PASS                                 | PASS (unchanged)                                        |
| D1 common-core count              | OPEN (13 vs 19)                      | OPEN (still unfixed)                                    |
| D4 phantom infra-sentry claim     | OPEN                                 | OPEN (still unfixed)                                    |
| Version pinning                   | PASS                                 | PASS (unchanged)                                        |
| Peer dependencies                 | PASS                                 | PASS (unchanged)                                        |
