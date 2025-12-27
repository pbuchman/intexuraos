# 3-0: Create Web View

## Tier

3 (Frontend)

## Context

Web UI for viewing and managing mobile notifications.

## Problem Statement

Need a new view at `#/mobile-notifications` that:

- Lists notifications for current user
- Displays notifications in Android-style card format
- Supports pagination (load more)
- Allows deletion with confirmation

## Scope

- New route in web app
- Notification list component
- Individual notification card component
- Delete confirmation modal
- API integration

## Non-Scope

- Backend changes (done)
- Real-time updates

## Required Approach

Follow existing patterns from WhatsApp Notes view.

## UI Design (Android-inspired)

```
┌─────────────────────────────────────────┐
│ [device] [app] [source]           1m ago│
│ ─────────────────────────────────────── │
│ Notification Title                    🗑│
│ Notification content text here...       │
└─────────────────────────────────────────┘
```

- Tags: device, app, source (pill badges)
- Timestamp: relative time (1m ago, 2h ago)
- Title: bold header
- Text: body content
- Delete: trash icon with confirmation

## Components to Create

1. `MobileNotificationsPage.tsx` - main page
2. `NotificationCard.tsx` - individual notification
3. `NotificationList.tsx` - list with load more
4. API hooks in `api/mobileNotifications.ts`

## Step Checklist

- [ ] Add route to router
- [ ] Add menu item under WhatsApp Notes
- [ ] Create MobileNotificationsPage component
- [ ] Create NotificationCard component
- [ ] Create NotificationList component
- [ ] Implement API hooks
- [ ] Add delete confirmation modal
- [ ] Implement pagination (load more button)
- [ ] Style in Android notification style
- [ ] Test UI manually

## Definition of Done

- View accessible at #/mobile-notifications
- Notifications displayed correctly
- Delete works with confirmation
- Pagination works
- UI matches Android notification style
- `npm run build` passes for web app

## Verification Commands

```bash
cd apps/web && npm run build
npm run typecheck
```

## Rollback Plan

Remove web view components and route
