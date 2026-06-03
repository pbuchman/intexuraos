# Linear Integration Setup

This guide covers setting up the Linear integration for IntexuraOS, including webhook configuration for real-time issue synchronization.

## Prerequisites

- [ ] IntexuraOS deployed to the dev or production PM2 environment
- [ ] Linear account with admin access to configure webhooks
- [ ] Linear API key for the user ([generate here](https://linear.app/settings/api))

## Overview

The Linear integration has two parts:

| Component              | Purpose                           | Configuration Level |
| ---------------------- | --------------------------------- | ------------------- |
| **API Connection**     | Create/read issues via Linear API | Per-user            |
| **Webhook (incoming)** | Real-time sync when issues change | Per-organization    |

## Part 1: User API Connection

Each user connects their Linear account through the IntexuraOS web app:

1. Navigate to **Settings** → **Integrations** → **Linear**
2. Enter your Linear API key (starts with `lin_api_`)
3. Select your team from the dropdown
4. Click **Connect**

The API key is stored encrypted in Firestore and used for:

- Creating issues from voice commands
- Fetching issues for the dashboard
- Updating issue status

## Part 2: Webhook Configuration

Webhooks enable real-time synchronization when issues are created, updated, or deleted in Linear.

### Step 2.1: Get Your Webhook URL

| Environment | Webhook URL                                      |
| ----------- | ------------------------------------------------ |
| Production  | `https://intexuraos.cloud/api/linear/webhooks`   |
| Dev         | `https://dev.intexuraos.cloud/api/linear/webhooks` |

> **Note:** Linear requires an HTTPS public URL. For one-off tunnel testing, use a tunnel service like ngrok:
>
> ```bash
> ngrok http 8126
> # Use the generated https URL + /webhooks
> ```

### Step 2.2: Configure Webhook in Linear

1. Go to [Linear Settings](https://linear.app/settings) → **API** → **Webhooks**
2. Click **New webhook**
3. Fill in the form:

| Field              | Value                                          |
| ------------------ | ---------------------------------------------- |
| **Label**          | `IntexuraOS` (or your preferred name)          |
| **URL**            | `https://intexuraos.cloud/api/linear/webhooks` |
| **Signing secret** | Linear auto-generates this (starts with `lin_wh_...`) |
| **Team selection** | Select the team to receive webhooks for        |

4. Under **Data change events**, select:
   - [x] **Issues** (required)
   - [ ] Comments (optional - for future features)

5. Click **Create webhook**

6. **Copy the signing secret** shown in the webhook details (you'll need it for Step 2.3)

### Step 2.3: Configure Webhook Secret in IntexuraOS

Each user stores their webhook secret in IntexuraOS (not in GCP Secret Manager):

1. Navigate to **IntexuraOS Web App** → **Settings** → **Integrations** → **Linear**
2. In the **Webhook Configuration** section:
   - Paste the signing secret you copied from Linear (starts with `lin_wh_...`)
   - Click **Save**

The secret is stored encrypted in Firestore alongside your Linear connection.

> **Why per-user?** Each Linear organization has its own webhook secret. This enables multi-tenant support where different users can connect different Linear workspaces.

## Verification

### Test Webhook Delivery

1. In Linear, create a test issue in the connected team
2. Check linear-agent logs for the webhook receipt:

```bash
pm2 logs linear-agent --lines 50
```

3. Look for log entries like:
   - `"Incoming request: POST /linear/webhooks"` - Webhook received
   - `"Issue synced from webhook"` - Successfully processed

### Common Issues

| Symptom                          | Cause                                  | Solution                                            |
| -------------------------------- | -------------------------------------- | --------------------------------------------------- |
| 401 Unauthorized                 | Signature mismatch                     | Verify secret matches in both Linear and IntexuraOS |
| 404 Not Found                    | Wrong webhook URL                      | Check URL path is `/api/linear/webhooks`            |
| 500 Internal Error               | Service configuration issue            | Check linear-agent logs for details                 |
| Webhook not firing               | Wrong team selected                    | Verify team selection in Linear webhook config      |
| "Team not connected" in logs     | No user connected to this Linear team  | User must complete Part 1 first                     |
| "Webhook not configured" in logs | User hasn't saved their webhook secret | User must complete Step 2.3                         |

## Webhook Event Flow

```
Linear Issue Changed
        │
        ▼
┌───────────────────┐
│  Linear Webhook   │
│  POST /linear/webhooks
│  + Linear-Signature header
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Signature Check   │──── Invalid ──▶ 401 Unauthorized
└─────────┬─────────┘
          │ Valid
          ▼
┌───────────────────┐
│ Find User by Team │──── Not Found ──▶ 200 OK (logged)
└─────────┬─────────┘
          │ Found
          ▼
┌───────────────────┐
│ Sync Issue to     │
│ Firestore         │
└─────────┬─────────┘
          │
          ▼
     200 OK + action
```

## Security Considerations

- **HMAC-SHA256 Validation**: All webhooks are validated using timing-safe signature comparison
- **Secret Storage**: Webhook secrets are encrypted at rest in Firestore
- **Secret Rotation**: When rotating secrets, update both Linear webhook settings and IntexuraOS settings
- **Replay Protection**: Consider implementing timestamp validation (webhookTimestamp within 60 seconds)

## Architecture Notes

### Per-User Webhook Secrets

Each user's webhook secret is stored in Firestore alongside their Linear connection:

```
linearConnections/{userId}
├── apiKey: "lin_api_..."      (encrypted)
├── teamId: "team-uuid"
├── teamName: "Engineering"
├── webhookSecret: "lin_wh_..." (encrypted)  ← per-user
├── connected: true
├── createdAt: "..."
└── updatedAt: "..."
```

This design enables:

- **Multi-tenant support**: Different users can connect different Linear workspaces
- **Isolation**: Each organization's webhook secret is independent
- **Self-service**: Users configure their own secrets without admin involvement

## Related Documentation

- [Linear Webhooks Developer Docs](https://linear.app/developers/webhooks)
- [Linear Agent Technical Reference](../services/linear-agent/technical.md)
- [Linear Agent Tutorial](../services/linear-agent/tutorial.md)

---

**Last updated:** 2026-02-02
