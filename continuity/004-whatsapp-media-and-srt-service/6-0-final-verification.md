# 6-0: Final CI Verification and Terraform Apply

**Tier:** 6 (Final Verification)

**Depends on:** All previous tasks

---

## Context

Final verification before task completion. Must pass all CI checks and validate Terraform.

---

## Problem Statement

Ensure all code changes pass:
- TypeScript compilation
- Linting
- Tests with coverage
- Prettier formatting
- Terraform validation

---

## Scope

**In scope:**
- Run full CI
- Fix any issues found
- Terraform fmt and validate
- Verify no open issues

**Out of scope:**
- Terraform apply (requires manual approval)
- Production deployment

---

## Required Approach

1. Run npx prettier --write .
2. Run npm run ci
3. Run terraform fmt and validate
4. Fix any failures
5. Repeat until green

---

## Step Checklist

- [ ] Run npx prettier --write .
- [ ] Run npm run ci
- [ ] Verify all tests pass
- [ ] Verify coverage thresholds met
- [ ] cd terraform/environments/dev && terraform fmt -recursive
- [ ] terraform validate
- [ ] Fix any issues
- [ ] Re-run until all green
- [ ] Update CONTINUITY.md with final status

---

## Definition of Done

- npm run ci passes
- terraform fmt -check -recursive passes
- terraform validate passes
- No open issues

---

## Verification Commands

```bash
npx prettier --write .
npm run ci

cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate
```

---

## Rollback Plan

Address specific failures; revert if major issues found.

