# 2-0 Integration & Verification

Final integration steps and verification.

## Tasks

- [ ] Register in api-docs-hub config (placeholder URL initially)
- [ ] Update domain docs registry in `.claude/commands/create-domain-docs.md`
- [ ] Run `npm run ci` — must pass
- [ ] Run `terraform fmt -recursive && terraform validate` — must pass
- [ ] Run `npm run verify:firestore` — must pass
- [ ] Verify coverage meets 95% threshold

## Post-Deployment (after first deploy)

- [ ] Update api-docs-hub with actual Cloud Run URL
- [ ] Create service URL secret:
  ```bash
  SERVICE_URL=$(gcloud run services describe intexuraos-notes-service \
    --region=europe-central2 --format='value(status.url)')
  echo -n "$SERVICE_URL" | gcloud secrets create INTEXURAOS_NOTES_SERVICE_URL --data-file=-
  ```

## Checklist from /create-service

- [ ] OpenAPI spec at `/openapi.json`
- [ ] Swagger UI at `/docs`
- [ ] Health endpoint at `/health`
- [ ] CORS enabled
- [ ] Terraform module created
- [ ] Service account in IAM module
- [ ] CloudBuild trigger configured
- [ ] Registered in api-docs-hub
- [ ] Added to `.envrc.local.example`
- [ ] Added to root tsconfig.json
- [ ] Added to local dev setup (`scripts/dev.mjs`)
- [ ] Updated domain docs registry
