# Task 1-0: Create Verification Scripts

**Tier:** 1 (Independent Deliverable)
**Dependencies:** 0-0-setup (baseline validated)

## Context

Create 5 new verification scripts following the existing pattern in `scripts/verify-*.mjs`. These scripts will run in CI Phase 1 to catch architectural violations.

## Problem Statement

Need automated scripts to detect:

1. Test isolation violations (Docker, emulators, network calls)
2. Vitest config protection violations (threshold/exclusion changes)
3. Missing required endpoints (/openapi.json, /health, /docs)
4. Hash routing violations in web app
5. Hardcoded secrets in Terraform files

## Scope

**In Scope:**

- Create 5 new scripts in `/Users/p.buchman/personal/intexuraos/scripts/`
- Follow existing verify-\*.mjs pattern
- Include helpful error messages with remediation
- Make scripts executable

**Out of Scope:**

- Package.json updates (separate task)
- CI integration (separate task)
- Running the scripts (testing task)

## Required Approach

Use the existing pattern from verify-firestore-ownership.mjs:

1. Shebang: `#!/usr/bin/env node`
2. Doc comment explaining purpose and algorithm
3. Use `import.meta.dirname` for repo root
4. Exit 0 on success, 1 on failure
5. Provide actionable error messages with file:line

## Step Checklist

- [ ] Create `scripts/verify-test-isolation.mjs`
  - Scan test files for Docker, emulator, network call patterns
  - Strip comments/strings to avoid false positives
  - Report violations with line numbers
- [ ] Create `scripts/verify-vitest-config.mjs`
  - Parse vitest.config.ts
  - Extract thresholds and exclusion count
  - Verify thresholds ≥ 95, exclusions ≤ 15
- [ ] Create `scripts/verify-required-endpoints.mjs`
  - Get all apps (exclude api-docs-hub, web)
  - Check server.ts for /openapi.json, /health, /docs
  - Report missing endpoints
- [ ] Create `scripts/verify-hash-routing.mjs`
  - Read apps/web/src/App.tsx
  - Check for HashRouter import and usage
  - Block BrowserRouter detection
- [ ] Create `scripts/verify-terraform-secrets.mjs`
  - Scan .tf and .tfvars files
  - Check for secret patterns (API keys, tokens, private keys)
  - Allow var., data., module., google_secret_manager_secret
- [ ] Create `scripts/install-hooks.mjs` (optional)
  - Write pre-commit hook to .git/hooks/pre-commit
  - Block vitest.config.ts staging
  - Make executable (chmod 755)
- [ ] Update CONTINUITY.md ledger with completion

## Definition of Done

- All 6 script files created in `/Users/p.buchman/personal/intexuraos/scripts/`
- Each script has proper shebang and documentation
- Each script uses `import.meta.dirname` for repo root
- All scripts follow existing pattern (exit codes, error format)
- Ledger updated with "Done" status

## Verification Commands

```bash
ls -la scripts/verify-test-isolation.mjs
ls -la scripts/verify-vitest-config.mjs
ls -la scripts/verify-required-endpoints.mjs
ls -la scripts/verify-hash-routing.mjs
ls -la scripts/verify-terraform-secrets.mjs
ls -la scripts/install-hooks.mjs
```

Expected: All files exist with ~40-120 lines each

## Rollback Plan

If script creation fails:

1. Delete any partially created scripts
2. Document failure in ledger
3. Do not proceed to next task

---

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 1-1-eslint-rules.md without waiting for user input.
