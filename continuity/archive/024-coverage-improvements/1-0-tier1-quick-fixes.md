# Tier 1: Quick Fixes (< 5 mins each)

## Status: PENDING

Single line/branch coverage gaps that require minimal test additions.

## Items

| #  | File | Coverage | Gap | Uncovered | Status |
|----|------|----------|-----|-----------|--------|
| 1 | `apps/actions-agent/src/domain/usecases/retrySearchAction.ts` | 100%/83.33% | 1 branch | Line 8 | Pending |
| 2 | `apps/actions-agent/src/infra/action/commandsRouterClient.ts` | 100%/83.33% | 1 branch | Line 12 | Pending |
| 3 | `apps/actions-agent/src/infra/action/localActionServiceClient.ts` | 100%/87.5% | 1 branch | Line 9 | Pending |
| 4 | `apps/actions-agent/src/infra/firestore/actionRepository.ts` | 97.72%/91.66% | 1 line | Line 125 | Pending |
| 5 | `apps/actions-agent/src/infra/research/llmOrchestratorClient.ts` | 100%/90% | 1 branch | Line 8 | Pending |
| 6 | `apps/commands-router/src/infra/gemini/classifier.ts` | 97.43%/83.33% | 1 line | Line 135 | Pending |
| 7 | `apps/commands-router/src/infra/user/userServiceClient.ts` | 100%/87.5% | 1 branch | Line 39 | Pending |
| 8 | `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts` | 95.23%/90% | 1 line | Line 20 | Pending |
| 9 | `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts` | 95.23%/90% | 1 line | Line 20 | Pending |
| 10 | `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts` | 95.23%/90% | 1 line | Line 20 | Pending |
| 11 | `apps/llm-orchestrator/src/infra/notification/WhatsAppNotificationSender.ts` | 94.11%/80% | 1 line | Line 81 | Pending |
| 12 | `apps/llm-orchestrator/src/infra/research/researchRepository.ts` | 96.42%/95.23% | 2 lines | Lines 96, 132 | Pending |
| 13 | `apps/llm-orchestrator/src/domain/research/usecases/processResearch.ts` | 100%/92.85% | 1 branch | Line 61 | Pending |
| 14 | `apps/mobile-notifications-service/src/domain/notifications/usecases/sendNotification.ts` | 97.05%/100% | 1 line | Line 177 | Pending |
| 15 | `apps/mobile-notifications-service/src/infra/firestore/notificationRepository.ts` | 98.27%/91.66% | 1 line | Line 82 | Pending |
| 16 | `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts` | 100%/91.66% | 1 branch | Line 143 | Pending |
| 17 | `apps/notion-service/src/routes/integrationRoutes.ts` | 96.77%/93.33% | 1 line | Line 29 | Pending |
| 18 | `apps/notion-service/src/routes/internalRoutes.ts` | 100%/87.5% | 1 branch | Line 87 | Pending |
| 19 | `apps/promptvault-service/src/infra/firestore/promptRepository.ts` | 94.73%/100% | 1 line | Line 46 | Pending |
| 20 | `apps/promptvault-service/src/routes/promptRoutes.ts` | 98.48%/97.22% | 1 line | Line 280 | Pending |
| 21 | `apps/user-service/src/domain/settings/usecases/updateUserSettings.ts` | 94.73%/91.66% | 1 line | Line 88 | Pending |
| 22 | `apps/user-service/src/infra/firestore/encryption.ts` | 97.14%/92.3% | 1 line | Line 70 | Pending |
| 23 | `apps/user-service/src/routes/settingsRoutes.ts` | 97.14%/93.33% | 1 line | Line 40 | Pending |
| 24 | `apps/user-service/src/routes/tokenRoutes.ts` | 95.45%/91.66% | 1 line | Line 102 | Pending |

## Verification

```bash
npx vitest run --coverage <path/to/file.test.ts>
```
