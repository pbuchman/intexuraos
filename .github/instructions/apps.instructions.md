---
applyTo: 'apps/**'
---

# Apps — Path-Specific Instructions

Applies to: `/apps` (e.g., auth-service, notion-gpt-service, whatsapp-service, api-docs-hub)

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

## Mandatory Requirements for All Services

### 1. OpenAPI Specification (REQUIRED)

**Every service MUST expose an OpenAPI specification.** This is non-negotiable.

Required setup:

- Install `@fastify/swagger`, `@fastify/swagger-ui`, and `@fastify/cors`
- Register swagger plugin with service metadata
- Expose `/openapi.json` endpoint
- Expose `/docs` endpoint for Swagger UI
- Enable CORS for cross-origin OpenAPI access (api-docs-hub)

Example setup (add to `buildServer()`):

```typescript
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';

// In buildServer():
await app.register(fastifyCors, { origin: true, methods: ['GET', 'HEAD', 'OPTIONS'] });
await app.register(fastifySwagger, buildOpenApiOptions());
await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

// Add /openapi.json endpoint
app.get('/openapi.json', { schema: { hide: true } }, async (_req, reply) => {
  const spec = app.swagger();
  return await reply.type('application/json').send(spec);
});
```

**Tests MUST include:**

- `GET /docs` returns Swagger UI (200 or 302)
- `GET /openapi.json` returns valid OpenAPI spec

### 2. Terraform Configuration (REQUIRED)

**Every service MUST have corresponding Terraform configuration.** This is non-negotiable.

Required in `terraform/environments/dev/main.tf`:

1. Add service to `locals.services` block
2. Create Cloud Run module instance (`module.<service_name>`)
3. Add service account in IAM module
4. Add OpenAPI URL to api-docs-hub `env_vars`

Required in `apps/api-docs-hub/src/config.ts`:

- Add environment variable to `REQUIRED_ENV_VARS` array

Violations (FORBIDDEN):

- ❌ Creating a service without `/openapi.json` endpoint
- ❌ Creating a service without Swagger UI at `/docs`
- ❌ Creating a service without Terraform module
- ❌ Creating a service not included in api-docs-hub
- ❌ Missing CORS configuration for OpenAPI endpoints

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
- [ ] **OpenAPI exposed at `/openapi.json`** ← **MANDATORY**
- [ ] **Swagger UI available at `/docs`** ← **MANDATORY**
- [ ] **CORS enabled for OpenAPI access** ← **MANDATORY**
- [ ] **Service included in api-docs-hub config** ← **MANDATORY**
- [ ] **Terraform module exists for the service** ← **MANDATORY**
- [ ] **`npm run ci` passes** ← **MANDATORY**

**When adding a NEW service:**

- [ ] All checklist items above
- [ ] Dockerfile created with correct workspace dependencies
- [ ] Service added to `terraform/environments/dev/main.tf`
- [ ] Service account created in IAM module
- [ ] OpenAPI URL added to api-docs-hub Terraform config
- [ ] Environment variable added to `apps/api-docs-hub/src/config.ts`

**Additional requirements inherited from global rules (see `.github/copilot-instructions.md`):**

- TypeScript correctness, zero warnings, explicit return types
- Testing requirements and coverage thresholds
- Code quality standards (no obvious comments, no magic strings)

**Verification is not optional.**
