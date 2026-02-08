# App Settings Service - Technical Debt

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 0     | -        |

## Future Plans

1. **Budget management** - User-defined spending limits
2. **Cost alerts** - Notifications on threshold
3. **Forecasting** - Predict future costs
4. **Admin API** - Pricing configuration endpoint

## Resolved Issues

1. **Response contract violations** - Internal route migrated from raw `reply.send()` / manual status codes to standardized `reply.ok()` / `reply.fail()` contract (resolved 2026-02-01)
2. **Direct pino() usage** - `FirestoreUsageStatsRepository` replaced with `createAppLogger()` from `@intexuraos/infra-sentry` so errors are automatically forwarded to Sentry (resolved 2026-02-01)
3. **Inconsistent internal error format** - Internal pricing endpoint now returns `{ success: false, error: { code, message } }` instead of `{ error: string }` (resolved 2026-02-01)
4. **100% branch coverage** - Added v8 ignore exemptions for TypeScript-only safety branches; strict enforcement enabled (resolved 2026-02-02)
