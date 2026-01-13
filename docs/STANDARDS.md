# Documentation Standards

**Effective:** 2026-01-13
**Status:** Enforced

---

## Zero Hallucination Policy (MANDATORY)

**RULE:** Every documentation claim must be traceable to actual source code.

**Prohibited:**
- ❌ Documenting "reasonable" features that don't exist
- ❌ Inferring endpoints from similar services
- ❌ Adding fields that "should be there"
- ❌ Describing planned features as implemented

**Required:**
- ✅ Only document what explicitly exists in source files
- ✅ Verify each claim against actual code
- ✅ When uncertain, mark as `[NEEDS VERIFICATION]` or omit
- ✅ Use code extraction tools, not imagination

---

## Documentation Files per Service

Every service MUST have these documentation files in `docs/services/<service>/`:

| File | Purpose | Required |
|------|---------|----------|
| `features.md` | User-facing features and use cases | Yes |
| `technical.md` | API endpoints, models, architecture | Yes |
| `tutorial.md` | Getting started guide | Yes |
| `technical-debt.md` | Known issues and future plans | Yes |
| `CLAUDE.md` | Agent memory context | Auto-generated |

---

## Accuracy Requirements

### 1. Endpoints

**Verification:** Extract from `apps/<service>/src/routes/*.ts`

```markdown
## ❌ WRONG - Inventing endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /todos/:id/cancel | Cancel a todo |

## ✅ RIGHT - From actual code
| Method | Path | Description |
|--------|------|-------------|
| PATCH | /todos/:id | Update todo (see schema for allowed fields) |
```

**Rules:**
- Only list endpoints that exist in route files
- Use exact HTTP methods from code
- Include exact path parameters
- Document auth requirements from route decorators

### 2. Domain Models

**Verification:** Extract from `apps/<service>/src/domain/models/*.ts`

```markdown
## ❌ WRONG - Guessing fields
interface Todo {
  id: string;
  title: string;
  tags: string[];  // ← Does not exist
  priority: 'low' | 'medium' | 'high';  // ← Does not exist
}

## ✅ RIGHT - From actual code
interface Todo {
  id: string;
  userId: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}
```

**Rules:**
- Field names must match exactly
- Types must match (enums, not strings pretending to be enums)
- Optional fields marked with `?`
- Required fields in `required` array

### 3. Dependencies

**Verification:** Extract from `apps/<service>/services.ts`

```markdown
## ❌ WRONG - Assuming dependencies
Depends on: calendar-service (for reminders)

## ✅ RIGHT - From imports
Depends on: research-agent, user-service, bookmarks-agent
```

### 4. Environment Variables

**Verification:** Extract from `apps/<service>/config.ts` or Terraform

```markdown
## ❌ WRONG - Making up env vars
INTEXURAOS_AI_MODEL - Selected AI model

## ✅ RIGHT - From config
INTEXURAOS_RESEARCH_AGENT_URL - Research agent base URL (required)
INTEXURAOS_INTERNAL_AUTH_TOKEN - Service-to-service auth (required)
```

---

## Documentation Generation Process

When generating documentation:

1. **Extract First** - Parse source files to get facts
2. **Generate Second** - Write docs from extracted data only
3. **Verify Third** - Run tests comparing docs to code
4. **Review Fourth** - Human review before committing

```bash
# Proposed workflow
pnpm run extract:docs <service>    # Extract facts from code
pnpm run generate:docs <service>   # Generate from extraction
pnpm run verify:docs <service>     # Test accuracy
```

---

## CI Enforcement

Documentation verification is part of CI:

```bash
# Runs on all PRs
pnpm run verify:docs

# Fails if:
# - Documented endpoints don't exist in routes
# - Documented models have wrong fields
# - Documented dependencies not in services.ts
# - Missing required doc files
```

---

## Change Lockstep

When modifying service code:

1. Update code
2. Update affected documentation immediately
3. Run `pnpm run verify:docs`
4. Commit both together

**Exception:** Pure refactorings that don't change contracts may skip doc updates.

---

## Review Requirements

Documentation changes require the same review process as code changes:

- PR must include doc changes
- Reviewer checks `pnpm run verify:docs` passes
- Major doc changes require explicit approval

---

## Common Mistakes (LEARN FROM AUDIT)

| Mistake | Example | Fix |
|---------|---------|-----|
| Documenting planned features | Auto-execution based on confidence | Mark as "Planned" or remove |
| Wrong field names | `name` instead of `purpose` | Verify from model file |
| Wrong HTTP methods | `PUT` instead of `PATCH` | Check route definition |
| Inventing endpoints | `/todos/:id/cancel` | Only document existing routes |
| Wrong enum values | `priority: low/medium/high` | Use actual enum values |
| Missing fields | Forgot `provider` field | Compare with code |

---

## Templates

See `docs/services/_templates/` for starting points:

- `features.md.template` - Feature documentation structure
- `technical.md.template` - Technical reference structure
- `tutorial.md.template` - Tutorial structure
- `technical-debt.md.template` - Debt tracking structure

---

## Audit History

| Date | Services Audited | Avg Accuracy | Issues Found |
|------|------------------|--------------|--------------|
| 2026-01-13 | 17 services | 87% | 38 major issues |

**Full audit log:** `.claude/doc-audit-log.md`
