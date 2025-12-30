# Testing Guide

## Overview

IntexuraOS uses **in-memory fake repositories** via dependency injection. No external services required to run tests.

- Tests do NOT require `gcloud`, Firebase emulator, or cloud connectivity
- All Firestore operations mocked via fake repositories
- All external HTTP calls mocked via `nock`

## Commands

```bash
npm run test              # Single run
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
npx vitest path/to/file   # Run single test file
npx vitest -t "pattern"   # Run tests matching pattern
npm run ci                # Full CI pipeline (lint, typecheck, test, build)
```

## Coverage Thresholds

Current values in `vitest.config.ts`:

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | 95%       |
| Branches   | 95%       |
| Functions  | 95%       |
| Statements | 95%       |

**Coverage failures must be fixed by writing tests, not by modifying thresholds or exclusions.**

## Mocking Strategy

| Dependency    | Approach                                                  |
| ------------- | --------------------------------------------------------- |
| Firestore     | Fake repository in `apps/*/src/__tests__/fakes.ts`        |
| Auth0         | Fake client in `apps/user-service/src/__tests__/fakes.ts` |
| Notion        | Fake adapter in `apps/*/src/__tests__/fakes.ts`           |
| External HTTP | Mocked via `nock`, no real calls in unit tests            |

## Test Setup Pattern

Routes obtain dependencies via `getServices()`, allowing fake injection in tests:

```typescript
import { setServices, resetServices } from '../services.js';
import { FakeRepository } from './fakes.js';

describe('MyRoute', () => {
  let fakeRepo: FakeRepository;

  beforeEach(() => {
    fakeRepo = new FakeRepository();
    setServices({ repository: fakeRepo });
  });

  afterEach(() => {
    resetServices();
  });

  it('should do something', async () => {
    // Arrange
    fakeRepo.addItem({ id: '1', name: 'test' });

    // Act
    const result = await myRoute.handler();

    // Assert
    expect(result).toBeDefined();
  });
});
```

## Test Architecture

| Component                | Test Strategy                                               |
| ------------------------ | ----------------------------------------------------------- |
| Routes (`src/routes/**`) | Integration tests via `app.inject()` with fake repositories |
| Domain (`src/domain/**`) | Unit tests with fake ports                                  |
| Infra (`src/infra/**`)   | Tested indirectly through route integration tests           |

## Writing Effective Tests

### Do

- Test behavior, not implementation details
- Use descriptive test names: `it('returns 404 when user not found')`
- Set up minimal fixtures needed for each test
- Clean up state in `afterEach`

### Don't

- Make real HTTP calls in unit tests
- Test private methods directly
- Share mutable state between tests
- Skip coverage requirements
