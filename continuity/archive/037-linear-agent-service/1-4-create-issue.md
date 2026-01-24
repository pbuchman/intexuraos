# Task 1-4: Implement Create Issue Use Case

## Tier

1 (Independent Deliverables)

## Context

All infrastructure components are ready. Now implement the main use case: processing a linear action from natural language.

## Problem Statement

Need to implement `processLinearAction` use case that:

1. Extracts issue data from user's message using LLM
2. Creates the issue in Linear via API
3. Saves failed extractions for manual review
4. Returns success/failure status

## Scope

### In Scope

- `processLinearAction` use case
- Build structured description from extracted data
- Handle extraction failures (save to failed_issues)
- Handle API failures

### Out of Scope

- HTTP routing (next tier)
- Action status updates (done by actions-agent)

## Required Approach

1. **Study** `apps/calendar-agent/src/domain/useCases/processCalendarAction.ts`
2. **Implement** the use case with same structure
3. **Build** markdown description from functional/technical sections
4. **Handle** all error cases
5. **Write comprehensive tests**

## Step Checklist

- [ ] Create `apps/linear-agent/src/domain/useCases/processLinearAction.ts`
- [ ] Implement description builder (structured markdown)
- [ ] Handle extraction failures
- [ ] Handle API failures
- [ ] Create `apps/linear-agent/src/__tests__/domain/useCases/processLinearAction.test.ts`
- [ ] Ensure tests pass with coverage
- [ ] Export from domain/index.ts

## Definition of Done

- Use case handles all success and failure paths
- Description is properly formatted markdown
- Tests cover all branches
- TypeScript compiles

## Verification Commands

```bash
cd apps/linear-agent
pnpm run typecheck
pnpm vitest run src/__tests__/domain/useCases/processLinearAction.test.ts
cd ../..
```

## Rollback Plan

```bash
rm -rf apps/linear-agent/src/domain/useCases/
```

## Reference Files

- `apps/calendar-agent/src/domain/useCases/processCalendarAction.ts`

## domain/useCases/processLinearAction.ts

```typescript
/**
 * Process Linear Action Use Case
 *
 * Handles natural language Linear issue creation by:
 * 1. Extracting issue data from text using LLM
 * 2. Creating the issue in Linear if valid
 * 3. Saving failed extractions for manual review
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearActionExtractionService,
  ExtractedIssueData,
  LinearPriority,
} from '../index.js';

export interface ProcessLinearActionDeps {
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  failedIssueRepository: FailedIssueRepository;
  extractionService: LinearActionExtractionService;
  logger?: Logger;
}

export interface ProcessLinearActionRequest {
  actionId: string;
  userId: string;
  text: string;
}

export interface ProcessLinearActionResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  issueIdentifier?: string;
  error?: string;
}

/**
 * Build structured markdown description from extracted data.
 */
function buildDescription(extracted: ExtractedIssueData): string | null {
  const sections: string[] = [];

  if (extracted.functionalRequirements !== null) {
    sections.push(`## Functional Requirements\n\n${extracted.functionalRequirements}`);
  }

  if (extracted.technicalDetails !== null) {
    sections.push(`## Technical Details\n\n${extracted.technicalDetails}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join('\n\n');
}

export async function processLinearAction(
  request: ProcessLinearActionRequest,
  deps: ProcessLinearActionDeps
): Promise<Result<ProcessLinearActionResponse, LinearError>> {
  const { actionId, userId, text } = request;
  const {
    linearApiClient,
    connectionRepository,
    failedIssueRepository,
    extractionService,
    logger,
  } = deps;

  logger?.info({ userId, actionId, textLength: text.length }, 'processLinearAction: entry');

  // Get user's connection
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    logger?.error({ userId, actionId, error: connectionResult.error }, 'Failed to get connection');
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    logger?.warn({ userId, actionId }, 'User not connected to Linear');
    return err({
      code: 'NOT_CONNECTED',
      message: 'Linear not connected. Please configure in settings.',
    });
  }

  // Extract issue data using LLM
  const extractResult = await extractionService.extractIssue(userId, text);
  if (!extractResult.ok) {
    logger?.error({ userId, actionId, error: extractResult.error }, 'Extraction failed');

    // Save as failed issue for review
    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: null,
      extractedPriority: null,
      error: extractResult.error.message,
      reasoning: null,
    });

    return ok({
      status: 'failed',
      error: extractResult.error.message,
    });
  }

  const extracted = extractResult.value;
  logger?.info(
    { userId, actionId, title: extracted.title, valid: extracted.valid },
    'Extraction complete'
  );

  // Handle invalid extraction
  if (!extracted.valid) {
    const errorMessage = extracted.error ?? 'Could not extract valid issue from message';
    logger?.info({ userId, actionId, error: errorMessage }, 'Invalid extraction');

    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: extracted.title,
      extractedPriority: extracted.priority,
      error: errorMessage,
      reasoning: extracted.reasoning,
    });

    return ok({
      status: 'failed',
      error: errorMessage,
    });
  }

  // Build description from extracted sections
  const description = buildDescription(extracted);

  // Create issue in Linear
  logger?.info({ userId, actionId, title: extracted.title }, 'Creating Linear issue');

  const createResult = await linearApiClient.createIssue(connection.apiKey, {
    title: extracted.title,
    description,
    priority: extracted.priority as LinearPriority,
    teamId: connection.teamId,
  });

  if (!createResult.ok) {
    logger?.error({ userId, actionId, error: createResult.error }, 'Linear API creation failed');

    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: extracted.title,
      extractedPriority: extracted.priority,
      error: createResult.error.message,
      reasoning: extracted.reasoning,
    });

    return ok({
      status: 'failed',
      error: createResult.error.message,
    });
  }

  const createdIssue = createResult.value;
  logger?.info(
    { userId, actionId, issueId: createdIssue.id, identifier: createdIssue.identifier },
    'Issue created successfully'
  );

  return ok({
    status: 'completed',
    resourceUrl: createdIssue.url,
    issueIdentifier: createdIssue.identifier,
  });
}
```

## Update domain/index.ts

Add export:

```typescript
export {
  processLinearAction,
  type ProcessLinearActionDeps,
  type ProcessLinearActionRequest,
  type ProcessLinearActionResponse,
} from './useCases/processLinearAction.js';
```

## Test file structure

Create comprehensive tests covering:

1. Successful issue creation
2. User not connected
3. Extraction failure
4. Invalid extraction (valid=false)
5. Linear API failure
6. All failure cases save to failed_issues repository

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
