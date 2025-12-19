---
applyTo: 'terraform/**'
---

# Terraform — Path-Specific Instructions

Applies to: `/terraform`

---

## Architecture

### Module Organization

- Reusable modules in `/terraform/modules/`.
- Environment-specific configs in `/terraform/environments/`.

### Conventions

- Use descriptive resource names.
- Tag all resources appropriately.
- Document non-obvious configurations.
- **No secrets in version control.**

### Parameterization

**Forbidden:**

- Hard-coded secrets
- Hard-coded regions (unless truly constant)
- Hard-coded project IDs

**Required:**

- Use variables for environment-specific values.
- Use locals for computed values.
- Use data sources for dynamic lookups.

---

## Required Validations

**Before any Terraform change is complete:**

### 1. Format Check

```bash
terraform fmt -check -recursive
```

Fix with: `terraform fmt -recursive`

### 2. Validation

```bash
terraform validate
```

Must pass with zero errors.

### 3. Plan (if environment access available)

```bash
terraform plan -out=plan.tfplan
```

Review plan output before any apply.

---

## File Structure Standards

```
terraform/
├── main.tf           # Root module
├── variables.tf      # Input variables
├── outputs.tf        # Output values
├── versions.tf       # Provider versions
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── variables.tf
│   └── prod/ (if applicable)
└── modules/
    └── <module-name>/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

---

## Change Process

1. **Plan before apply** — always.
2. **Document infrastructure changes** in commit messages.
3. **Coordinate with application changes** when needed.
4. **Review plan diffs** for unexpected changes.

---

## Quality Rules

- Every variable must have:
  - Description
  - Type constraint
  - Default (if appropriate)
  - Validation (if applicable)

- Every output must have:
  - Description
  - Sensitive flag (if applicable)

- Resource naming:
  - Follow existing patterns
  - Include environment indicator
  - Be descriptive

---

## Verification Commands

Run from `/terraform`:

```bash
# Format check
terraform fmt -check -recursive

# Auto-fix formatting
terraform fmt -recursive

# Validate configuration
terraform validate
```

For environment-specific:

```bash
cd environments/dev
terraform init -backend=false
terraform validate
terraform plan
```

---

## Task Completion Checklist

**When you finish a task in `/terraform`, verify:**

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] No hard-coded secrets
- [ ] No hard-coded regions/project IDs (unless constant)
- [ ] Variables have descriptions and types
- [ ] Outputs have descriptions
- [ ] `terraform plan` reviewed (if environment access available)
- [ ] Changes documented in commit message
- [ ] **`npm run ci` passes** ← **MANDATORY** (for any related app/package changes)

**Additional requirements inherited from global rules (see `.github/copilot-instructions.md`):**

- Code quality standards apply to any scripts or automation
- Documentation standards

**Verification is not optional.**
