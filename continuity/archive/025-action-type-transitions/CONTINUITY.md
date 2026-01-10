# Continuity Ledger

## Goal

Enable action type changes before dispatch, with transition logging for future classification improvements.

## Status

- **Done**: Planning, 1-0-domain-model, 1-1-change-type-usecase, 1-2-extend-patch-endpoint, 1-3-commands-router-internal-endpoint, 2-0-web-ui-dropdown, 3-0-test-coverage, 3-1-final-verification
- **Now**: Complete - Ready for archive
- **Next**: N/A

## Subtasks

| ID  | Title                             | Status |
| --- | --------------------------------- | ------ |
| 1-0 | Domain model & repository         | done   |
| 1-1 | Change type use case              | done   |
| 1-2 | Extend PATCH endpoint             | done   |
| 1-3 | Commands router internal endpoint | done   |
| 2-0 | Web UI dropdown                   | done   |
| 3-0 | Test coverage                     | done   |
| 3-1 | Final verification                | done   |

## Key Decisions

1. **Collection name**: `actions_transitions` (generic enough for future split support)
2. **Owner**: `actions-agent` service
3. **Allowed statuses**: `pending`, `awaiting_approval` only
4. **Status on type change**: unchanged (stays current status)
5. **Store command text**: yes, for future few-shot learning
6. **Command text source**: backend fetches from commands-router (never trust frontend with audit data)

## Open Questions

None currently.
