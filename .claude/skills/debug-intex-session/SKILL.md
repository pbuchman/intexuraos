---
name: debug-intex-session
description: Use when user pastes a dev.intexuraos.cloud or intexuraos.cloud `/#/whatsapp/sessions?session=intex_session_*` URL and asks to debug, investigate, or understand what went wrong. Also use when user mentions an `intex_session_*` ID with investigation intent.
---

# Debug Intex Session

Investigate WhatsApp Assistant session execution by fetching sanitized session metadata and timeline events from Firestore.

## Invocation Detection

| Input Pattern                                                              | Action                       |
| -------------------------------------------------------------------------- | ---------------------------- |
| `https://dev.intexuraos.cloud/#/whatsapp/sessions?session=intex_session_*` | Extract session ID, env=dev  |
| `https://intexuraos.cloud/#/whatsapp/sessions?session=intex_session_*`     | Extract session ID, env=prod |
| `intex_session_<uuid>` + "debug"/"investigate"/"what went wrong"           | Use session ID directly      |

Do not use this skill for code-task URLs such as `/#/code-tasks/task_*` or direct `task_*` inputs. Use `debug-code-task` for those.

## Phase 1: Environment Detection

Parse the URL. Do NOT fetch it - hash-routed SPA returns only shell HTML.

| Signal | dev                    | prod                           |
| ------ | ---------------------- | ------------------------------ |
| URL    | `dev.intexuraos.cloud` | `intexuraos.cloud` (no `dev.`) |

Run `uname -n` to confirm current machine.

## Phase 2: Fetch Session Document

Extract the session ID from the URL hash query: `/#/whatsapp/sessions?session={sessionId}`.

Run from monorepo root through the bundled wrapper:

```bash
.codex/skills/debug-intex-session/scripts/fetch-session.sh <sessionId>
```

Print key fields as a summary table: `id`, `status`, `channel`, `startReason`, `endReason`, `activeTool`, `startedAt`, `endedAt`, `lastUserMessageAt`, `lastAssistantMessageAt`.

## Phase 3: Fetch Timeline Events

```bash
.codex/skills/debug-intex-session/scripts/fetch-session.sh <sessionId> --events-only
```

Use `--events` instead to fetch both session document and timeline events in one call. Events are ordered the same way the product timeline orders them: timestamp, event type order, document ID.

Present concrete event evidence. Message bodies, user IDs, URLs, phone numbers, and tool argument strings are redacted to length plus short hash.

## Critical Rules

1. NEVER WebFetch/curl the SPA URL. Data is in Firestore, not the HTML page.
2. NEVER run node scripts from `/tmp`. `firebase-admin` resolves from monorepo `node_modules`.
3. NEVER use `node -e` for scripts with `!`. Shell escapes `!` - use the script file.
4. NEVER print private WhatsApp message bodies, phone numbers, user IDs, URLs, prompt text, or tool argument text.
5. Present a definitive root cause only when the sanitized session document and timeline evidence support it. If evidence is insufficient, state exactly what is missing and how to fetch it.
