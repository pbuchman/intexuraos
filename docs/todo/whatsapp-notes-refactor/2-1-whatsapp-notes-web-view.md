# 2-1 WhatsApp Notes Web View

**Tier:** 2 (Dependent)  
**Status:** Pending  
**Depends on:** 2-0 (API endpoints)

## Context Snapshot

Web app currently has:
- Dashboard page
- Notion connection page
- WhatsApp connection page

Need new tab/page: WhatsApp Notes — displays messages sent by user via WhatsApp.

## Problem Statement

Create a new view in the web app to display user's WhatsApp messages:
- New navigation tab: "WhatsApp Notes"
- List messages sorted newest first
- Show: date, text content
- Header: display "from" phone number

## Scope

**In scope:**
- New route `/whatsapp-notes`
- New page component `WhatsAppNotesPage.tsx`
- Navigation update (new tab)
- API service function to fetch messages
- Message list UI
- Loading state
- Error state
- Empty state

**Out of scope:**
- Delete button (task 2-2)
- Pagination
- Search/filter

## Required Approach

### Route

Add to `App.tsx`:
===
<Route
  path="/whatsapp-notes"
  element={
    <ProtectedRoute>
      <WhatsAppNotesPage />
    </ProtectedRoute>
  }
/>
===

### Navigation

Update `Layout` or `DashboardPage` to include link to WhatsApp Notes.

### Page Layout

===
┌─────────────────────────────────────────┐
│ WhatsApp Notes                          │
│ From: +48123456789                       │  ← Header with phone number
├─────────────────────────────────────────┤
│ Dec 25, 2025 10:30                      │
│ Message text content here...            │
├─────────────────────────────────────────┤
│ Dec 24, 2025 15:45                      │
│ Another message text...                 │
├─────────────────────────────────────────┤
│ ...                                     │
└─────────────────────────────────────────┘
===

### API Service

Add to `apps/web/src/services/`:
===
export async function getWhatsAppMessages(token: string): Promise<WhatsAppMessagesResponse>
===

### Types

Add to `apps/web/src/types/`:
===
interface WhatsAppMessage {
  id: string;
  text: string;
  fromNumber: string;
  timestamp: string;
  receivedAt: string;
}

interface WhatsAppMessagesResponse {
  messages: WhatsAppMessage[];
  fromNumber: string;
}
===

## Step Checklist

- [ ] Add types to `apps/web/src/types/`
- [ ] Add API service function
- [ ] Create `WhatsAppNotesPage.tsx`
- [ ] Implement message list component
- [ ] Add loading state
- [ ] Add error state
- [ ] Add empty state ("No messages yet")
- [ ] Add route to `App.tsx`
- [ ] Update navigation (add tab)
- [ ] Style with Tailwind (consistent with existing pages)
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- New "WhatsApp Notes" tab visible in navigation
- Page loads and displays messages
- Phone number shown in header
- Messages sorted newest first
- Each message shows date and text
- Loading spinner while fetching
- Error message on failure
- "No messages" state when empty
- `npm run ci` passes

## Verification Commands

===
npm run ci
# Manual: navigate to /whatsapp-notes in browser
===

## Rollback Plan

Git revert. No backend changes.

