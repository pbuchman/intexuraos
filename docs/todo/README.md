# Coverage Improvement Plan

This directory contains LLM-executable issue prompts for raising test coverage from 65% to 90%.

## Current State

- **Current thresholds**: 65/70/45/65 (lines/branches/functions/statements)
- **Target thresholds**: 89/85/90/89
- **Test runner**: Vitest with v8 coverage provider
- **Test command**: `npm run test:coverage`

## Dependency Structure

Issues are organized by tier. **Complete ALL issues in a tier before moving to the next.**

```
Tier 0 (Independent)
├── 0-0-narrow-coverage-exclusions.md
├── 0-1-common-package-coverage.md
└── 0-2-standardize-test-utilities.md
        │
        ▼ (all Tier 0 must be complete)
Tier 1 (Depends on ALL Tier 0)
├── 1-0-auth-service-token-routes.md
├── 1-1-auth-service-device-routes.md
├── 1-2-auth-service-shared-httpclient.md
├── 1-3-promptvault-usecases.md
├── 1-4-whatsapp-webhook-usecase.md
├── 1-5-whatsapp-routes.md
├── 1-6-whatsapp-config-signature.md
├── 1-7-notion-service-coverage.md
└── 1-8-server-initialization.md
        │
        ▼ (all Tier 0 + Tier 1 must be complete)
Tier 2 (Depends on ALL Tier 0 + Tier 1)
├── 2-0-infra-adapters-coverage.md
└── 2-1-raise-coverage-thresholds.md
```

## Issue Summary

### Tier 0 - Foundational (3 issues, independent of each other)

| File                                | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `0-0-narrow-coverage-exclusions.md` | Analyze and narrow overly broad exclusions |
| `0-1-common-package-coverage.md`    | Add tests for packages/common utilities    |
| `0-2-standardize-test-utilities.md` | Review and document test utility patterns  |

### Tier 1 - Feature Coverage (9 issues, depend on ALL Tier 0)

| File                                    | Target    | Description                      |
| --------------------------------------- | --------- | -------------------------------- |
| `1-0-auth-service-token-routes.md`      | 43% → 85% | Token refresh routes             |
| `1-1-auth-service-device-routes.md`     | 77% → 90% | Device authorization routes      |
| `1-2-auth-service-shared-httpclient.md` | 75% → 95% | Shared utilities and HTTP client |
| `1-3-promptvault-usecases.md`           | 45% → 85% | Domain use cases                 |
| `1-4-whatsapp-webhook-usecase.md`       | 27% → 80% | Webhook processing logic         |
| `1-5-whatsapp-routes.md`                | 66% → 90% | WhatsApp routes                  |
| `1-6-whatsapp-config-signature.md`      | 70% → 95% | Config and signature validation  |
| `1-7-notion-service-coverage.md`        | 20% → 90% | Notion service routes            |
| `1-8-server-initialization.md`          | 90% → 95% | Server startup paths             |

### Tier 2 - Infrastructure & Finalization (2 issues, depend on ALL prior)

| File                               | Description                                     |
| ---------------------------------- | ----------------------------------------------- |
| `2-0-infra-adapters-coverage.md`   | Remove exclusion and add infra adapter tests    |
| `2-1-raise-coverage-thresholds.md` | Restore 90% thresholds after all tests complete |

## How to Execute
1. **Any issue marked [completed] is considered done.**
2  **Start with Tier 0** - Complete all three 0-\* issues in any order
3  **Then Tier 1** - Complete all nine 1-\* issues (can be done in parallel)
4  **Then Tier 2** - Complete 2-0 first, then 2-1 as the final step

Each issue file is self-contained. To execute:

1. Read the issue file completely
2. Verify prerequisites are met (check the Prerequisites section)
3. Follow the steps in order
4. Run verification commands
5. Ensure all "Definition of Done" items are checked
6. Run `npm run ci` as final verification
7. Mark the issue as [completed] so the list is idempotent and can be executed by LLM multiple times, starting from any point

## Key Coverage Gaps

| Area                      | Current  | Target | Issue                            |
| ------------------------- | -------- | ------ | -------------------------------- |
| tokenRoutes.ts            | 43.97%   | 85%+   | 1-0-auth-service-token-routes.md |
| processWhatsAppWebhook.ts | 27.11%   | 80%+   | 1-4-whatsapp-webhook-usecase.md  |
| promptvault usecases      | 45-66%   | 85%+   | 1-3-promptvault-usecases.md      |
| notion-service shared.ts  | 20%      | 80%+   | 1-7-notion-service-coverage.md   |
| All infra adapters        | excluded | 80%+   | 2-0-infra-adapters-coverage.md   |

## Verification

Run after completing each issue:

```bash
npm run test:coverage
npm run ci
```
