# Task 1-0: Define Domain Models, Ports, and Errors

## Tier

1 (Independent Deliverables)

## Context

Infrastructure setup is complete. Now we implement the domain layer - the core business logic definitions that are independent of external systems.

## Problem Statement

Need to define the domain models for Linear issues, connection configuration, ports (interfaces) for repositories and clients, and error types.

## Scope

### In Scope

- `domain/models.ts` - LinearIssue, LinearConnection, ExtractedIssueData
- `domain/errors.ts` - LinearError types
- `domain/ports.ts` - Repository and client interfaces
- `domain/index.ts` - Re-exports

### Out of Scope

- Implementation of ports (infra layer)
- Use cases (later tasks)

## Required Approach

1. **Study** `apps/calendar-agent/src/domain/` for patterns
2. **Define** models matching Linear API responses
3. **Define** ports as interfaces (dependency inversion)
4. **Define** error codes matching patterns in other services

## Step Checklist

- [ ] Create `apps/linear-agent/src/domain/models.ts`
- [ ] Create `apps/linear-agent/src/domain/errors.ts`
- [ ] Create `apps/linear-agent/src/domain/ports.ts`
- [ ] Create `apps/linear-agent/src/domain/index.ts`
- [ ] Verify TypeScript compiles

## Definition of Done

- All domain files created
- Types are properly exported
- TypeScript compiles without errors

## Verification Commands

```bash
# TypeCheck
cd apps/linear-agent
pnpm run typecheck

# Return to root
cd ../..
```

## Rollback Plan

```bash
rm -rf apps/linear-agent/src/domain/
```

## Reference Files

- `apps/calendar-agent/src/domain/models.ts`
- `apps/calendar-agent/src/domain/errors.ts`
- `apps/calendar-agent/src/domain/ports.ts`

## domain/models.ts

```typescript
/**
 * Domain models for Linear integration.
 */

/** Linear issue priority values */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

/** Priority mapping: 0=none, 1=urgent, 2=high, 3=normal, 4=low */
export const PRIORITY_LABELS: Record<LinearPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

/** Linear issue state categories for dashboard grouping */
export type IssueStateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

/** Linear issue from API */
export interface LinearIssue {
  id: string;
  identifier: string; // e.g., "PBU-123"
  title: string;
  description: string | null;
  priority: LinearPriority;
  state: {
    id: string;
    name: string;
    type: IssueStateCategory;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Linear team from API */
export interface LinearTeam {
  id: string;
  name: string;
  key: string; // e.g., "PBU"
}

/** User's Linear connection configuration */
export interface LinearConnection {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public view of connection (no sensitive data) */
export interface LinearConnectionPublic {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a Linear issue */
export interface CreateIssueInput {
  title: string;
  description: string | null;
  priority: LinearPriority;
  teamId: string;
}

/** LLM-extracted issue data from user message */
export interface ExtractedIssueData {
  /** Issue title (required) */
  title: string;
  /** Priority level extracted from message */
  priority: LinearPriority;
  /** Functional requirements section */
  functionalRequirements: string | null;
  /** Technical details section */
  technicalDetails: string | null;
  /** Whether extraction was successful */
  valid: boolean;
  /** Error message if extraction failed */
  error: string | null;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

/** Failed issue creation for manual review */
export interface FailedLinearIssue {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: LinearPriority | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
}

/** Dashboard filter for issue states */
export type DashboardColumn = 'backlog' | 'in_progress' | 'in_review' | 'done';

/** Map Linear state types to dashboard columns */
export function mapStateToDashboardColumn(
  stateType: IssueStateCategory,
  stateName: string
): DashboardColumn {
  // In Review detection (Linear uses "started" type for these)
  if (stateName.toLowerCase().includes('review')) {
    return 'in_review';
  }

  switch (stateType) {
    case 'backlog':
    case 'unstarted':
      return 'backlog';
    case 'started':
      return 'in_progress';
    case 'completed':
    case 'cancelled':
      return 'done';
    default:
      return 'backlog';
  }
}
```

## domain/errors.ts

```typescript
/**
 * Error types for Linear integration.
 */

export type LinearErrorCode =
  | 'NOT_CONNECTED'
  | 'INVALID_API_KEY'
  | 'TEAM_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'API_ERROR'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL_ERROR';

export interface LinearError {
  code: LinearErrorCode;
  message: string;
}

export function createLinearError(code: LinearErrorCode, message: string): LinearError {
  return { code, message };
}
```

## domain/ports.ts

```typescript
/**
 * Ports (interfaces) for Linear integration.
 * These define contracts for infrastructure adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  LinearConnection,
  LinearConnectionPublic,
  LinearIssue,
  LinearTeam,
  CreateIssueInput,
  FailedLinearIssue,
  ExtractedIssueData,
} from './models.js';
import type { LinearError } from './errors.js';

/** Repository for Linear connection configuration */
export interface LinearConnectionRepository {
  /** Save or update a user's Linear connection */
  save(
    userId: string,
    apiKey: string,
    teamId: string,
    teamName: string
  ): Promise<Result<LinearConnectionPublic, LinearError>>;

  /** Get a user's connection (without API key) */
  getConnection(userId: string): Promise<Result<LinearConnectionPublic | null, LinearError>>;

  /** Get a user's API key (if connected) */
  getApiKey(userId: string): Promise<Result<string | null, LinearError>>;

  /** Get full connection data (internal use only) */
  getFullConnection(userId: string): Promise<Result<LinearConnection | null, LinearError>>;

  /** Check if user is connected */
  isConnected(userId: string): Promise<Result<boolean, LinearError>>;

  /** Disconnect user's Linear integration */
  disconnect(userId: string): Promise<Result<LinearConnectionPublic, LinearError>>;
}

/** Repository for failed issue creations */
export interface FailedIssueRepository {
  /** Save a failed issue for review */
  create(input: {
    userId: string;
    actionId: string;
    originalText: string;
    extractedTitle: string | null;
    extractedPriority: number | null;
    error: string;
    reasoning: string | null;
  }): Promise<Result<FailedLinearIssue, LinearError>>;

  /** List failed issues for a user */
  listByUser(userId: string): Promise<Result<FailedLinearIssue[], LinearError>>;

  /** Delete a failed issue (after resolution) */
  delete(id: string): Promise<Result<void, LinearError>>;
}

/** Client for Linear API operations */
export interface LinearApiClient {
  /** Validate an API key and return available teams */
  validateAndGetTeams(apiKey: string): Promise<Result<LinearTeam[], LinearError>>;

  /** Create a new issue */
  createIssue(apiKey: string, input: CreateIssueInput): Promise<Result<LinearIssue, LinearError>>;

  /** List issues for a team */
  listIssues(
    apiKey: string,
    teamId: string,
    options?: {
      /** Include completed issues from last N days */
      completedSinceDays?: number;
    }
  ): Promise<Result<LinearIssue[], LinearError>>;

  /** Get a single issue by ID */
  getIssue(apiKey: string, issueId: string): Promise<Result<LinearIssue | null, LinearError>>;
}

/** Service for extracting issue data from natural language */
export interface LinearActionExtractionService {
  /** Extract issue data from user message */
  extractIssue(userId: string, text: string): Promise<Result<ExtractedIssueData, LinearError>>;
}
```

## domain/index.ts

```typescript
/**
 * Domain layer exports for linear-agent.
 */

export * from './models.js';
export * from './errors.js';
export type {
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearApiClient,
  LinearActionExtractionService,
} from './ports.js';
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
