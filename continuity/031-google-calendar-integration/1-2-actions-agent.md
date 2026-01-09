# 1-2 Calendar Handler in actions-agent

**Tier:** 1 (Independent Deliverable)

## Context

The `calendar` action type exists in actions-agent but has no handler—actions stay `pending` forever. We need to implement a two-phase flow:

1. **handleCalendarAction**: Move to `awaiting_approval`, notify user
2. **executeCalendarAction**: Create event after user approval

## Problem Statement

When a user sends "Schedule meeting tomorrow at 3pm" via WhatsApp:

1. Action is created with type `calendar`
2. Currently nothing happens (no handler)
3. We need: approval flow → calendar event creation

## Scope

**In scope:**

- handleCalendarAction use case (pending → awaiting_approval)
- executeCalendarAction use case (awaiting_approval → completed)
- CalendarServiceClient port and HTTP implementation
- Handler registration in services.ts
- Tests (95% coverage)

**Not in scope:**

- Creating calendar-agent (separate task)
- Terraform changes (Tier 2)
- WhatsApp notification content changes

## Required Approach

1. Study existing action handler patterns (handleResearchAction, executeResearchAction)
2. Create CalendarServiceClient port
3. Implement HTTP client for calendar-agent
4. Create handleCalendarAction (phase 1)
5. Create executeCalendarAction (phase 2)
6. Register handler in services.ts
7. Write comprehensive tests

## Step Checklist

### Domain Layer

- [ ] Create `apps/actions-agent/src/domain/ports/calendarServiceClient.ts`
- [ ] Create `apps/actions-agent/src/domain/useCases/handleCalendarAction.ts`
- [ ] Create `apps/actions-agent/src/domain/useCases/executeCalendarAction.ts`

### Infrastructure Layer

- [ ] Create `apps/actions-agent/src/infra/http/calendarHttpClient.ts`

### Integration

- [ ] Update `apps/actions-agent/src/services.ts` to include calendarServiceClient
- [ ] Update `apps/actions-agent/src/domain/actionHandlerRegistry.ts` for calendar
- [ ] Add INTEXURAOS_CALENDAR_AGENT_URL to config.ts
- [ ] Add INTEXURAOS_CALENDAR_AGENT_URL to REQUIRED_ENV in index.ts

### Tests

- [ ] Write handleCalendarAction tests
- [ ] Write executeCalendarAction tests
- [ ] Write calendarHttpClient tests
- [ ] Ensure 95% coverage

### Verification

- [ ] Run `npm run ci`

## Definition of Done

- [ ] handleCalendarAction transitions action to `awaiting_approval`
- [ ] executeCalendarAction creates calendar event and transitions to `completed`
- [ ] Handler registered and responding to `calendar` action type
- [ ] 95% test coverage
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test -w @intexuraos/actions-agent
npm run typecheck -w @intexuraos/actions-agent
npm run ci
```

## Rollback Plan

1. Revert changes to `apps/actions-agent/`
2. No infrastructure changes to roll back

## Critical Files Reference

| Purpose                | File                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| Handle action pattern  | `apps/actions-agent/src/domain/useCases/handleResearchAction.ts`  |
| Execute action pattern | `apps/actions-agent/src/domain/useCases/executeResearchAction.ts` |
| Handler registry       | `apps/actions-agent/src/domain/actionHandlerRegistry.ts`          |

## Action Payload Structure

```typescript
interface CalendarActionPayload {
  eventTitle: string;
  eventDateTime: string; // ISO 8601
  eventEndDateTime?: string;
  attendees?: string[];
  description?: string;
  location?: string;
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
