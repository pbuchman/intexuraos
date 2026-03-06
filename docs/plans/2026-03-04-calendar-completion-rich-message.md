# Rich Calendar Completion Message Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a calendar event is successfully created (after approval or auto-execute), send a rich WhatsApp message with event details (title, date/time, duration, location) instead of the current bare `📅 {message} View it here: {url}`.

**Architecture:** After `processAction` succeeds, fetch the cached preview via `calendarServiceClient.getPreview(actionId)` and format a rich completion message. Falls back to the current basic message if preview data is unavailable. Reuses the existing `formatDateTime` logic from `formatCalendarApprovalMessage.ts` by extracting it into a shared helper.

**Tech Stack:** TypeScript, Vitest, actions-agent service

---

### Task 1: Extract shared `formatDateTime` into `calendarMessageFormatting.ts`

The `formatDateTime` function is currently private inside `formatCalendarApprovalMessage.ts`. Both the approval and completion formatters need it. Extract it to a shared module.

**Files:**
- Create: `apps/actions-agent/src/domain/utils/calendarMessageFormatting.ts`
- Modify: `apps/actions-agent/src/domain/utils/formatCalendarApprovalMessage.ts`
- Test: `apps/actions-agent/src/__tests__/calendarMessageFormatting.test.ts`

**Step 1: Write the failing test for `formatDateTime`**

```typescript
import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../domain/utils/calendarMessageFormatting.js';

describe('formatDateTime', () => {
  it('formats start and end time', () => {
    const result = formatDateTime('2025-01-15T15:00:00', '2025-01-15T16:30:00', false);
    expect(result).not.toBeNull();
    expect(result).toContain('\u00b7'); // middle dot separator
    expect(result).toContain('\u2013'); // en-dash between times
  });

  it('formats start time only when end is null', () => {
    const result = formatDateTime('2025-01-15T14:00:00', null, false);
    expect(result).not.toBeNull();
    expect(result).toContain('\u00b7');
    expect(result).not.toContain('\u2013');
  });

  it('formats all-day event', () => {
    const result = formatDateTime('2025-01-15', undefined, true);
    expect(result).not.toBeNull();
    expect(result).toContain('(All day)');
  });

  it('returns null when start is undefined', () => {
    const result = formatDateTime(undefined, undefined, false);
    expect(result).toBeNull();
  });

  it('returns null for invalid date string', () => {
    const result = formatDateTime('not-a-date', undefined, false);
    expect(result).toBeNull();
  });

  it('returns null for invalid all-day date', () => {
    const result = formatDateTime('not-a-date', undefined, true);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/calendarMessageFormatting.test.ts`
Expected: FAIL — module not found

**Step 3: Create the shared module with `formatDateTime`**

Create `apps/actions-agent/src/domain/utils/calendarMessageFormatting.ts`:

```typescript
/**
 * Format a date/time string for display in WhatsApp messages.
 * Handles both ISO datetime strings and date-only strings (all-day events).
 */
export function formatDateTime(start?: string, end?: string | null, isAllDay?: boolean): string | null {
  if (start === undefined) {
    return null;
  }

  if (isAllDay === true) {
    try {
      const date = new Date(start + 'T12:00:00Z');
      if (isNaN(date.getTime())) {
        return null;
      }
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) + ' (All day)';
    } catch {
      return null;
    }
  }

  try {
    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      return null;
    }
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startTime = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (end !== null && end !== undefined) {
      const endDate = new Date(end);
      const endTime = endDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${dateStr} \u00b7 ${startTime} \u2013 ${endTime}`;
    }

    return `${dateStr} \u00b7 ${startTime}`;
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/calendarMessageFormatting.test.ts`
Expected: PASS

**Step 5: Update `formatCalendarApprovalMessage.ts` to import from shared module**

Replace the private `formatDateTime` function in `formatCalendarApprovalMessage.ts` with an import:

```typescript
import { formatDateTime } from './calendarMessageFormatting.js';
```

Remove the entire `function formatDateTime(...)` block (lines 14–60) from the file.

**Step 6: Run existing approval message tests to verify no regression**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/formatCalendarApprovalMessage.test.ts`
Expected: PASS — all existing tests still green

**Step 7: Commit**

