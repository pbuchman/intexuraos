# Linear Agent Tutorial

This tutorial guides you through integrating Linear issue creation with IntexuraOS using natural language input.

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS running locally (`pnpm run dev`)
- [ ] A valid Auth0 access token
- [ ] Linear account with API key
- [ ] Linear team ID (from your Linear workspace)

## Part 1: Connect to Linear

### Step 1.1: Validate Your API Key

First, validate your Linear API key and retrieve available teams.

```bash
curl -X POST http://localhost:3000/linear/connection/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "lin_api_YOUR_KEY_HERE"}'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "teams": [
      { "id": "team-uuid-123", "name": "Engineering" },
      { "id": "team-uuid-456", "name": "Product" }
    ]
  }
}
```

### Step 1.2: Save the Connection

Save your Linear connection with your preferred team.

```bash
curl -X POST http://localhost:3000/linear/connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN" \
  -d '{
    "apiKey": "lin_api_YOUR_KEY_HERE",
    "teamId": "team-uuid-123",
    "teamName": "Engineering"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "teamName": "Engineering",
    "createdAt": "2026-01-19T10:00:00.000Z"
  }
}
```

### Step 1.3: Verify Connection Status

Check your current connection status.

```bash
curl http://localhost:3000/linear/connection \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "teamName": "Engineering",
    "createdAt": "2026-01-19T10:00:00.000Z"
  }
}
```

## Part 2: Create Issues via Natural Language

Issues are created through the internal API when actions-agent routes a `linear` action type.

### Step 2.1: Trigger via Actions Agent (Typical Flow)

In normal operation, you would send a message like:

> "Create a Linear issue for implementing user authentication with OAuth support. This is high priority and needs to handle Google and GitHub providers."

The commands-agent classifies this as a `linear` action, and actions-agent routes it to linear-agent.

### Step 2.2: Direct Internal API Call (Testing)

For testing, you can call the internal endpoint directly.

```bash
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "action-123",
      "userId": "user-456",
      "text": "Create issue for implementing OAuth login with Google and GitHub providers. High priority."
    }
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Created Linear issue: Implement OAuth login with Google and GitHub providers",
    "resourceUrl": "https://linear.app/team/issue/ENG-123"
  }
}
```

### What the AI Extracts

The extraction service uses Gemini 2.5 Flash or GLM-4.7 to parse:

| Field                    | Description                              | Example                                     |
| ------------------------ | ---------------------------------------- | ------------------------------------------- |
| **Title**                | Concise issue title                      | "Implement OAuth login"                     |
| **Priority**             | 0-4 scale (0=none, 1=urgent, 4=low)      | 2 (high)                                    |
| **Functional Requirements** | What the feature should do            | "Support Google and GitHub providers"       |
| **Technical Details**    | Implementation hints                     | "Use passport.js for OAuth flow"            |

## Part 3: Handle Errors

### Error: Not Connected

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Linear not connected. Please connect your Linear account first."
  }
}
```

**Solution:** Complete Part 1 to connect your Linear account.

### Error: Invalid API Key

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid Linear API key"
  }
}
```

**Solution:** Regenerate your API key in Linear Settings > Account > API.

### Error: Extraction Failed

If AI extraction fails, the issue is saved to `failedIssues` collection for manual review.

```bash
curl http://localhost:3000/linear/failed-issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "failedIssues": [
      {
        "id": "failed-123",
        "actionId": "action-456",
        "originalText": "Fix the bug",
        "extractedTitle": null,
        "error": "Could not extract meaningful issue details",
        "createdAt": "2026-01-19T10:30:00.000Z"
      }
    ]
  }
}
```

## Part 4: Real-World Scenario

### Voice-to-Issue Pipeline

1. **User speaks** into WhatsApp: "Hey, I need a Linear issue for the authentication bug where users can't log in after token expires. This is urgent."

2. **WhatsApp service** receives and transcribes the message.

3. **Commands agent** classifies intent as `linear` action type.

4. **Actions agent** creates action and publishes to `action-created` topic.

5. **Linear agent** processes the action:
   - Extracts: Title="Fix authentication token expiration bug", Priority=1 (urgent)
   - Creates issue in Linear with structured description
   - Returns success with Linear issue URL

6. **User receives** push notification with link to the new issue.

## Troubleshooting

| Symptom                        | Likely Cause                           | Solution                                    |
| ------------------------------ | -------------------------------------- | ------------------------------------------- |
| "Linear not connected"         | No saved connection for user           | POST `/linear/connection` with credentials  |
| "Invalid API key"              | Expired or revoked key                 | Generate new key in Linear settings         |
| Issue created with wrong team  | Wrong teamId in connection             | DELETE then POST new connection             |
| Extraction returns null title  | Input too vague                        | Provide more specific issue description     |
| 429 Rate Limit                 | Too many Linear API calls              | Wait and retry, or upgrade Linear plan      |

## Exercises

### Easy

1. Connect your Linear account using the validation and connection endpoints.
2. Verify your connection status returns the correct team name.

### Medium

3. Create 3 different issues with varying priority levels (urgent, high, normal).
4. Intentionally send vague text ("fix bug") and observe how it's saved to failed issues.

### Hard

5. Set up the full pipeline: Send a WhatsApp message and trace it through to Linear issue creation.
6. Implement a retry mechanism for failed extractions using the `/linear/failed-issues` endpoint.

## Next Steps

- [Technical Reference](technical.md) - API endpoints and architecture
- [Actions Agent Tutorial](../actions-agent/tutorial.md) - Understand action routing
- [Commands Agent Tutorial](../commands-agent/tutorial.md) - Learn intent classification
