---
applyTo: 'apps/**'
---

# Apps Instructions

**Verification:** `npm run ci` + service-specific checks below.

---

## Requirements

| Requirement                     | Verification                                           |
| ------------------------------- | ------------------------------------------------------ |
| OpenAPI spec at `/openapi.json` | `curl http://localhost:PORT/openapi.json` returns JSON |
| Swagger UI at `/docs`           | `curl http://localhost:PORT/docs` returns 200/302      |
| CORS enabled                    | OpenAPI accessible from api-docs-hub                   |
| Terraform module exists         | Check `terraform/environments/dev/main.tf`             |
| Included in api-docs-hub        | Check `apps/api-docs-hub/src/config.ts`                |
| Health endpoint                 | `GET /health` returns 200                              |

**Exception:** api-docs-hub is exempt from `/openapi.json` (it aggregates other specs).

---

## Architecture

- Apps contain domain logic in `src/domain/**` and app-specific adapters in `src/infra/**`
- Apps depend on `@intexuraos/common` only (no cross-app imports)
- Structure: `src/domain/` (business logic) → `src/infra/` (adapters) → `src/routes/v1/` (transport)
- Routes live under `src/routes/<version>/` (e.g., `src/routes/v1/`)
- Auth uses colocated `src/domain/identity` (in auth-service)
- External services via colocated `src/infra/*` adapters (Firestore, Notion, Auth0)
- Secrets: `INTEXURAOS_*` prefix, via env vars or Secret Manager

---

## New Service Checklist

- [ ] Dockerfile with correct workspace deps
- [ ] Terraform module in `terraform/environments/dev/main.tf`
- [ ] Service account in IAM module
- [ ] OpenAPI URL in api-docs-hub config
- [ ] `npm run ci` passes