```bash
git add apps/actions-agent/src/domain/utils/calendarMessageFormatting.ts apps/actions-agent/src/__tests__/calendarMessageFormatting.test.ts apps/actions-agent/src/domain/utils/formatCalendarApprovalMessage.ts
git commit -m "refactor: extract formatDateTime to shared calendarMessageFormatting module"
```

---

### Task 2: Create `formatCalendarCompletionMessage` utility

**Files:**
- Create: `apps/actions-agent/src/domain/utils/formatCalendarCompletionMessage.ts`
- Test: `apps/actions-agent/src/__tests__/formatCalendarCompletionMessage.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { formatCalendarCompletionMessage } from '../domain/utils/formatCalendarCompletionMessage.js';
import type { CalendarPreview } from '../domain/ports/calendarServiceClient.js';

describe('formatCalendarCompletionMessage', () => {
  const baseParams = {
    fallbackMessage: 'Calendar event created successfully',
    eventUrl: 'https://calendar.google.com/calendar/event?eid=abc123',
  };

  describe('rich message (preview available)', () => {
    it('formats message with all fields', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Team Meeting',
        start: '2025-01-15T15:00:00',
        end: '2025-01-15T16:30:00',
        duration: '1 hour 30 minutes',
        location: 'Conference Room A',
        isAllDay: false,
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u2705 Calendar Event Created');
      expect(result).toContain('*Team Meeting*');
      expect(result).toContain('\u{1F4C6}');
      expect(result).toContain('\u23F1 1 hour 30 minutes');
      expect(result).toContain('\u{1F4CD} Conference Room A');
      expect(result).toContain('View: https://calendar.google.com/calendar/event?eid=abc123');
    });

    it('formats message without location when null', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Quick Sync',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T10:30:00',
        duration: '30 minutes',
        location: null,
        isAllDay: false,
        generatedAt: '2025-01-15T09:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('*Quick Sync*');
      expect(result).not.toContain('\u{1F4CD}');
    });

    it('formats all-day event', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Company Offsite',
        start: '2025-01-15',
        isAllDay: true,
        duration: null,
        location: 'Beach Resort',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('*Company Offsite*');
      expect(result).toContain('(All day)');
      expect(result).not.toContain('\u23F1');
    });
  });

  describe('fallback message', () => {
    it('returns basic message when preview is null', () => {
      const result = formatCalendarCompletionMessage({ ...baseParams, preview: null });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
      expect(result).toContain('View: https://calendar.google.com/calendar/event?eid=abc123');
    });

    it('returns basic message when preview status is failed', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'failed',
        error: 'Could not parse date',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
    });

    it('returns basic message when preview summary is missing', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/formatCalendarCompletionMessage.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/actions-agent/src/domain/utils/formatCalendarCompletionMessage.ts`:

```typescript
import type { CalendarPreview } from '../ports/calendarServiceClient.js';
import { formatDateTime } from './calendarMessageFormatting.js';

export interface FormatCalendarCompletionMessageParams {
  preview: CalendarPreview | null;
  fallbackMessage: string;
  eventUrl: string;
}

/**
 * Format a rich calendar completion message with event details.
 * Falls back to a basic message when preview is unavailable or failed.
 */
export function formatCalendarCompletionMessage(params: FormatCalendarCompletionMessageParams): string {
  const { preview, fallbackMessage, eventUrl } = params;

  if (
    preview?.status !== 'ready' ||
    preview.summary === undefined
  ) {
    return `\u{1F4C5} ${fallbackMessage}\n\nView: ${eventUrl}`;
  }

  const lines: string[] = ['\u2705 Calendar Event Created', ''];

  lines.push(`*${preview.summary}*`);

  const dateTimeStr = formatDateTime(preview.start, preview.end, preview.isAllDay);
  if (dateTimeStr !== null) {
    lines.push(`\u{1F4C6} ${dateTimeStr}`);
  }

  if (preview.duration !== null && preview.duration !== undefined) {
    lines.push(`\u23F1 ${preview.duration}`);
  }

  if (preview.location !== null && preview.location !== undefined) {
    lines.push(`\u{1F4CD} ${preview.location}`);
  }

  lines.push('');
  lines.push(`View: ${eventUrl}`);

  return lines.join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/formatCalendarCompletionMessage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/actions-agent/src/domain/utils/formatCalendarCompletionMessage.ts apps/actions-agent/src/__tests__/formatCalendarCompletionMessage.test.ts
git commit -m "feat: add formatCalendarCompletionMessage utility for rich completion messages"
```

