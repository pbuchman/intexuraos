---
mode: 'agent'
description: 'Session start prompt - use before any task'
---

# Session Start

**You MUST read and apply these instruction files:**

- `.github/copilot-instructions.md` — global rules
- `.github/instructions/apps.instructions.md` — if working in `apps/`
- `.github/instructions/packages.instructions.md` — if working in `packages/`
- `.github/instructions/terraform.instructions.md` — if working in `terraform/`

THIS IS NON-NEGOTIABLE REQUIREMENT.
You must confirm you have read and understood these instructions before proceeding.

**After any code change:**

```bash
npm run ci
```

**If terraform changed:**

```bash
cd terraform && terraform fmt -check -recursive && terraform validate
```

**YOU MUST NOT claim task complete until all verification passes.**

---

## Task

Show the confirmation that you have read and understood the above instructions.
Next await further tasks.
