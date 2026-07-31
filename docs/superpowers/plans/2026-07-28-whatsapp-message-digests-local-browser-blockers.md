# WhatsApp Message Digests — Local Browser Blocker Remediation

> Status: active — execute sequentially before resuming MVP Chrome Task 9.

## Goal

Remove the browser-only runtime blocker discovered by the first real `New digest` navigation, prove
the prompt-template import is browser-safe, and resume the same local E2E scenario in the already
running system Google Chrome. Keep this remediation deliberately smaller than the feature-completion
phase and do not run a full CI pass.

## Evidence and root cause

- The digest list renders and reads the user's masked primary WhatsApp number successfully.
- Navigating to `#/whatsapp/message-digests/new` throws before the form renders.
- Vite reports that `node:crypto.randomUUID` was externalized for browser compatibility.
- `MessageDigestDefinitionForm.tsx` imports two constant instruction templates from the root
  `@intexuraos/llm-prompts` barrel. That barrel re-exports server-oriented prompt modules; their
  dependency graph reaches the root `@intexuraos/common-core` tracing export and `node:crypto`.
- The templates themselves are plain string constants and already live in
  `packages/llm-prompts/src/message-digest/templates.ts`.

## Constraints

- Preserve the centralized prompt source; do not duplicate prompt strings in Web.
- Do not add a browser crypto polyfill or weaken server trace-ID generation.
- Do not change digest semantics, API payloads, or UI copy.
- Use TDD and run only the focused test/typecheck/build evidence needed for this boundary.
- Resume in the same claimed Chrome tab; do not launch another browser or profile.

## Task 1: Add a RED browser-boundary contract

**Create:**

- `apps/web/src/__tests__/messageDigestBrowserBoundary.test.ts`

The test must read the package export map and the form source and prove all of the following:

1. `@intexuraos/llm-prompts` exposes a dedicated browser-safe message-digest-template subpath.
2. `MessageDigestDefinitionForm.tsx` imports the templates only from that subpath.
3. The browser-safe template module contains no `node:` import and does not re-export the package
   root barrel.
4. The form no longer imports the root `@intexuraos/llm-prompts` entry point.

Run the new test once and capture the expected RED failure before implementation.

## Task 2: Export and consume only the constant template module

**Modify:**

- `packages/llm-prompts/package.json`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`

Implementation:

1. Add `./message-digest/templates` to the package export map, pointing directly at
   `src/message-digest/templates.ts`.
2. Switch production Web and its focused form test to
   `@intexuraos/llm-prompts/message-digest/templates`.
3. Make no change to the root export, server imports, or template content.

## Task 3: Close the focused automated gate

Run, in this order:

```bash
pnpm --filter @intexuraos/web exec vitest run src/__tests__/messageDigestBrowserBoundary.test.ts src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx src/pages/__tests__/MessageDigestEditorPages.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm --filter @intexuraos/web build
pnpm exec eslint apps/web/src/__tests__/messageDigestBrowserBoundary.test.ts apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx --max-warnings 0
pnpm exec prettier --check packages/llm-prompts/package.json apps/web/src/__tests__/messageDigestBrowserBoundary.test.ts apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx
git diff --check
```

The build is a focused browser bundling check, not the repository-wide CI pass. It must not emit a
`node:crypto` externalization warning for the Message Digest route.

## Task 4: Resume the same Chrome checkpoint

1. Reload the already claimed local-app tab so Vite serves the changed graph.
2. Navigate through WhatsApp → Message Digests → New digest.
3. Verify the form heading and all four sections render, schedule/readiness settle, and there is no
   router error screen or new page-console error caused by the route.
4. Continue the timestamped group/direct E2E scenario from MVP Web Task 9.

## Deferred local-development hardening

The local Message Digest store requires Firestore on `localhost:8101`, while the current
`emulators:start` command starts only Pub/Sub. The MVP gate is running a separate Firestore emulator
process and keeps WhatsApp Service on real dev Firestore while Message Digest Service stays isolated.
Add a reproducible standard start path only in the next written feature-completion plan, with its own
tests; do not widen this browser-boundary patch.

## Completion gate

This remediation is complete only when the RED contract turns green, focused form/editor tests,
both typechecks, Web build, lint/format/diff checks pass, and the existing Chrome tab renders the new
digest form without the `node:crypto` error. No full CI run and no commit are allowed at this point.
