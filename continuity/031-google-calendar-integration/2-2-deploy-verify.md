# 2-2 Deploy and Verify

**Tier:** 2 (Dependent/Integrative) — **FINAL TASK**

## Context

All code is implemented, Terraform is configured, and local integration testing passed. Now we deploy to the dev environment and verify.

## Problem Statement

Deploy all changes to the dev environment:

1. Push Docker images for modified services
2. Apply Terraform changes
3. Verify health endpoints
4. Test OAuth flow in production
5. Create calendar event via WhatsApp

## Scope

**In scope:**

- Docker image builds and pushes
- Terraform apply
- Health endpoint verification
- End-to-end production testing
- Continuity archival

**Not in scope:**

- Production deployment (dev only)
- Monitoring setup
- Documentation updates

## Required Approach

1. Build and push Docker images
2. Apply Terraform changes
3. Verify health endpoints for all affected services
4. Test OAuth connection in web app
5. Test calendar event creation via WhatsApp
6. Archive continuity directory

## Step Checklist

### Build and Push Images

- [ ] Build user-service image
- [ ] Build calendar-agent image
- [ ] Build actions-agent image
- [ ] Push images to Artifact Registry

### Terraform Deployment

- [ ] Run `tf apply` in terraform/environments/dev/
- [ ] Verify no errors in apply output
- [ ] Note new service URLs

### Health Verification

- [ ] Verify user-service /health responds 200
- [ ] Verify calendar-agent /health responds 200
- [ ] Verify actions-agent /health responds 200

### OAuth Flow Testing

- [ ] Open web app → Settings → Google Calendar
- [ ] Click "Connect Google Calendar"
- [ ] Complete Google OAuth consent
- [ ] Verify "Connected" status shows with email

### Calendar Action Testing

- [ ] Send WhatsApp message: "Schedule meeting tomorrow at 3pm"
- [ ] Verify action appears in UI with status `awaiting_approval`
- [ ] Click "Approve" in UI
- [ ] Verify calendar event created in Google Calendar
- [ ] Verify action status is `completed`
- [ ] Verify WhatsApp notification received with calendar link

### Archival

- [ ] Move continuity/031-google-calendar-integration/ to continuity/archive/
- [ ] Verify all ledger entries are complete
- [ ] Mark task as completed

## Definition of Done

- [ ] All services deployed and healthy
- [ ] OAuth connection works in production
- [ ] Calendar event created via WhatsApp command
- [ ] Continuity archived to `continuity/archive/031-google-calendar-integration/`

## Verification Commands

```bash
# Build and push (from repo root)
./scripts/push-missing-images.sh

# Or manually:
docker build -t europe-central2-docker.pkg.dev/<project>/intexuraos/intexuraos-user-service:latest apps/user-service
docker build -t europe-central2-docker.pkg.dev/<project>/intexuraos/intexuraos-calendar-agent:latest apps/calendar-agent
docker push europe-central2-docker.pkg.dev/<project>/intexuraos/intexuraos-user-service:latest
docker push europe-central2-docker.pkg.dev/<project>/intexuraos/intexuraos-calendar-agent:latest

# Terraform
cd terraform/environments/dev
tf apply

# Get service URLs
tf output -json | jq '.service_urls.value'

# Verify health
curl -f https://<user-service-url>/health
curl -f https://<calendar-agent-url>/health
curl -f https://<actions-agent-url>/health
```

## Rollback Plan

1. Revert Docker images to previous versions
2. `tf apply` with reverted code
3. Verify services return to previous state

## Archival Command

```bash
mv continuity/031-google-calendar-integration continuity/archive/
```

---

**NOTE:** This is the FINAL task. Do NOT include continuation directive.
