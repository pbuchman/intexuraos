# 3-1: Create Mobile Notifications Connection Page

## Tier

3 (Frontend)

## Context

Connection/setup page for mobile notifications at `#/mobile-notifications` (similar to WhatsApp connection page).

## Problem Statement

Need a connection page that allows users to:

- Generate a signature token (shown once with copy option)
- Regenerate signature when one already exists
- View connection status (last notification received time)

## Scope

- New connection page component
- Signature generation UI
- Status display
- Copy to clipboard functionality

## Non-Scope

- Backend changes (already done)
- Disconnect functionality (not needed - user just regenerates signature)
- Real-time updates

## Required Approach

Follow existing patterns from WhatsApp Connection page.

## UI Design

```
┌─────────────────────────────────────────────────────────┐
│ Mobile Notifications                                     │
│ Capture notifications from your Android device           │
├─────────────────────────────────────────────────────────┤
│ Connection Setup                                         │
│                                                          │
│ Generate a signature to authenticate your mobile device. │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ⚠️ Important: Save this signature now!               │ │
│ │                                                       │ │
│ │ This signature is only shown once.                   │ │
│ │                                                       │ │
│ │ ┌───────────────────────────────────────────┐ [📋] │ │
│ │ │ a1b2c3d4e5f6...                           │       │ │
│ │ └───────────────────────────────────────────┘       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ [Generate Signature] or [Regenerate Signature]           │
│                                                          │
│ Note: Regenerating will invalidate your current          │
│ signature.                                               │
├─────────────────────────────────────────────────────────┤
│ Connection Status                                        │
│                                                          │
│ Status:            Active / Not configured               │
│ Last Notification: 2 hours ago / No notifications yet    │
├─────────────────────────────────────────────────────────┤
│ Setup Instructions                                       │
│                                                          │
│ 1. Generate a signature (above)                          │
│ 2. Install Tasker & AutoNotification                     │
│ 3. Follow our detailed setup guide [link]                │
│                                                          │
│ 📱 Tested on Xiaomi devices with HyperOS                 │
└─────────────────────────────────────────────────────────┘
```

## Components to Create

1. `MobileNotificationsConnectionPage.tsx` - main page
2. Update `App.tsx` - add route
3. Update `Sidebar.tsx` - add menu item
4. API service `mobileNotificationsApi.ts`
5. Types in `types/index.ts`

## API Integration

```typescript
// Services to add
connectMobileNotifications(token, deviceLabel?) → { connectionId, signature }

// Types to add
interface MobileNotificationsConnectResponse {
  connectionId: string;
  signature: string;
}
```

## Step Checklist

- [ ] Add route `/mobile-notifications` to App.tsx
- [ ] Add menu item to Sidebar.tsx (Bell icon)
- [ ] Add config for `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL`
- [ ] Add types for MobileNotification and responses
- [ ] Create `mobileNotificationsApi.ts` service
- [ ] Create `MobileNotificationsConnectionPage.tsx`
- [ ] Implement signature generation button
- [ ] Implement copy to clipboard
- [ ] Implement status display
- [ ] Add setup instructions with link to docs
- [ ] Test UI manually

## Definition of Done

- Page accessible at `#/mobile-notifications`
- Can generate new signature
- Signature displayed once with copy button
- Can regenerate signature
- Status shows last notification time
- Setup instructions visible with doc link
- `npm run build` passes for web app

## Verification Commands

```bash
cd apps/web && npm run build
npm run typecheck
```

## Rollback Plan

Remove connection page component and route
