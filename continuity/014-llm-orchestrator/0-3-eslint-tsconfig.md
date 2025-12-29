# 0-3: ESLint & TSConfig

**Tier:** 0 - Setup & Infrastructure
**Status:** Pending

## Context

Adding the new service to root TypeScript project references and ESLint configuration.

## Problem Statement

The new service and packages need to be registered in:
- Root `tsconfig.json` references
- ESLint `no-restricted-imports` patterns
- ESLint boundaries configuration

## Scope

**In Scope:**
- Add llm-orchestrator-service to root tsconfig.json references
- Add new packages to tsconfig.json references
- Add to ESLint no-restricted-imports (block cross-app imports)
- Add to ESLint boundaries settings

**Out of Scope:**
- Service-specific ESLint rules
- TypeScript configuration within packages (handled in tier 1)

## Required Approach

1. Add project references for new service and packages
2. Add `@intexuraos/llm-orchestrator-service` to cross-app import restrictions
3. Add new package types to boundaries/elements

## Step Checklist

- [ ] Add `apps/llm-orchestrator-service` to tsconfig.json references
- [ ] Add `packages/infra-whatsapp` to tsconfig.json references
- [ ] Add `packages/infra-gemini` to tsconfig.json references
- [ ] Add `packages/infra-claude` to tsconfig.json references
- [ ] Add `packages/infra-gpt` to tsconfig.json references
- [ ] Add llm-orchestrator-service to ESLint no-restricted-imports
- [ ] Add new package types to boundaries/elements
- [ ] Run `npm run lint` to verify

## Definition of Done

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Cross-app imports blocked for new service

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Revert changes to `tsconfig.json` and `eslint.config.js`.
