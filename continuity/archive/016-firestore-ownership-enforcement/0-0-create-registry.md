# 0-0: Create Collection Registry

**Tier**: 0 (Foundation)

## Problem

Need single source of truth mapping all Firestore collections to their owning services.

## Scope

Create `firestore-collections.json` at repo root with all 10 current collections.

## Steps

- [ ] Create `firestore-collections.json` at repo root
- [ ] Add all 10 collections with owner and description:
  - notion_connections → notion-service
  - promptvault_settings → promptvault-service
  - whatsapp_messages → whatsapp-service
  - whatsapp_user_mappings → whatsapp-service
  - whatsapp_webhook_events → whatsapp-service
  - mobile_notifications → mobile-notifications-service
  - mobile_notification_signatures → mobile-notifications-service
  - user_settings → user-service
  - auth_tokens → user-service
  - researches → research-agent-service

## Definition of Done

- Registry file exists at repo root
- Contains all 10 collections
- Each collection has `owner` and `description` fields
- JSON is valid (can be parsed)

## Verification

```bash
cat firestore-collections.json | jq .
# Should parse successfully and show all 10 collections
```
