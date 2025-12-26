# 2-2 Delete Message Feature

**Tier:** 2 (Dependent)  
**Status:** Pending  
**Depends on:** 2-0 (API), 2-1 (Web view)

## Context Snapshot

WhatsApp Notes page displays messages. Users need ability to delete individual messages.

## Problem Statement

Add delete functionality to WhatsApp Notes page:

- Delete button on each message row
- Confirmation before delete
- Nice UI animation when row is removed
- API call to delete endpoint

## Scope

**In scope:**

- Delete button per message
- Confirmation dialog (or inline confirm)
- Optimistic UI update with animation
- Error handling (revert if delete fails)
- API service function for delete

**Out of scope:**

- Bulk delete
- Undo functionality

## Required Approach

### UI Design

===
┌─────────────────────────────────────────────────┐
│ Dec 25, 2025 10:30 [Delete] │
│ Message text content here... │
└─────────────────────────────────────────────────┘
===

Delete button:

- Subtle style (icon or text)
- On hover: red highlight
- On click: confirm action

### Animation

When message is deleted:

1. Row fades out (opacity 0)
2. Row collapses (height 0)
3. Remove from list

# CSS transitions:

.message-row {
transition: opacity 300ms ease-out, max-height 300ms ease-out;
}
.message-row.deleting {
opacity: 0;
max-height: 0;
overflow: hidden;
}
===

Or use Tailwind classes with state management.

### API Service

===
export async function deleteWhatsAppMessage(
token: string,
messageId: string
): Promise<void>
===

### State Management

===
const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

const handleDelete = async (messageId: string) => {
// Add to deleting set (triggers animation)
setDeletingIds(prev => new Set(prev).add(messageId));

// Wait for animation
await new Promise(resolve => setTimeout(resolve, 300));

try {
await deleteWhatsAppMessage(token, messageId);
// Remove from messages list
setMessages(prev => prev.filter(m => m.id !== messageId));
} catch (error) {
// Revert animation
setDeletingIds(prev => {
const next = new Set(prev);
next.delete(messageId);
return next;
});
setError('Failed to delete message');
}
};
===

### Confirmation

Options:

1. **Inline**: Click → "Sure?" → Click again to confirm
2. **Modal**: Click → Modal dialog → Confirm/Cancel

Recommend: Inline confirmation for simplicity.

===
// Simple inline confirmation
const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

{confirmingDelete === message.id ? (
<>
<button onClick={() => setConfirmingDelete(null)}>Cancel</button>
<button onClick={() => handleDelete(message.id)}>Confirm</button>
</>
) : (
<button onClick={() => setConfirmingDelete(message.id)}>Delete</button>
)}
===

## Step Checklist

- [ ] Add `deleteWhatsAppMessage` to API service
- [ ] Add delete button to message row
- [ ] Implement confirmation UX (inline or modal)
- [ ] Add CSS/Tailwind animation classes
- [ ] Implement optimistic delete with animation
- [ ] Handle delete errors (revert animation, show error)
- [ ] Test delete flow manually
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- Delete button visible on each message
- Confirmation required before delete
- Smooth fade-out + collapse animation
- Message removed from list after delete
- Error shown if delete fails
- Animation reverts on error
- `npm run ci` passes

## Verification Commands

===
npm run ci

# Manual: test delete in browser

===

## Rollback Plan

Git revert. Message data unaffected (delete only removes on explicit action).
