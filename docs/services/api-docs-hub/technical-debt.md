# API Docs Hub - Technical Debt

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 1     | Low      |

## Active Items

### Health endpoint bypasses response contract

**Location:** `apps/api-docs-hub/src/server.ts:81-89`
**Severity:** Low (deliberate exception)

The `/health` endpoint uses `reply.send()` directly rather than `reply.ok()` / `reply.fail()`. This is intentional — health check response format must be stable and predictable for infrastructure monitoring tools, independent of app-level response envelope changes. However, this creates an undocumented exception to the response contract rule. A `// @allow-raw-send: health check format must be stable` comment would make the intent explicit.

## Future Plans

1. **Dynamic config** - Reload sources without redeployment
2. **Spec caching** - Cache specs to improve load time
3. **Auth helper** - Built-in token management
4. **Version selector** - Support multiple API versions
5. **Search across specs** - Global endpoint search

## Resolved Issues

1. **PromptVault reference removed** - Removed `INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL` after PromptVault feature was removed from the platform (INT-319, resolved 2026-01-27)
2. **Chat Agent added** - Added `INTEXURAOS_CHAT_AGENT_OPENAPI_URL` for new Intex Chat MVP feature (INT-431, resolved 2026-02-01)
3. **Dash0 OTel integration** - `@intexuraos/infra-otel` dependency added; log pipeline now forwards to Dash0 via OTLP (resolved 2026-02-16)
4. **Dev-mode log formatting** - `createLogStream()` now emits human-readable output under PM2, resolving the raw JSON noise in local development (resolved 2026-02-16)
