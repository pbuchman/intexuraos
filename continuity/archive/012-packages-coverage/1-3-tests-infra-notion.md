# Task 1-3: Tests for infra-notion

## Tier

1 - Independent deliverable

## Context

packages/infra-notion contains:

- notion.ts: Notion client utilities, error mapping, token validation, page retrieval
- notionConnection.ts: Firestore repository for Notion connections

## Problem Statement

No tests exist for infra-notion. Need high coverage.

## Scope

- packages/infra-notion/src/**tests**/notion.test.ts
- packages/infra-notion/src/**tests**/notionConnection.test.ts

## Non-Scope

- index.ts (barrel file)

## Required Approach

### notion.test.ts

- Test mapNotionError with Unauthorized error
- Test mapNotionError with ObjectNotFound error
- Test mapNotionError with RateLimited error
- Test mapNotionError with ValidationError/InvalidJSON
- Test mapNotionError with unknown error codes
- Test mapNotionError with non-Notion errors
- Test createNotionClient without logger
- Test createNotionClient with logger
- Test validateNotionToken success path
- Test validateNotionToken with unauthorized token
- Test validateNotionToken with API error
- Test getPageWithPreview success
- Test getPageWithPreview with unexpected format
- Test getPageWithPreview with API error
- Test extractPageTitle with various property names
- Test extractPageTitle fallback to 'Untitled'

### notionConnection.test.ts

Use FakeFirestore for all tests:

- Test saveNotionConnection creates new connection
- Test saveNotionConnection preserves createdAt on update
- Test getNotionConnection returns null when not exists
- Test getNotionConnection returns public data (no token)
- Test getNotionToken returns token when connected
- Test getNotionToken returns null when not connected
- Test isNotionConnected returns true/false
- Test disconnectNotion sets connected=false
- Test error handling paths

## Step Checklist

- [ ] Create notion.test.ts with comprehensive tests
- [ ] Create notionConnection.test.ts using FakeFirestore
- [ ] Run tests and verify pass

## Definition of Done

All infra-notion modules have high test coverage (>90%)

## Verification Commands

```bash
npm run test -- packages/infra-notion --coverage
```

## Rollback Plan

Delete test files if task fails
