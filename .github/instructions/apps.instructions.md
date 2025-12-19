---
applyTo: 'apps/**'
---

# Apps — Path-Specific Instructions

Applies to: `/apps` (auth-service, notion-gpt-service)

---

## Architecture

### Service Organization

- Each app is a self-contained Fastify service.
- Routes organized logically by domain/feature.
- Proper error handling on every route.
- Consistent response format.

### Authentication

- Auth logic uses domain layer (packages/domain/identity).
- Token validation is centralized.
- Never expose sensitive data in responses.

### External Services

- Use infra layer adapters (packages/infra/\*).
- Apps orchestrate domain + infra, contain no business logic.
- Keep apps thin: delegate to domain and infra packages.

### Configuration

- Environment variables via `.env` (local) or Secret Manager (production).
- Use PRAXOS\_\* prefix for all secret names.
- No hard-coded credentials.

---

## Code Quality

### No Obvious Comments

- Comments explain **why**, not **what**.
- Do not add comments that restate the code.
- Delete worthless comments.

---

## TypeScript Rules

- Zero `tsc` errors.
- `any` forbidden without inline justification.
- Prefer explicit, narrow types.
- No `@ts-ignore` or `@ts-expect-error`.

---

## Testing Requirements

### What MUST Be Tested

- Route handlers (HTTP endpoints)
- Request validation
- Error handling
- Service orchestration logic
- Integration with domain/infra layers

### Coverage Targets

- **90%+ line coverage** for route handlers and service logic.
- Test all branches in conditional logic.
- Test edge cases: null, undefined, empty strings, malformed data.

### Test Quality

- Tests must fail on realistic regressions.
- Mock external services (Firestore, Auth0, Notion) properly.
- Do not mock away the system under test.

---

## Verification Commands

Run from repo root:

```bash
npm run lint          # Zero warnings required
npm run typecheck     # Zero errors required
npm run test          # All tests pass
npm run test:coverage # Review coverage
npm run ci            # Full CI suite
```

---

## Task Completion Checklist

**When you finish a task in `/apps`, verify:**

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] Logic changes have corresponding tests
- [ ] No `any` without documented justification
- [ ] No new ESLint or TS warnings
- [ ] Auth/validation changes have tests
- [ ] Route changes are minimal and focused
- [ ] Secrets use PRAXOS\_\* naming convention
- [ ] Apps remain thin (business logic in domain, integrations in infra)

**Verification is not optional.**
