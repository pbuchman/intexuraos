# 1-0 Scaffold Service Structure

Create the basic service skeleton following `/create-service` checklist.

## Tasks

- [ ] Create `apps/notes-service/` directory structure
- [ ] Create `package.json` with dependencies
- [ ] Create `Dockerfile`
- [ ] Create `src/index.ts` entry point
- [ ] Create `src/config.ts` configuration
- [ ] Create `src/server.ts` Fastify setup
- [ ] Create `src/services.ts` DI container
- [ ] Add to root `tsconfig.json` references
- [ ] Verify basic structure compiles

## Dependencies

```
@intexuraos/common-core
@intexuraos/common-http
@intexuraos/http-contracts
@intexuraos/http-server
@intexuraos/infra-firestore
fastify
pino
zod
```