---

### Task 3: Update `executeCalendarAction` to fetch preview and use rich message

**Files:**
- Modify: `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`
- Modify: `apps/actions-agent/src/__tests__/executeCalendarAction.test.ts`

**Step 1: Write the failing test — rich completion message when preview exists**

Add to `executeCalendarAction.test.ts`:

```typescript
it('sends rich WhatsApp completion message when preview data is available', async () => {
  const action = createAction({ status: 'awaiting_approval' });
  await fakeActionRepo.save(action);

  fakeCalendarClient.setPreview('action-123', {
    actionId: 'action-123',
    userId: 'user-456',
    status: 'ready',
    summary: 'Meeting with John',
    start: '2025-01-15T15:00:00',
    end: '2025-01-15T16:00:00',
    duration: '1 hour',
    location: 'Office',
    isAllDay: false,
    generatedAt: '2025-01-15T10:00:00Z',
  });

  const usecase = createExecuteCalendarActionUseCase({
    actionRepository: fakeActionRepo,
    calendarServiceClient: fakeCalendarClient,
    whatsappPublisher: fakeWhatsappPublisher,
    webAppUrl: 'https://app.test.com',
    logger: createMockLogger(),
  });

  await usecase('action-123');

  const messages = fakeWhatsappPublisher.getSentMessages();
  expect(messages).toHaveLength(1);
  expect(messages[0]?.message).toContain('\u2705 Calendar Event Created');
  expect(messages[0]?.message).toContain('*Meeting with John*');
  expect(messages[0]?.message).toContain('1 hour');
  expect(messages[0]?.message).toContain('Office');
  expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
});
```

**Step 2: Write the failing test — fallback when preview fetch fails**

Add to `executeCalendarAction.test.ts`:

```typescript
it('sends basic completion message when preview fetch fails (graceful fallback)', async () => {
  const action = createAction({ status: 'awaiting_approval' });
  await fakeActionRepo.save(action);

  // No preview set — getPreview returns null by default

  const usecase = createExecuteCalendarActionUseCase({
    actionRepository: fakeActionRepo,
    calendarServiceClient: fakeCalendarClient,
    whatsappPublisher: fakeWhatsappPublisher,
    webAppUrl: 'https://app.test.com',
    logger: createMockLogger(),
  });

  await usecase('action-123');

  const messages = fakeWhatsappPublisher.getSentMessages();
  expect(messages).toHaveLength(1);
  // Falls back to basic message format
  expect(messages[0]?.message).toContain('Calendar event created');
  expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
});
```

**Step 3: Run tests to verify they fail**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/executeCalendarAction.test.ts`
Expected: FAIL — new tests fail (message doesn't contain rich content)

**Step 4: Update `executeCalendarAction.ts` implementation**

Add import at top:
```typescript
import { formatCalendarCompletionMessage } from '../utils/formatCalendarCompletionMessage.js';
```

Replace the completion notification block (lines 147–168 in current code) with:

```typescript
    if (resourceUrl !== undefined) {
      const isAbsoluteUrl = resourceUrl.startsWith('http');
      const fullUrl = isAbsoluteUrl ? resourceUrl : `${webAppUrl}${resourceUrl}`;

      // Fetch cached preview for rich message (best-effort)
      let previewForMessage: CalendarPreview | null = null;
      const previewResult = await calendarServiceClient.getPreview(actionId);
      if (previewResult.ok) {
        previewForMessage = previewResult.value;
      } else {
        logger.warn(
          { actionId, error: previewResult.error.message },
          'Failed to fetch preview for completion message (non-fatal, using basic message)'
        );
      }

      const whatsappMessage = formatCalendarCompletionMessage({
        preview: previewForMessage,
        fallbackMessage: message,
        eventUrl: fullUrl,
      });

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `calendar-complete-${actionId}`,
      });

      if (!publishResult.ok) {
        logger.warn(
          { actionId, userId: action.userId, error: publishResult.error.message },
          'Failed to send WhatsApp notification (non-fatal)'
        );
      } else {
        logger.info({ actionId }, 'WhatsApp completion notification sent');
      }
    }
