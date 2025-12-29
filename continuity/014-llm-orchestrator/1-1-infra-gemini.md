# 1-1: infra-gemini Package

**Tier:** 1 - Shared Packages (Independent)
**Status:** Pending

## Context

Create Gemini API adapter package with Google Search grounding for deep research.

## Problem Statement

Need a reusable Gemini client that can perform deep research with web search capabilities.

## Scope

**In Scope:**
- Create `packages/infra-gemini/` package
- Define `GeminiClient` interface
- Implement Gemini API client with search grounding
- Support both research mode and validation mode (cheap/fast)

**Out of Scope:**
- Other Gemini features (vision, embeddings)
- Rate limiting (handled at service level)

## Required Approach

1. Create package structure
2. Use `@google/generative-ai` SDK
3. Configure search grounding tool
4. Return structured response with result and sources

## Step Checklist

- [ ] Create `packages/infra-gemini/` directory
- [ ] Create `package.json` with `@google/generative-ai` dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/ports/GeminiClient.ts` interface
- [ ] Create `src/GeminiApiClient.ts` implementation
- [ ] Implement `research()` method with search grounding
- [ ] Implement `validate()` method for API key validation
- [ ] Create `src/index.ts` exports
- [ ] Add tests

## Definition of Done

- [ ] Package compiles without errors
- [ ] `research()` returns result with sources
- [ ] `validate()` works for API key testing
- [ ] Tests pass

## Verification Commands

```bash
npm install
npm run typecheck --workspace=@intexuraos/infra-gemini
npm run test --workspace=@intexuraos/infra-gemini
```

## Rollback Plan

Delete package directory.
