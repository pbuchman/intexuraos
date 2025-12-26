# WhatsApp Notes Refactor — Task Index

This folder contains the planning and execution artifacts for refactoring the WhatsApp integration.

## Procedural Rules

1. **Idempotent Execution**: All tasks can be re-run from scratch producing identical results
2. **Continuity Ledger**: `CONTINUITY.md` is the single source of truth for progress
3. **Tier Ordering**: Execute tasks in tier order (0 → 1 → 2+)
4. **Verification**: Every task must pass `npm run ci` before completion

## Numbering Convention

===
{tier}-{sequence}-{title}.md
===

- **Tier 0**: Foundational/prerequisite work (must complete first)
- **Tier 1**: Independent deliverables (can be parallelized)
- **Tier 2+**: Dependent/integrative work

## Task List

| File                              | Tier | Title                        | Status  |
| --------------------------------- | ---- | ---------------------------- | ------- |
| 0-0-remove-notion-connection.md   | 0    | Remove Notion Connection     | ✅ Done |
| 0-1-otp-verification-research.md  | 0    | OTP Verification Research    | ✅ Done |
| 1-0-firestore-message-storage.md  | 1    | Firestore Message Storage    | ✅ Done |
| 1-1-webhook-text-only.md          | 1    | Webhook Text-Only Support    | ✅ Done |
| 1-2-async-reply-with-reference.md | 1    | Async Reply with Reference   | ✅ Done |
| 2-0-whatsapp-notes-api.md         | 2    | WhatsApp Notes API Endpoints | ✅ Done |
| 2-1-whatsapp-notes-web-view.md    | 2    | WhatsApp Notes Web View      | ✅ Done |
| 2-2-delete-message-feature.md     | 2    | Delete Message Feature       | ✅ Done |

## How to Resume After Interruption

1. Read `CONTINUITY.md` to get current state
2. Find _Now_ item in ledger
3. Continue from that task
4. Update ledger after each completed subtask

## Verification Commands

===
npm run ci # Must pass before task completion
npx prettier --write . # Run before CI if files were modified
===
