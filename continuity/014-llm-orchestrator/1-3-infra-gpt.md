# 1-3: infra-gpt Package

**Tier:** 1 - Shared Packages (Independent)
**Status:** Pending

## Context

Create OpenAI GPT API adapter package with web browsing capabilities for deep research.

## Problem Statement

Need a reusable GPT client that can perform deep research with web browsing.

## Scope

**In Scope:**
- Create `packages/infra-gpt/` package
- Define `GptClient` interface
- Implement OpenAI API client with web browsing
- Support both research mode and validation mode

**Out of Scope:**
- Other OpenAI features (DALL-E, embeddings, Whisper)
- Rate limiting (handled at service level)

## Required Approach

1. Create package structure
2. Use `openai` SDK
3. Configure web browsing tool (if available) or web search function
4. Return structured response with result and sources

## Step Checklist

- [ ] Create `packages/infra-gpt/` directory
- [ ] Create `package.json` with `openai` dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/ports/GptClient.ts` interface
- [ ] Create `src/GptApiClient.ts` implementation
- [ ] Research actual web browsing capability in OpenAI API
- [ ] Implement `research()` method
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
npm run typecheck --workspace=@intexuraos/infra-gpt
npm run test --workspace=@intexuraos/infra-gpt
```

## Rollback Plan

Delete package directory.
