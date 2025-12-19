---
applyTo: 'apps/**'
---

# Apps — Path-Specific Instructions

Applies to: `/apps` (e.g., auth-service, notion-gpt-service, api-docs-hub)

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

## Verification Commands

Run from repo root:

```bash
npm run lint          # Zero warnings required
npm run typecheck     # Zero errors required
npm run test          # All tests pass
npm run test:coverage # Review coverage
npm run ci            # Full CI suite (MANDATORY before task completion)
```

---

## Task Completion Checklist

**When you finish a task in `/apps`, verify:**

- [ ] Logic changes have corresponding tests
- [ ] Auth/validation changes have tests
- [ ] Route changes are minimal and focused
- [ ] Secrets use PRAXOS\_\* naming convention
- [ ] Apps remain thin (business logic in domain, integrations in infra)
- [ ] **`npm run ci` passes** ← **MANDATORY**

**Additional requirements inherited from global rules (see `.github/copilot-instructions.md`):**

- TypeScript correctness, zero warnings, explicit return types
- Testing requirements and coverage thresholds
- Code quality standards (no obvious comments, no magic strings)

**Verification is not optional.**
