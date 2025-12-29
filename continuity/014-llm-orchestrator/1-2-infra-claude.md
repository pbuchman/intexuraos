# 1-2: infra-claude Package

**Tier:** 1 - Shared Packages (Independent)
**Status:** Pending

## Context

Create Claude API adapter package with web search capabilities for deep research.

## Problem Statement

Need a reusable Claude client that can perform deep research with web search tool use.

## Scope

**In Scope:**
- Create `packages/infra-claude/` package
- Define `ClaudeClient` interface
- Implement Claude API client with computer use/web tools
- Support both research mode and validation mode

**Out of Scope:**
- Other Claude features (vision, embeddings)
- Computer use beyond web search
- Rate limiting (handled at service level)

## Required Approach

1. Create package structure
2. Use `@anthropic-ai/sdk` SDK
3. Configure web search tool
4. Return structured response with result and sources

## Step Checklist

- [ ] Create `packages/infra-claude/` directory
- [ ] Create `package.json` with `@anthropic-ai/sdk` dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/ports/ClaudeClient.ts` interface
- [ ] Create `src/ClaudeApiClient.ts` implementation
- [ ] Implement `research()` method with web search tool
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
npm run typecheck --workspace=@intexuraos/infra-claude
npm run test --workspace=@intexuraos/infra-claude
```

## Rollback Plan

Delete package directory.
