# 2-3: Update Documentation

## Tier

2 (Dependent)

## Context

Documentation must reflect the new service.

## Problem Statement

Need to update:

- Main README.md (features list)
- Architecture docs
- Setup guides
- API contracts doc
- Create Xiaomi/Tasker setup guide

## Scope

- README.md - add to features list
- docs/setup/mobile-notifications-xiaomi.md - NEW file
- docs/architecture/ updates
- Any relevant setup guides

## Non-Scope

- Code changes

## Required Approach

1. Review existing documentation structure
2. Add mobile-notifications-service entries
3. Document API endpoints
4. Document webhook payload format
5. Create comprehensive Tasker/AutoNotification setup guide

## Documentation Content

### README.md Features Update

Add to features list:

- Mobile Notifications - Capture notifications from Android devices via Tasker

### New File: docs/setup/mobile-notifications-xiaomi.md

Complete setup guide for Xiaomi devices with HyperOS:

```markdown
# Tasker & AutoNotification Setup Documentation

**Device:** Redmi Note 13 Pro 5G  
**OS:** HyperOS (Android 14)  
**Goal:** Intercept notifications from specific apps and send them via HTTP POST to IntexuraOS.

---

## 1. System Configuration (HyperOS Optimization)

Xiaomi's HyperOS requires manual intervention to prevent the system from killing background processes.

### 1.1. Autostart & Permissions

1. Navigate to **Settings** → **Apps** → **Permissions** → **Background autostart**.
2. Enable the toggle for both **Tasker** and **AutoNotification**.
3. Inside the **Background autostart** menu, click on the app names and ensure **Background autostart** is enabled.

### 1.2. Battery Optimization

1. Go to **Settings** → **Apps** → **Manage apps**.
2. Locate **Tasker**, go to **Battery saver**, and select **No restrictions**.
3. Repeat this for **AutoNotification**.

### 1.3. Notification Access

1. Go to **Settings** → **Privacy** → **Special permissions** → **Notification access**.
2. Ensure **AutoNotification** is set to **Allowed**.

---

## 2. AutoNotification Intercept Configuration

1. **Create Profile:** Open Tasker → **Profiles** → **+** → **Event** → **Plugin** → **AutoNotification** → **Intercept**.
2. **Configuration:**
   - **Action Type:** Set to `Created`.
   - **Apps:** Select your desired apps (e.g., `Zen`, `Revolut`).
   - **Event Behaviour:** Enabled (True).

---

## 3. Tasker Task: HTTP POST Request

### 3.1. Action Setup

1. **Action:** `Net` → `HTTP Request`.
2. **Method:** `POST`.
3. **URL:** `https://YOUR_SERVICE_URL/v1/webhooks/mobile-notifications`
4. **Headers:**
   - `Content-Type: application/json`
   - `X-Mobile-Notifications-Signature: YOUR_SIGNATURE`

### 3.2. JSON Payload (Body)

{
"source": "tasker",
"device": "redmi-note-13-pro",
"timestamp": %TIMES,
"notification_id": "%ankey",
"post_time": "%anposttime",
"app": "%anpackage",
"title": "%antitle",
"text": "%antext"
}

**Variables:**

- `%ankey`: Unique system key for deduplication
- `%anposttime`: Millisecond timestamp when notification was posted
- `%TIMES`: Current Unix timestamp

---

## 4. Debugging & System Behavior

### 4.1. "No active profiles" Status

In the notification shade, Tasker may show "No active profiles". This is **normal** for Event-based profiles.

### 4.2. Variable Names

Ensure variables are written in **lowercase** (e.g., `%antitle`). Uppercase variables are treated as global.

### 4.3. Persistence

1. Open the Recent Apps view.
2. Long-press the Tasker card and click the **Lock icon**.
3. Always click the **Checkmark (V)** in the top right of the Tasker main screen after making changes.
```

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

- [ ] Update README.md features list with Mobile Notifications
- [ ] Create docs/setup/mobile-notifications-xiaomi.md
- [ ] Add reference from README to setup guide
- [ ] Update architecture documentation if exists
- [ ] Document API endpoints
- [ ] Document Tasker integration setup

## Definition of Done

- README features list updated
- Xiaomi setup guide created with full Tasker configuration
- Documentation complete and accurate
- Markdown formatted correctly

## Verification Commands

```bash
npm run format:check
```

## Rollback Plan

Revert documentation changes
