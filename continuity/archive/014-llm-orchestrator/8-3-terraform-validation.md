# Task 8-3: Terraform Validation

**Tier:** 8 (Final verification task)

---

## Context Snapshot

- Terraform module created (7-0)
- Need to validate before archival
- This is the final verification step

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Validate Terraform configuration:

1. Formatting correct
2. Syntax valid
3. No errors

---

## Scope

**In scope:**

- Run terraform fmt
- Run terraform validate
- Fix any issues

**Non-scope:**

- Applying changes (done separately)

---

## Required Approach

### Step 1: Format check

```bash
cd terraform
terraform fmt -check -recursive
```

### Step 2: Format if needed

```bash
terraform fmt -recursive
```

### Step 3: Initialize

```bash
cd terraform/environments/dev
terraform init
```

### Step 4: Validate

```bash
terraform validate
```

### Step 5: Verify all passes

Both commands must pass without errors.

---

## Step Checklist

- [ ] Run `terraform fmt -check -recursive`
- [ ] Fix any formatting issues
- [ ] Run `terraform init` (if needed)
- [ ] Run `terraform validate`
- [ ] All checks pass

---

## Definition of Done

1. `terraform fmt -check -recursive` passes
2. `terraform validate` passes
3. No errors or warnings

---

## Verification Commands

```bash
cd terraform
terraform fmt -check -recursive
cd environments/dev
terraform init -backend=false
terraform validate
```

---

## Rollback Plan

If validation fails:

1. Review error messages
2. Fix Terraform configuration
3. Re-validate
