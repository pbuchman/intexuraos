# WhatsApp Service - Technical Debt

## Summary

| Category            | Count | Severity |
| -------------------  | -----  | --------  |
| TODO/FIXME Comments | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

Last updated: 2026-01-14

## Future Plans

### Planned Features

Features that are planned but not yet implemented:

- **Telegram support** - Add Telegram as an additional messaging channel
- **SMS support** - Add SMS as fallback messaging channel
- **Message threading** - Group related messages into conversation threads

### Proposed Enhancements

1. Rich message preview for images
2. Message reaction support
3. Message editing/deletion sync with WhatsApp

## Code Smells

### Low Priority

| File                          | Issue        | Impact                          |
| -----------------------------  | ------------  | -------------------------------  |
| `routes/webhookRoutes.ts:276` | TODO comment | Architectural improvement noted |

**Details:** The `processWebhookEvent` function is exported for Pub/Sub processing but still uses FastifyRequest. The TODO suggests refactoring to accept raw payload for cleaner integration.

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. No gaps identified.

### Coverage Areas

- Routes: Fully tested (webhook, message, mapping, pubsub)
- Use cases: All covered
- Infrastructure: Tested via routes

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

## SRP Violations

### None Detected

All files are within reasonable size limits.

## Code Duplicates

### None Detected

No significant code duplication patterns identified.

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

## Resolved Issues

### Historical Issues

No previously resolved issues tracked.
