# Tier 3: New Infra Client Tests (research-agent)

## Status: PENDING

These are 0% coverage files in `apps/research-agent/src/infra/` that need new test files.

## Items

| # | File | Coverage | Gap | Lines | Status |
|---|------|----------|-----|-------|--------|
| 1 | `apps/research-agent/src/infra/action/commandsRouterClient.ts` | 0% | 59 lines | 13-55 | Pending |
| 2 | `apps/research-agent/src/infra/notification/whatsappNotificationSender.ts` | 0% | 46 lines | 13-46 | Pending |
| 3 | `apps/research-agent/src/infra/research/llmOrchestratorClient.ts` | 0% | 60 lines | 24-60 | Pending |

## Verification

```bash
npx vitest run --coverage apps/research-agent/src/__tests__/infra/
```

## Notes

These are HTTP client wrappers following established patterns. Tests should:
- Mock `fetch` using `vi.stubGlobal`
- Test successful responses
- Test HTTP error responses (non-ok status)
- Test network errors (fetch throws)
