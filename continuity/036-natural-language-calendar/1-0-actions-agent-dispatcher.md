# Task 1-0: Actions Agent (Dispatcher)

**Tier:** 1 (Implementation)
**Context:** The `actions-agent` needs to route `calendar` type actions to the `calendar-agent`.

## Problem Statement

Currently, `actions-agent` doesn't know how to handle `calendar` actions. It needs to forward them to `calendar-agent`.

## Scope

- `apps/actions-agent`

## Steps

1. [ ] Create `src/domain/ports/calendarServiceClient.ts`.
   - Interface `CalendarServiceClient` with method `processAction(action: Action): Promise<Result<ProcessActionResult>>`.
2. [ ] Create `src/infra/http/calendarServiceHttpClient.ts`.
   - Implement `CalendarServiceClient` using `fetch`.
   - Use `config.calendarServiceUrl` (need to ensure this config exists or add it).
   - Set timeout to 60s.
3. [ ] Create `src/domain/usecases/executeCalendarAction.ts`.
   - Logic: Call `calendarServiceClient.processAction`.
   - If success, send WhatsApp notification (if URL provided).
4. [ ] Register handler in `src/domain/usecases/actionHandlerRegistry.ts`.
   - Add `calendar` to registry.
5. [ ] Update `src/services.ts` (or `infra/index.ts`) to inject the new client.
6. [ ] Add unit tests for `executeCalendarAction`.

## Verification

```bash
pnpm --filter actions-agent test
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