```

Also add the `CalendarPreview` import at the top:
```typescript
import type { CalendarServiceClient, CalendarPreview } from '../ports/calendarServiceClient.js';
```

**Step 5: Run tests to verify they pass**

Run: `cd apps/actions-agent && npx vitest run src/__tests__/executeCalendarAction.test.ts`
Expected: PASS — all tests green (new + existing)

**Step 6: Update existing test assertion that checks the old message format**

The test `'publishes WhatsApp notification with Google Calendar URL on success'` (line 230) currently asserts `messages[0]?.message).toContain('Calendar event created')`. This will now be inside the fallback or the rich message. Verify the assertion still passes or update to match the new format (it should pass since the fallback message from `FakeCalendarServiceClient` is `'Calendar event created successfully'` which becomes `📅 Calendar event created successfully`).

Run: `cd apps/actions-agent && npx vitest run src/__tests__/executeCalendarAction.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/actions-agent/src/domain/usecases/executeCalendarAction.ts apps/actions-agent/src/__tests__/executeCalendarAction.test.ts
git commit -m "feat: rich WhatsApp message when calendar event is created"
```

---

### Task 4: Run full CI verification

**Step 1: Build packages**

Run: `pnpm build`
Expected: PASS

**Step 2: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- actions-agent`
Expected: PASS with 100% coverage

**Step 3: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS

**Step 4: Commit any fixups if needed**

If coverage gaps found, add ignore comments or additional tests as required.

---

### Task 5: Update Linear issue INT-535

Update the INT-535 description on Linear to include the new scope:

**Additional scope items:**
- `formatCalendarCompletionMessage` utility for rich completion messages
- `calendarMessageFormatting.ts` shared module (extracted `formatDateTime`)
- `executeCalendarAction.ts` fetches preview and uses rich message
- Fallback to basic message when preview data unavailable

**Additional test requirements:**

| #   | Test Case                                                           | Type   | Location                                  |
| --- | ------------------------------------------------------------------- | ------ | ----------------------------------------- |
| 15  | `formatDateTime` formats start+end time                             | Unit   | `calendarMessageFormatting.test.ts`       |
| 16  | `formatDateTime` formats start only (no end)                        | Unit   | `calendarMessageFormatting.test.ts`       |
| 17  | `formatDateTime` formats all-day event                              | Unit   | `calendarMessageFormatting.test.ts`       |
| 18  | `formatDateTime` returns null for undefined start                   | Unit   | `calendarMessageFormatting.test.ts`       |
| 19  | `formatCalendarCompletionMessage` formats all fields                | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 20  | `formatCalendarCompletionMessage` handles missing location          | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 21  | `formatCalendarCompletionMessage` handles all-day event             | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 22  | `formatCalendarCompletionMessage` fallback when preview null        | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 23  | `formatCalendarCompletionMessage` fallback when preview failed      | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 24  | `formatCalendarCompletionMessage` fallback when summary missing     | Unit   | `formatCalendarCompletionMessage.test.ts` |
| 25  | `executeCalendarAction` sends rich message when preview available   | Unit   | `executeCalendarAction.test.ts`           |
| 26  | `executeCalendarAction` falls back to basic message when no preview | Unit   | `executeCalendarAction.test.ts`           |

**Additional files to modify:**

| File                                                                       | Change                                     |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/actions-agent/src/domain/utils/calendarMessageFormatting.ts`         | **New:** shared `formatDateTime` helper    |
| `apps/actions-agent/src/__tests__/calendarMessageFormatting.test.ts`       | **New:** tests for shared helper           |
| `apps/actions-agent/src/domain/utils/formatCalendarCompletionMessage.ts`   | **New:** completion message formatter      |
| `apps/actions-agent/src/__tests__/formatCalendarCompletionMessage.test.ts` | **New:** tests for completion formatter    |
| `apps/actions-agent/src/domain/utils/formatCalendarApprovalMessage.ts`     | Import `formatDateTime` from shared module |
| `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`          | Fetch preview + use rich message           |
| `apps/actions-agent/src/__tests__/executeCalendarAction.test.ts`           | New tests for rich completion message      |
