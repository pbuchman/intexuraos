# 1-3 Web UI Connection Page

**Tier:** 1 (Independent Deliverable)

## Context

Users need a settings page to connect/disconnect their Google Calendar. This follows the pattern established by NotionConnectionPage.tsx.

## Problem Statement

The web app needs:

1. A Google Calendar connection page in Settings
2. OAuth flow initiation (redirect to Google)
3. Status display (connected/disconnected)
4. Disconnect functionality
5. Sidebar navigation link

## Scope

**In scope:**

- GoogleCalendarConnectionPage.tsx component
- googleCalendarApi.ts service functions
- Route configuration in App.tsx
- Sidebar navigation update
- Type definitions

**Not in scope:**

- Backend OAuth implementation (user-service task)
- Calendar event display (future feature)
- Terraform/deployment (Tier 2)

## Required Approach

1. Study NotionConnectionPage.tsx pattern
2. Create API service with typed functions
3. Create connection page component
4. Add route and sidebar navigation
5. Add type definitions

## Step Checklist

### Types

- [ ] Add GoogleCalendarStatus interface to `apps/web/src/types/index.ts`

### API Service

- [ ] Create `apps/web/src/services/googleCalendarApi.ts`
  - [ ] getGoogleCalendarStatus()
  - [ ] initiateGoogleCalendarOAuth()
  - [ ] disconnectGoogleCalendar()

### Component

- [ ] Create `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`
  - [ ] Status display (connected email, scopes)
  - [ ] Connect button (redirects to OAuth)
  - [ ] Disconnect button with confirmation
  - [ ] Loading states
  - [ ] Error handling
  - [ ] Success messages

### Navigation

- [ ] Update `apps/web/src/components/Sidebar.tsx`
  - [ ] Add Calendar icon import from lucide-react
  - [ ] Add settings item for Google Calendar

### Routing

- [ ] Update `apps/web/src/App.tsx`
  - [ ] Import GoogleCalendarConnectionPage
  - [ ] Add route `/settings/google-calendar`

### Verification

- [ ] Run `npm run ci`

## Definition of Done

- [ ] GoogleCalendarConnectionPage displays connection status
- [ ] OAuth flow can be initiated (redirects to Google)
- [ ] Disconnect works with confirmation
- [ ] Sidebar shows Google Calendar link in Settings
- [ ] Route `/settings/google-calendar` works
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run typecheck -w @intexuraos/web
npm run ci
```

## Rollback Plan

1. Revert changes to `apps/web/`
2. No infrastructure changes to roll back

## Critical Files Reference

| Purpose                 | File                                          |
| ----------------------- | --------------------------------------------- |
| Connection page pattern | `apps/web/src/pages/NotionConnectionPage.tsx` |
| API service pattern     | `apps/web/src/services/notionApi.ts`          |
| Sidebar                 | `apps/web/src/components/Sidebar.tsx`         |
| App routes              | `apps/web/src/App.tsx`                        |

## Type Definition

```typescript
export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  createdAt: string | null;
  updatedAt: string | null;
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
