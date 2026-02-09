# Pre-Dev Lifecycle Worker - Tutorial

Managing the IntexuraOS cloud development environment.

## Prerequisites

- GCP project access with Cloud Functions and Compute Engine permissions
- `gcloud` CLI authenticated
- GitHub repository webhook configured to point at the webhook function URL
- `INTEXURAOS_GITHUB_WEBHOOK_SECRET` set in Secret Manager

## Part 1: Access the Pre-Dev Environment

Navigate to the pre-dev gateway URL in your browser. The URL follows this pattern:

```
https://intexuraos-predev-gateway-dev-<hash>.run.app
```

**If the VM is stopped:**

1. You see the "Starting Pre-Dev Environment" page with a spinner
2. The page polls `/internal/branch-lock` every 3 seconds
3. When the VM reports ready, the page reloads and shows the application

**If the VM is running:**

1. The gateway proxies your request directly to the VM
2. You see the IntexuraOS web application

## Part 2: Check Environment Status

Query the branch-lock endpoint to see the current state:

```bash
curl -s https://GATEWAY_URL/internal/branch-lock | jq
```

**Response:**

```json
{
  "locked": false,
  "branch": "development",
  "commitSha": "abc1234",
  "commitMessage": "Fix login redirect",
  "status": "running"
}
```

| Field           | Description                                    |
| --------------- | ---------------------------------------------- |
| `locked`        | Whether branch switching is locked             |
| `branch`        | Currently active branch on the VM              |
| `commitSha`     | Latest commit SHA tracked by the webhook       |
| `commitMessage` | First line of the latest commit message        |
| `status`        | VM state: stopped, starting, running, stopping |

## Part 3: Lock a Branch

During demos or reviews, lock the environment to prevent branch switches:

```bash
# Lock to current branch
curl -X POST https://GATEWAY_URL/internal/branch-lock \
  -H "Content-Type: application/json" \
  -d '{"locked": true}'

# Unlock
curl -X POST https://GATEWAY_URL/internal/branch-lock \
  -H "Content-Type: application/json" \
  -d '{"locked": false}'
```

While locked, pushes to other branches update Firestore metadata but do not trigger code updates on the VM.

## Part 4: Configure the GitHub Webhook

Set up the GitHub webhook to notify the pre-dev environment on pushes:

1. Go to your GitHub repository Settings > Webhooks
2. Add a new webhook:
   - **Payload URL:** `https://intexuraos-predev-webhook-dev-<hash>.run.app`
   - **Content type:** `application/json`
   - **Secret:** Same value as `INTEXURAOS_GITHUB_WEBHOOK_SECRET` in Secret Manager
   - **Events:** Select "Just the push event"

## Part 5: Monitor the Idle Check

The idle-check function runs every 5 minutes. To see its logs:

```bash
gcloud functions logs read intexuraos-predev-idle-check-dev \
  --region=europe-central2 \
  --limit=10
```

Key log messages:

| Message                               | Meaning                                |
| ------------------------------------- | -------------------------------------- |
| "VM not running, skipping idle check" | VM is already stopped                  |
| "Checking idle status"                | Comparing lastActivity against timeout |
| "VM still active"                     | Under 30 minutes idle, VM stays up     |
| "VM idle, stopping..."                | Exceeded 30 minutes, shutting down     |
| "VM stopped successfully"             | MIG resized to 0                       |

## Part 6: Local Development

Run individual functions locally:

```bash
cd workers/predev-lifecycle
pnpm dev
```

The functions framework serves all exported HTTP functions. Use environment variables to point at local or test resources:

```bash
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev \
INTEXURAOS_GCP_ZONE=europe-central2-a \
INTEXURAOS_MIG_NAME=predev-mig \
pnpm dev
```

## Troubleshooting

| Issue                                | Cause                                          | Solution                                                 |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------------------------- |
| "Starting..." page never redirects   | VM failed to boot or report-ready did not fire | Check VM serial console logs in GCP                      |
| "Failed to start VM" on gateway      | MIG resize failed                              | Check Compute Engine quotas and permissions              |
| Webhook returns 401                  | Signature mismatch                             | Verify webhook secret matches Secret Manager value       |
| Webhook returns 500                  | Missing `INTEXURAOS_GITHUB_WEBHOOK_SECRET`     | Check secret is deployed to the function                 |
| Branch does not switch despite push  | Branch is locked                               | Unlock via POST `/internal/branch-lock`                  |
| VM shuts down during active use      | `lastActivity` not updating                    | Verify gateway is receiving requests (not cached by CDN) |
| SSE streams drop after a few seconds | Network proxy timeout                          | Check Cloud Run request timeout (should be 3600s)        |
