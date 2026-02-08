# API Docs Hub - Technical Debt

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 0     | -        |

## Future Plans

1. **Dynamic config** - Reload sources without redeployment
2. **Spec caching** - Cache specs to improve load time
3. **Auth helper** - Built-in token management
4. **Version selector** - Support multiple API versions
5. **Search across specs** - Global endpoint search

## Resolved Issues

1. **PromptVault reference removed** - Removed `INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL` after PromptVault feature was removed from the platform (INT-319, resolved 2026-01-27)
2. **Chat Agent added** - Added `INTEXURAOS_CHAT_AGENT_OPENAPI_URL` for new Intex Chat MVP feature (INT-431, resolved 2026-02-01)
