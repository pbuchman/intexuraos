# 2-2: Deployment Preparation

**Tier**: 2 (Dependent/Integrative)
**Dependencies**: All previous tasks

## Context

Prepare environment configuration and Terraform for deployment. Final task before archival.

## Problem

Need to ensure:

1. Environment variables configured
2. Terraform changes validated
3. Deployment checklist prepared
4. All success criteria met

## Scope

**In Scope:**

- Update Terraform configuration for env vars
- Validate Terraform syntax
- Create deployment checklist
- Final verification of all changes
- Archive task folder

**Out of Scope:**

- Actual deployment to GCP (manual step)
- Production rollout

## Approach

1. Update Terraform for NOTION_SERVICE_URL
2. Validate all Terraform changes
3. Create deployment checklist
4. Verify all success criteria
5. Archive to continuity/archive/

## Steps

- [ ] Update `terraform/environments/dev/main.tf`
  - Add `NOTION_SERVICE_URL` env var to promptvault-service module
  - Ensure both services have `INTERNAL_AUTH_TOKEN`
- [ ] Run `terraform fmt -recursive`
- [ ] Run `terraform fmt -check -recursive && terraform validate`
- [ ] Create deployment checklist below
- [ ] Verify all success criteria met
- [ ] Archive folder to `continuity/archive/015-firestore-ownership-separation/`

## Definition of Done

- Terraform valid and formatted
- All environment variables configured
- Deployment checklist complete
- All success criteria verified
- Task folder archived

## Success Criteria Verification

**Technical:**

- [ ] `npm run ci` passes
- [ ] `terraform fmt -check -recursive && terraform validate` passes
- [ ] Only notion-service has direct access to `notion_connections`
- [ ] Only promptvault-service has direct access to `promptvault_settings`
- [ ] promptvault-service uses `/internal/notion/users/:userId/context`
- [ ] Internal endpoint protected by `X-Internal-Auth`
- [ ] All prompt operations work

**Architecture:**

- [ ] `notion_connections` contains: userId, notionToken, connected, timestamps (NO promptVaultPageId)
- [ ] `promptvault_settings` contains: userId, promptVaultPageId, timestamps
- [ ] Internal endpoints use `/internal/{service-prefix}/{resource-path}`
- [ ] Convention documented in `.claude/CLAUDE.md` and `docs/architecture/`

**Performance:**

- [ ] No degradation (getUserContext uses parallel fetching)

## Deployment Checklist

```bash
# 1. Verify all tests pass
npm run ci

# 2. Verify Terraform
cd terraform
terraform fmt -check -recursive
terraform validate

# 3. Deploy notion-service
# (Manual: deploy via GCP console or CI/CD)

# 4. Deploy promptvault-service
# (Manual: deploy via GCP console or CI/CD)

# 5. Set environment variables
# NOTION_SERVICE_URL=https://notion-service-xyz.run.app
# INTERNAL_AUTH_TOKEN=(from Secret Manager)

# 6. Verify health endpoints
curl https://notion-service-xyz.run.app/health
curl https://promptvault-service-xyz.run.app/health

# 7. Test end-to-end
# Create and retrieve a prompt via promptvault-service API
```

## Verification

```bash
# Everything should pass
npm run ci
cd terraform && terraform fmt -check -recursive && terraform validate
```

## Rollback

If deployment fails:

```bash
# Revert to previous service versions
# Environment variables can remain (harmless)
```

## Archival

After success criteria verified:

```bash
mv continuity/015-firestore-ownership-separation continuity/archive/
```

---

**FINAL TASK** - No continuation directive. This marks the end of the task series.
