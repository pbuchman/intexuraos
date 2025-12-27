# 2-3: Update Documentation

## Tier

2 (Dependent)

## Context

Documentation must reflect the new service.

## Problem Statement

Need to update:

- Main README.md
- Architecture docs
- Setup guides
- API contracts doc

## Scope

- docs/README.md (if exists)
- docs/architecture/ updates
- Any relevant setup guides

## Non-Scope

- Code changes

## Required Approach

1. Review existing documentation structure
2. Add mobile-notifications-service entries
3. Document API endpoints
4. Document webhook payload format

## Documentation Content

### Service Overview

- Purpose: Capture mobile device notifications via Tasker
- Authentication: JWT for user endpoints, signature for webhook
- Storage: Firestore with user ownership

### API Endpoints

- POST /v1/mobile-notifications/connect
- POST /v1/webhooks/mobile-notifications
- GET /v1/mobile-notifications
- DELETE /v1/mobile-notifications/:id

### Webhook Payload Format

```json
{
  "source": "tasker",
  "device": "device-name",
  "timestamp": 1234567890,
  "notification_id": "unique-id",
  "post_time": "post-time-string",
  "app": "package.name",
  "title": "Notification Title",
  "text": "Notification content"
}
```

## Step Checklist

- [ ] Update README.md if service list exists
- [ ] Add/update architecture documentation
- [ ] Document API endpoints
- [ ] Document Tasker integration setup

## Definition of Done

- Documentation complete and accurate
- Markdown formatted correctly

## Verification Commands

```bash
npm run format:check
```

## Rollback Plan

Revert documentation changes
