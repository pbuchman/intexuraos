---
name: debug-intex-session
description: Investigate IntexuraOS WhatsApp Assistant sessions when the user shares a `dev.intexuraos.cloud` or `intexuraos.cloud` `/#/whatsapp/sessions?session=intex_session_*` URL, or provides an `intex_session_*` ID and asks to debug, investigate, or understand what happened.
---

# Debug Intex Session

Use this skill for WhatsApp Assistant session investigations backed by Firestore data.

## Trigger patterns

- `https://dev.intexuraos.cloud/#/whatsapp/sessions?session=intex_session_*`
- `https://intexuraos.cloud/#/whatsapp/sessions?session=intex_session_*`
- `intex_session_*` plus intent such as `debug`, `investigate`, or `what went wrong`

## Non-triggers

Do not use this skill for code-task investigations.

- Do not use this skill for `https://dev.intexuraos.cloud/#/code-tasks/task_*`.
- Do not use this skill for `https://intexuraos.cloud/#/code-tasks/task_*`.
- Do not use this skill for direct `task_*` inputs.
- Use `$debug-code-task` for those code-task investigations instead.

## Workflow

1. Extract the session ID from the URL `session=` query parameter or direct `intex_session_*` input.
2. Record link provenance without treating it as runtime routing.
   - `dev.intexuraos.cloud` is accepted only for historical investigations.
   - `intexuraos.cloud` is the live production UI.
   - Home Dev is a production-owned worker host, not a live DEV application runtime.
   - Never infer data ownership, credential mode, or callback ownership from the link hostname.
3. Never fetch the SPA URL. The page is hash-routed; the session data lives in Firestore.
4. Confirm the current machine with `uname -n`.
5. Use the bundled wrapper `.codex/skills/debug-intex-session/scripts/fetch-session.sh`, which resolves the local repo and runs the Firestore fetcher from the checked-out repo.

## Session document

Run:

```bash
.codex/skills/debug-intex-session/scripts/fetch-session.sh <sessionId>
```

The wrapper uses the checked-out repo for `firebase-admin` module resolution and expects a service-account key at `~/.config/gcloud/sa-key.json` unless `GOOGLE_APPLICATION_CREDENTIALS` points at another service-account key.

Summarize these fields for the user when present:

- `id`
- `status`
- `channel`
- `startReason`
- `endReason`
- `activeTool`
- `startedAt`
- `endedAt`
- `lastUserMessageAt`
- `lastAssistantMessageAt`

Do not print private user IDs, phone numbers, message bodies, URLs, or prompt/tool argument text.

## Timeline events

Run:

```bash
.codex/skills/debug-intex-session/scripts/fetch-session.sh <sessionId> --events-only
```

Use `--events` if you want the session document and events in one call. Events are ordered the same way the product timeline orders them: timestamp first, then session event type order, then document ID.

Use event types, timestamps, tool names, statuses, resolutions, and sanitized error text as evidence. Message bodies and other private strings are printed only as length plus `sha256_12` hashes.

## Rules

- Never `curl` or web-fetch the WhatsApp sessions SPA URL.
- Never run the Firestore script from `/tmp`.
- Never use `node -e` for commands that may include `!`.
- Treat `.codex/skills/debug-intex-session/scripts/fetch-session.sh` as the canonical wrapper path.
- Stay factual. Show the sanitized session document and timeline evidence before offering conclusions.
