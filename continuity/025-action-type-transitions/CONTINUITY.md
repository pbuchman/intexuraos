# Continuity Ledger

## Goal

Enable action type changes before dispatch, with transition logging for future classification improvements.

## Status

- **Done**: Planning
- **Now**: Not started
- **Next**: 1-0-domain-model

## Subtasks

| ID  | Title                             | Status  |
| --- | --------------------------------- | ------- |
| 1-0 | Domain model & repository         | pending |
| 1-1 | Change type use case              | pending |
| 1-2 | Extend PATCH endpoint             | pending |
| 1-3 | Commands router internal endpoint | pending |
| 2-0 | Web UI dropdown                   | pending |
| 3-0 | Test coverage                     | pending |
| 3-1 | Final verification                | pending |

## Key Decisions

1. **Collection name**: `actions_transitions` (generic enough for future split support)
2. **Owner**: `actions-agent` service
3. **Allowed statuses**: `pending`, `awaiting_approval` only
4. **Status on type change**: unchanged (stays current status)
5. **Store command text**: yes, for future few-shot learning
6. **Command text source**: backend fetches from commands-router (never trust frontend with audit data)

## Open Questions

None currently.
