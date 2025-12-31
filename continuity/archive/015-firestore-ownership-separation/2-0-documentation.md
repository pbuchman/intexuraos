# 2-0: Documentation

**Tier**: 2 (Dependent/Integrative)
**Dependencies**: 1-0, 1-1, 1-2

## Context

Document the service-to-service communication pattern and internal endpoint naming convention for future reference.

## Problem

New pattern needs to be documented so:

1. Future developers understand the convention
2. Claude Code can enforce it in future tasks
3. Architecture decisions are preserved

## Scope

**In Scope:**

- Create `docs/architecture/service-to-service-communication.md`
- Update `.claude/CLAUDE.md` with internal endpoint convention
- Document all existing internal endpoints
- Provide examples and best practices

**Out of Scope:**

- Code changes (already done in Tier 1)
- Terraform changes (handled in 2-2)

## Approach

1. Create comprehensive architecture doc
2. Update Claude instructions with convention
3. Include examples from user-service and notion-service

## Steps

- [ ] Create `docs/architecture/service-to-service-communication.md`
  - Explain `/internal/{service-prefix}/{resource-path}` pattern
  - Document authentication with `X-Internal-Auth`
  - List all current internal endpoints
  - Provide implementation examples (validateInternalAuth, client creation)
  - Best practices (error handling, no cache vs cache, security)
- [ ] Update `.claude/CLAUDE.md`
  - Add section "Service-to-Service Communication"
  - Table of service prefixes (notion, user, promptvault, whatsapp)
  - Link to architecture doc
  - Enforcement rules

## Definition of Done

- Architecture doc created and comprehensive
- CLAUDE.md updated with convention
- Examples provided for both server and client side
- Convention is clear and enforceable

## Verification

```bash
# Files should exist
test -f docs/architecture/service-to-service-communication.md

# CLAUDE.md should mention the pattern
grep "/internal/{service-prefix}" .claude/CLAUDE.md
```

## Rollback

```bash
git checkout docs/ .claude/
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
