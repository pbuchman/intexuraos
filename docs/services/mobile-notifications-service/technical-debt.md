# Mobile Notifications Service - Technical Debt

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 0     | -        |

## Future Plans

1. **Push provider integration** - Direct FCM/APNs integration to push back to devices (currently only stores for polling)
2. **Rich notifications** - Images, actions, sounds in webhook payloads
3. **Scheduled delivery** - Time-based push scheduling
4. **Batch operations** - Bulk notification management (bulk delete, bulk read)
5. **iOS support** - Expand beyond Android/Tasker to iOS shortcuts

## Resolved Issues

1. **Response contract violations** - All routes migrated from raw `reply.send()` / manual status codes to standardized `reply.ok()` / `reply.fail()` contract (resolved 2026-02-01)
2. **Direct pino() usage** - Replaced with `createAppLogger()` from `@intexuraos/infra-sentry` so errors are automatically forwarded to Sentry (resolved 2026-02-01)
3. **Inconsistent internal error format** - Internal routes now return `{ success: false, error: { code, message } }` instead of `{ error: string }` (resolved 2026-02-01)
4. **100% branch coverage** - Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement enabled (resolved 2026-02-02)
