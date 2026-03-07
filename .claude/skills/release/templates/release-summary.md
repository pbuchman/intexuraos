# Release Summary Template

Use this template to display the final summary after Phase 6 completes.

---

## Format

````markdown
# Release Summary: vX.Y.Z

## Tag Created

- **Version:** vX.Y.Z
- **Tag pushed to:** origin/vX.Y.Z
- **Tagged on:** `main` (merge commit)
- **Commit:** [short SHA]

## GitHub Release

- **URL:** https://github.com/pbuchman/intexuraos/releases/tag/vX.Y.Z
- **Release notes:** Categorized with highlights, features, fixes, and infrastructure changes
- **Target branch:** `main`

## Services Documented

| Service         | Status  |
| --------------- | ------- |
| actions-agent   | Updated |
| bookmarks-agent | Updated |
| research-agent  | Skipped |

## Files Changed

### Documentation

- `docs/overview.md` — [Approved | Skipped]
- `README.md` — [Approved | Skipped]

### Service Docs

- `docs/services/actions-agent/*.md` — 5 files
- `docs/services/bookmarks-agent/*.md` — 5 files

### Website

- `apps/web/src/components/RecentUpdatesSection.tsx` — [Updated | Skipped]
- `apps/web/src/pages/HomePage.tsx` — [Updated | Skipped]

## Website Suggestions Implemented

| #   | Suggestion                      | Status      |
| --- | ------------------------------- | ----------- |
| 1   | Update RecentUpdatesSection     | Implemented |
| 2   | Update hero statistics          | Implemented |
| 3   | Add approval flow visualization | Skipped     |

## RAG Embeddings

- **Status:** [Refreshed | Skipped | Failed]
- **Chunks uploaded:** [N]
- **Collection:** `doc_embeddings` (production Firestore)

## Post-Release Validation

| Check                      | Result |
| -------------------------- | ------ |
| Tag points to `main`       | PASS   |
| GitHub Release exists      | PASS   |
| CHANGELOG contains version | PASS   |
| All package.json versions  | PASS   |
| Current branch             | PASS   |

## CI Status

- **Final CI run:** PASSED
- **Coverage:** 95.2%
- **Tests:** 847 passed

## Next Steps

```bash
# View the GitHub Release
open https://github.com/pbuchman/intexuraos/releases/tag/vX.Y.Z

# Deploy is handled automatically by CI/CD on push to main
```
````

---

Release complete.

````

---

## Field Descriptions

### Tag Created

| Field      | Source                                          |
| ---------- | ----------------------------------------------- |
| Version    | From Phase 1 version calculation                |
| Tag pushed | After `git push origin v{version}`              |
| Tagged on  | Always `main` — tag points to merge commit      |
| Commit     | From `git rev-parse --short origin/main`        |

### Services Documented

| Status    | Meaning                                      |
| --------- | -------------------------------------------- |
| Updated   | service-scribe agent completed successfully  |
| Skipped   | Service not modified in this release         |
| Failed    | service-scribe agent encountered error       |

### Files Changed

For each documentation section:

| Status    | Meaning                          |
| --------- | -------------------------------- |
| Updated   | Auto-generated from priority map |
| Skipped   | No High-priority items           |
| Failed    | Auto-generation encountered error|

### Website Suggestions

Website updates auto-implemented from High-priority features:

| Status      | Meaning                              |
| ----------- | ------------------------------------ |
| Implemented | frontend-design skill completed      |
| Skipped     | No High-priority features to showcase|
| Failed      | Implementation encountered error     |

### Post-Release Validation

| Check                      | What It Verifies                                                    |
| -------------------------- | ------------------------------------------------------------------- |
| Tag points to `main`       | Tag's dereferenced commit exists on `origin/main`                   |
| GitHub Release exists      | `gh release view` returns valid release data                        |
| CHANGELOG contains version | `grep` finds `## X.Y.Z` in CHANGELOG.md                            |
| All package.json versions  | Root + all apps/packages/workers package.json match new version     |
| Current branch             | Working tree is on `development` (not stuck on `main`)              |

### CI Status

| Field    | Source                                    |
| -------- | ----------------------------------------- |
| Final CI | Result of `pnpm run ci:tracked`           |
| Coverage | From CI output, e.g., "95.2%"             |
| Tests    | Count of passing tests from CI output     |

---

## Minimal Summary (All Skipped)

If user skips all optional phases:

```markdown
# Release Summary: vX.Y.Z

## Tag Created

- **Version:** vX.Y.Z
- **Tag pushed to:** origin/vX.Y.Z
- **Tagged on:** `main`
- **Commit:** abc1234

## GitHub Release

- **URL:** https://github.com/pbuchman/intexuraos/releases/tag/vX.Y.Z

## Documentation

All documentation updates were skipped by user request.

## Post-Release Validation

All 5 checks PASSED.

## CI Status

- **Final CI run:** PASSED

## Next Steps

```bash
# View the GitHub Release
open https://github.com/pbuchman/intexuraos/releases/tag/vX.Y.Z
````

---

Release complete.

````

---

## Error Summary

If release fails:

```markdown
# Release Failed: vX.Y.Z

## Failure Point

- **Phase:** 6 (Finalize)
- **Step:** CI Gate
- **Error:** TypeScript compilation failed

## Error Details

````

apps/research-agent/src/services.ts:42:5
error TS2345: Argument of type 'string' is not assignable...

```

## Recovery

1. Fix the error shown above
2. Run `pnpm run ci:tracked` to verify
3. Run `/release --phase 6` to resume

---

Release incomplete. Manual intervention required.
```
