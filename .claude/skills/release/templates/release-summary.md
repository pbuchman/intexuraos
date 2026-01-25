# Release Summary Template

Use this template to display the final summary after Phase 6 completes.

---

## Format

````markdown
# Release Summary: vX.Y.Z

## Tag Created

- **Version:** vX.Y.Z
- **Tag pushed to:** origin/vX.Y.Z
- **Commit:** [short SHA]

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

## CI Status

- **Final CI run:** PASSED
- **Coverage:** 95.2%
- **Tests:** 847 passed

## Next Steps

```bash
# Create GitHub release (optional)
gh release create vX.Y.Z --generate-notes

# View release on GitHub
open https://github.com/pbuchman/intexuraos/releases/tag/vX.Y.Z

# Deploy to production
./scripts/deploy-production.sh
```
````

---

Release complete.

````

---

## Field Descriptions

### Tag Created

| Field       | Source                                |
| ----------- | ------------------------------------- |
| Version     | From Phase 1 version calculation      |
| Tag pushed  | After `git push origin v{version}`    |
| Commit      | From `git rev-parse --short HEAD`     |

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
| Approved  | User approved at checkpoint      |
| Skipped   | User chose to skip               |
| Revised   | User provided feedback, re-done  |

### Website Suggestions

For each of the 3 suggestions:

| Status      | Meaning                              |
| ----------- | ------------------------------------ |
| Implemented | frontend-design skill completed      |
| Skipped     | User did not select this suggestion  |
| Failed      | Implementation encountered error     |

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
- **Commit:** abc1234

## Documentation

All documentation updates were skipped by user request.

## CI Status

- **Final CI run:** PASSED

## Next Steps

```bash
gh release create vX.Y.Z --generate-notes
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
