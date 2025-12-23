# Coverage Improvement Plan - Phase 2 (90% Target)

This directory contains LLM-executable issue prompts for raising test coverage from ~84% to 90%.

## Current State

- **Current coverage**: 83.67% lines, 75.36% branches, 67.17% functions
- **Current thresholds**: 80/72/65/80 (lines/branches/functions/statements)
- **Target thresholds**: 90/85/85/90
- **Test runner**: Vitest with v8 coverage provider
- **Test command**: `npm run test:coverage`

## Key Coverage Gaps

Based on coverage analysis from December 2025:

| File/Area                   | Current | Target | Gap    |
| --------------------------- | ------- | ------ | ------ |
| tokenRoutes.ts              | 53.9%   | 90%+   | 36.1%  |
| processWhatsAppWebhook.ts   | 27.11%  | 85%+   | 57.9%  |
| UpdatePromptUseCase.ts      | 52.72%  | 85%+   | 32.3%  |
| GetPromptUseCase.ts         | 63.63%  | 85%+   | 21.4%  |
| whatsapp mappingRoutes.ts   | 76.89%  | 90%+   | 13.1%  |
| whatsapp webhookRoutes.ts   | 72.37%  | 90%+   | 17.6%  |
| notion-service shared.ts    | 20%     | 85%+   | 65%    |
| auth-service shared.ts      | 75%     | 90%+   | 15%    |
| auth-service deviceRoutes.ts| 81.67%  | 90%+   | 8.3%   |

## Dependency Structure

```
Tier 0 (Independent - No Dependencies)
├── 0-0-review-exclusions.md           # Review if any exclusions can be removed
└── 0-1-test-utility-improvements.md   # Improve shared test patterns
        │
        ▼ (all Tier 0 must be complete)
Tier 1 (Depends on ALL Tier 0)
├── 1-0-token-routes-coverage.md       # auth-service tokenRoutes 53% → 90%
├── 1-1-whatsapp-webhook-usecase.md    # processWhatsAppWebhook 27% → 85%
├── 1-2-promptvault-usecases.md        # UpdatePrompt/GetPrompt usecases
├── 1-3-whatsapp-routes.md             # mappingRoutes, webhookRoutes
├── 1-4-notion-service-shared.md       # shared.ts 20% → 85%
└── 1-5-auth-service-remaining.md      # shared.ts, deviceRoutes gaps
        │
        ▼ (all Tier 0 + Tier 1 must be complete)
Tier 2 (Depends on ALL Tier 0 + Tier 1)
└── 2-0-raise-thresholds-90.md         # Update vitest.config.ts to 90/85/85/90
```

## Execution Instructions

1. Complete all Tier 0 issues in any order (they are independent)
2. Complete all Tier 1 issues (can be done in parallel after Tier 0)
3. Complete Tier 2 as the final step

Each issue file is self-contained. To execute:

1. Read the issue file completely
2. Verify prerequisites are met (check the Prerequisites section)
3. Follow the steps in order
4. Run verification commands
5. Ensure all "Definition of Done" items are checked
6. Run `npm run ci` as final verification

## Verification

Run after completing each issue:

===
npm run test:coverage
npm run ci
===

