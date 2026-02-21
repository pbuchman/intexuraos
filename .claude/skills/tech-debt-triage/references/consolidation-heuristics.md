# Consolidation Heuristics

Rules for grouping individual tech debt items into consolidated Linear issues.

## Core Principle

If fixing one instance without fixing the others would leave the codebase inconsistent, the instances belong in a single consolidated issue.

## Grouping Patterns

### Pattern 1: Same Code Smell Across Services

**Signal:** Multiple `technical-debt.md` files report the same pattern or violation.

**Examples:**

- "Missing `logIncomingRequest()` at route entry" in 4 services → 1 issue: `[refactor] Add logIncomingRequest to all route entry points`
- "ESLint disabled at file level" in 3 route files → 1 issue: `[refactor] Remove blanket eslint-disable from route files`
- "Module-level mutable state" in 2 services → 1 issue: `[refactor] Replace module-level Maps with scoped state`

**How to detect:** Look for identical or near-identical section titles, code snippets, or remediation suggestions across different service debt files.

### Pattern 2: Client/Server Contract Mismatch

**Signal:** One debt file mentions an API producer issue and another mentions the corresponding consumer issue.

**Examples:**

- Service A's debt says "endpoint X returns inconsistent error format" + Service B's debt says "caller of endpoint X doesn't handle error cases" → 1 issue covering both
- Package debt says "type export missing optional field" + App debt says "consumer uses `as` cast to work around missing field" → 1 issue

**How to detect:** Cross-reference service names mentioned in "Impact" or "Remediation" sections. If service A's debt mentions service B (or a shared package), check service B's debt for the reciprocal issue.

### Pattern 3: Ghost Infrastructure

**Signal:** Multiple reports flag different symptoms of the same unused/partially-implemented feature.

**Examples:**

- Dead Pub/Sub publisher + unused Terraform topic + orphaned env var → 1 cleanup issue
- Partially-implemented feature with TODO in use case + missing route wiring + placeholder in tests → 1 issue to either complete or remove

**How to detect:** Look for TODO comments that reference the same feature name, phase number, or ticket ID across different services.

### Pattern 4: Duplicated Code Across Services

**Signal:** Multiple debt files flag identical code snippets or utility functions copied between services.

**Examples:**

- `generateWebhookSecret()` duplicated in 3 use cases → 1 issue: `[refactor] Extract shared webhook secret utility`
- Same Firestore timestamp serialization pattern in 4 services → 1 issue: `[refactor] Create shared timestamp serialization helper`

**How to detect:** Look for "DRY violation" or "Code Duplicates" sections that reference the same function name or pattern.

### Pattern 5: SRP Violations in Related Files

**Signal:** Large files that handle overlapping concerns could be split as part of a single refactoring effort.

**Examples:**

- `codeRoutes.ts` (3500 lines) and `webhookRoutes.ts` (both in same service, both with ESLint disabled) → 1 issue: `[refactor] Split code-agent route files by domain concern`

**How to detect:** Multiple debt items in the same service that share a remediation approach (e.g., "split into separate files").

## Items That Stay Standalone

NOT everything should be consolidated. Keep issues separate when:

- The debt is unique to a single service with no cross-cutting impact
- The remediation is self-contained (e.g., "bump dependency version in one package")
- Combining would make the issue too large for a single PR (aim for issues solvable in 1-2 hours)
- The issues are in completely different domains (e.g., a UI debt item and a Terraform debt item)

## Consolidation Limits

- **Max services per consolidated issue:** 6. Beyond that, split into regional groups. (Rationale: PRs touching >6 services are hard to review and risky to deploy atomically.)
- **Max categories per issue:** 2. Don't mix e.g., SRP violations with deprecation cleanups. (Rationale: mixed categories lead to unfocused PRs and harder rollbacks.)
- **Scope check:** If the consolidated issue would touch more than 15 files, consider splitting further. (Rationale: aligns with the "solvable in 1-2 hours" target from Standalone Items.)

## Output Format

Each consolidated issue should have:

```
Title: [refactor] <imperative description>
Severity: <highest severity among grouped items>
Affected: <service-1>, <service-2>, ...
Sources:
  - docs/services/<service-1>/technical-debt.md (Section: <heading>)
  - docs/services/<service-2>/technical-debt.md (Section: <heading>)
Scope: <2-3 sentences describing what needs to change, NOT how to fix it>
```
