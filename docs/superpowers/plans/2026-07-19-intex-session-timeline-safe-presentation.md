# Intex Session Timeline Safe Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the authenticated Intex Agent session timeline from rendering arbitrary technical event payloads while preserving safe human-readable event evidence.

**Architecture:** Keep the API and stored events unchanged. `IntexSessionTimeline` applies an event-type allow-list plus closed canonical value sets, rejects structured object/array JSON in message strings, safely titles tool events, and omits the body paragraph when no safe value exists.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 4, Testing Library, Home Dev, Chrome.

## Global Constraints

- Never render or log an entire event payload.
- Never display a `text` or `message` value that parses to a JSON object or array.
- Never format an enum-like payload string until it belongs to its canonical closed set.
- Preserve event title, icon, timestamp, order, session metadata, API/storage contracts, responsive layout, search, refresh, endpoint evaluations, MiniMax M3, and Matrix ordering.
- Keep the five user-owned untracked design files untouched and outside every commit.

---

### Task 1: Add the safe timeline body projection

**Files:**
- Modify: `apps/web/src/components/intex-agent/IntexSessionTimeline.tsx`
- Test: `apps/web/src/components/intex-agent/__tests__/IntexSessionTimeline.test.tsx`
- Modify: `docs/superpowers/plans/2026-07-18-intex-agent-live-acceptance-fixes.md`

**Interfaces:**
- Consumes: `IntexAgentSessionEvent` with `type` and `payload`.
- Produces: internal `getEventBody(event): string | undefined`; `undefined` means render no body paragraph.

- [x] **Step 1: Add RED component regressions**

  Add an `event(overrides)` fixture and tests with exact assertions:

  ```tsx
  function event(overrides: Partial<IntexAgentSessionEvent> = {}): IntexAgentSessionEvent {
    return {
      id: 'event-1',
      sessionId: 'session-1',
      userId: 'user-1',
      type: 'user_message',
      payload: { text: 'Visible user text' },
      createdAt: '2026-06-24T22:15:01.000Z',
      ...overrides,
    };
  }
  ```

  Cover all twelve event types. Prove ordinary text, compatible `message`/`text`
  fallback priority, syntactically invalid text, and JSON primitives remain visible;
  serialized object and array strings are absent; `confirmation_resolved` accepts only
  `accepted`, `rejected`, and `superseded`; a resolution-less confirmation card has no
  `<p>`; all tool event variants accept only canonical tool names and ignore extra
  `result`/`metadata`; lifecycle and fallback values use closed sets; unknown values and
  unsupported technical payloads remain absent.

- [x] **Step 2: Run the focused test and observe RED**

  Run:

  ```bash
  pnpm --filter @intexuraos/web exec vitest run src/components/intex-agent/__tests__/IntexSessionTimeline.test.tsx
  ```

  Expected: new privacy assertions fail because structured message JSON or the generic
  `JSON.stringify(event.payload)` output is still present.

- [x] **Step 3: Implement the minimal allow-list**

  Add a helper that trims message strings and rejects parsed objects/arrays:

  ```ts
  function getDisplayString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const trimmed = value.trim();
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return undefined;
    } catch {
      // Ordinary text is intentionally displayable.
    }
    return value;
  }
  ```

  Define readonly canonical sets for existing session statuses, start reasons, end
  reasons, Intex Agent tool names, fallback reasons, and confirmation resolutions.
  Switch on `event.type` to select only the fields defined in the design. The title and
  body of tool events must share the same canonical tool resolver; an unknown name uses
  `Tool call started`, `Tool call completed`, or `Tool call failed` and no body. Return
  `undefined` for all unknown body data. Compute the body once per event and render
  `<p>` only when it is defined. Do not introduce a redaction walker or backend change.

- [x] **Step 4: Run focused GREEN and package checks**

  Run:

  ```bash
  pnpm --filter @intexuraos/web exec vitest run src/components/intex-agent/__tests__/IntexSessionTimeline.test.tsx
  pnpm --filter @intexuraos/web typecheck
  pnpm --filter @intexuraos/web lint
  ```

  Expected: all commands exit `0`.

- [ ] **Step 5: Review, verify, and record implementation evidence**

  Request independent spec and code-quality reviews, resolve every Critical/Important
  finding, run `git diff --check`, then run exact `pnpm run ci:tracked`. Mark only the
  completed Task 31 implementation/review checkboxes in the active plan.

### Task 2: Ship and repeat the live acceptance audit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-intex-agent-live-acceptance-fixes.md`

**Interfaces:**
- Consumes: merged `development` revision containing Task 1.
- Produces: exact Home Dev deployment evidence and privacy-safe Chrome acceptance evidence.

- [ ] **Step 1: Ship through the repository workflow**

  Commit only the intended design, plan, component, test, and active-plan files. Push a
  `codex/` branch, create a reviewed PR to `development`, require every GitHub check to
  pass, merge it, and verify Home Dev runs the exact merge SHA.

- [ ] **Step 2: Repeat the logged-in Chrome audit**

  On desktop and a narrow mobile breakpoint, verify session loading, rapid selection,
  focus restoration, refresh, timeline/rail ordering, and no horizontal overflow.
  Inspect only privacy-safe shapes: require zero body strings that parse to objects or
  arrays, zero displayed technical key names from the observed regression, generic safe
  titles for noncanonical tool names, zero console warnings/errors, and only successful
  session list/event responses.

- [ ] **Step 3: Record final evidence and close the loop**

  Update Task 30 and Task 31 checkboxes/evidence without private content. Run the exact
  commit gate again for the documentation-only evidence commit, ship it through a final
  reviewed PR, and audit the complete user goal requirement by requirement.
