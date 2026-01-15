# Task 1-3: Create LLM Extraction Service for Issues

## Tier

1 (Independent Deliverables)

## Context

Linear API client is implemented. Now create the LLM extraction service that parses natural language into structured issue data.

## Problem Statement

Need to implement `LinearActionExtractionService` that uses LLM to extract:

- Issue title
- Priority level
- Functional requirements
- Technical details

This follows the same pattern as `calendarActionExtractionService` in calendar-agent.

## Scope

### In Scope

- Create extraction prompt in `@intexuraos/llm-common` package
- Implement extraction service using LLM client
- Parse and validate LLM response
- Handle extraction errors

### Out of Scope

- LLM client implementation (use existing llm-factory)
- User API key retrieval (done in use case layer)

## Required Approach

1. **Study** `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts`
2. **Study** `packages/llm-common/src/classification/calendarActionExtractionPrompt.ts`
3. **Create** new prompt in llm-common package
4. **Implement** extraction service following calendar pattern
5. **Write tests** for extraction logic

## Step Checklist

- [ ] Create `packages/llm-common/src/classification/linearActionExtractionPrompt.ts`
- [ ] Export from `packages/llm-common/src/classification/index.ts`
- [ ] Export from `packages/llm-common/src/index.ts`
- [ ] Create `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`
- [ ] Create `apps/linear-agent/src/infra/user/llmUserServiceClient.ts` (copy from calendar-agent)
- [ ] Add FakeLinearActionExtractionService to fakes.ts
- [ ] Create tests for extraction service
- [ ] Ensure tests pass

## Definition of Done

- Prompt extracts title, priority, functional/technical details
- Extraction service handles LLM responses
- Tests cover success and error cases
- TypeScript compiles in both packages

## Verification Commands

```bash
# TypeCheck llm-common
cd packages/llm-common
pnpm run typecheck

# TypeCheck linear-agent
cd ../../apps/linear-agent
pnpm run typecheck

# Run tests
pnpm vitest run src/__tests__/infra/linearActionExtractionService.test.ts

cd ../..
```

## Rollback Plan

```bash
rm packages/llm-common/src/classification/linearActionExtractionPrompt.ts
rm apps/linear-agent/src/infra/llm/
rm apps/linear-agent/src/infra/user/
```

## Reference Files

- `packages/llm-common/src/classification/calendarActionExtractionPrompt.ts`
- `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts`
- `apps/calendar-agent/src/infra/user/llmUserServiceClient.ts`

## packages/llm-common/src/classification/linearActionExtractionPrompt.ts

```typescript
/**
 * Linear issue extraction prompt for parsing natural language into structured issue data.
 * Used by linear-agent to extract issue details from user messages.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface LinearIssueExtractionPromptInput {
  /** The user message to extract issue from */
  text: string;
}

export interface LinearIssueExtractionPromptDeps extends PromptDeps {
  /** Maximum description length (default: 2000) */
  maxDescriptionLength?: number;
}

/**
 * Extracted Linear issue data.
 */
export interface ExtractedLinearIssue {
  /** Issue title (required) */
  title: string;
  /** Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low */
  priority: 0 | 1 | 2 | 3 | 4;
  /** Functional requirements extracted from message */
  functionalRequirements: string | null;
  /** Technical details extracted from message */
  technicalDetails: string | null;
  /** Whether extraction was successful */
  valid: boolean;
  /** Error message if extraction failed */
  error: string | null;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

export const linearActionExtractionPrompt: PromptBuilder<
  LinearIssueExtractionPromptInput,
  LinearIssueExtractionPromptDeps
> = {
  name: 'linear-action-extraction',
  description: 'Extracts structured Linear issue data from natural language text',

  build(input: LinearIssueExtractionPromptInput, deps?: LinearIssueExtractionPromptDeps): string {
    const maxLength = deps?.maxDescriptionLength ?? 2000;
    const textPreview = input.text.length > maxLength ? input.text.slice(0, maxLength) : input.text;

    const truncationWarning =
      input.text.length > maxLength
        ? `\n\n⚠️ IMPORTANT: Text was truncated to first ${String(maxLength)} characters.\n`
        : '';

    return `Extract Linear issue information from the user's message.

TASK: Parse the message and create a structured issue with title, priority, and organized description.

RULES:
1. LANGUAGE: Maintain the SAME LANGUAGE as the user's message
   - English message → English title/description
   - Polish message → Polish title/description

2. TITLE EXTRACTION:
   - Create a clear, concise title (max 100 characters)
   - Focus on the main task or feature
   - Remove filler words like "please", "I want to"

3. PRIORITY DETECTION:
   - 0 = No priority (default if not mentioned)
   - 1 = Urgent (keywords: urgent, asap, critical, immediately, pilne, natychmiast)
   - 2 = High (keywords: high priority, important, ważne, priorytet)
   - 3 = Normal (default for most tasks)
   - 4 = Low (keywords: when you have time, low priority, niska priorytet)

4. DESCRIPTION EXTRACTION:
   Split the content into two sections when applicable:

   ## Functional Requirements
   - What the feature/fix should DO from user perspective
   - User-visible behavior changes
   - Acceptance criteria if mentioned

   ## Technical Details
   - Implementation hints or constraints
   - Technical context mentioned
   - Files, APIs, or systems referenced

   If no clear technical details, leave technicalDetails as null.
   If no clear functional requirements beyond the title, leave functionalRequirements as null.

5. VALIDATION:
   - valid = true if at least a title can be extracted
   - valid = false only if message is completely unclear/empty

EXAMPLES (ENGLISH):

Input: "Add dark mode toggle to settings page, should persist in local storage"
Output:
{
  "title": "Add dark mode toggle to settings",
  "priority": 0,
  "functionalRequirements": "- Add toggle switch for dark/light mode in settings page\\n- User preference should persist across sessions",
  "technicalDetails": "- Store preference in local storage",
  "valid": true,
  "error": null,
  "reasoning": "Clear feature request with user-visible behavior and technical implementation detail"
}

Input: "URGENT: Fix login button not working on mobile"
Output:
{
  "title": "Fix login button not working on mobile",
  "priority": 1,
  "functionalRequirements": "- Login button should be clickable and functional on mobile devices\\n- Should trigger same login flow as desktop",
  "technicalDetails": null,
  "valid": true,
  "error": null,
  "reasoning": "Bug report marked as urgent, extracted functional requirement from issue description"
}

Input: "Research best practices for API rate limiting"
Output:
{
  "title": "Research API rate limiting best practices",
  "priority": 0,
  "functionalRequirements": null,
  "technicalDetails": "- Research task, no implementation yet\\n- Focus on API rate limiting strategies",
  "valid": true,
  "error": null,
  "reasoning": "Research task with technical focus, no functional requirements as it's not a feature"
}

EXAMPLES (POLISH):

Input: "Dodaj możliwość eksportu danych do CSV, ważne dla raportu w piątek"
Output:
{
  "title": "Dodaj eksport danych do CSV",
  "priority": 2,
  "functionalRequirements": "- Użytkownik może eksportować dane do pliku CSV\\n- Dostępne z poziomu interfejsu raportowania",
  "technicalDetails": null,
  "valid": true,
  "error": null,
  "reasoning": "Funkcjonalność oznaczona jako ważna (priorytet wysoki), jasne wymaganie funkcjonalne"
}

Input: "Napraw błąd w walidacji formularza rejestracji, sprawdź regex dla numeru telefonu"
Output:
{
  "title": "Napraw walidację numeru telefonu w rejestracji",
  "priority": 0,
  "functionalRequirements": "- Numer telefonu powinien być poprawnie walidowany w formularzu rejestracji",
  "technicalDetails": "- Sprawdzić i poprawić wyrażenie regularne (regex) dla walidacji numeru telefonu",
  "valid": true,
  "error": null,
  "reasoning": "Zgłoszenie błędu z kontekstem technicznym (regex)"
}

${truncationWarning}
USER MESSAGE TO PROCESS:
${textPreview}

Respond with ONLY a JSON object in the format shown above. Do not include any additional text.`;
  },
};
```

## Update packages/llm-common/src/classification/index.ts

Add exports:

```typescript
export {
  linearActionExtractionPrompt,
  type LinearIssueExtractionPromptInput,
  type LinearIssueExtractionPromptDeps,
  type ExtractedLinearIssue,
} from './linearActionExtractionPrompt.js';
```

## Update packages/llm-common/src/index.ts

Add exports:

```typescript
export {
  linearActionExtractionPrompt,
  type LinearIssueExtractionPromptInput,
  type LinearIssueExtractionPromptDeps,
  type ExtractedLinearIssue,
} from './classification/index.js';
```

## apps/linear-agent/src/infra/llm/linearActionExtractionService.ts

````typescript
/**
 * LLM-based extraction service for Linear issues.
 * Parses natural language into structured issue data.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { linearActionExtractionPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LlmUserServiceClient } from '../user/llmUserServiceClient.js';
import type { ExtractedIssueData, LinearError } from '../../domain/index.js';
import pino from 'pino';

const MAX_DESCRIPTION_LENGTH = 2000;

type MinimalLogger = pino.Logger;

const defaultLogger: MinimalLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'linearActionExtractionService',
}) as unknown as MinimalLogger;

export interface LinearActionExtractionService {
  extractIssue(userId: string, text: string): Promise<Result<ExtractedIssueData, LinearError>>;
}

export function createLinearActionExtractionService(
  llmUserServiceClient: LlmUserServiceClient,
  logger?: MinimalLogger
): LinearActionExtractionService {
  const log: MinimalLogger = logger ?? defaultLogger;

  return {
    async extractIssue(
      userId: string,
      text: string
    ): Promise<Result<ExtractedIssueData, LinearError>> {
      log.info({ userId, textLength: text.length }, 'Starting LLM issue extraction');

      const clientResult = await llmUserServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          log.warn({ userId }, 'No API key configured for LLM extraction');
          return err({ code: 'NOT_CONNECTED', message: error.message });
        }
        log.error({ userId, error: error.message }, 'Failed to get LLM client');
        return err({ code: 'INTERNAL_ERROR', message: error.message });
      }

      const llmClient: LlmGenerateClient = clientResult.value;

      const prompt = linearActionExtractionPrompt.build(
        { text },
        { maxDescriptionLength: MAX_DESCRIPTION_LENGTH }
      );

      log.info({ userId, promptLength: prompt.length }, 'Sending LLM generation request');

      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        log.error({ userId, error: result.error.message }, 'LLM generation failed');
        return err({ code: 'EXTRACTION_FAILED', message: result.error.message });
      }

      log.info(
        { userId, responseLength: result.value.content.length },
        'LLM generation successful'
      );

      // Clean response (remove markdown code blocks if present)
      let cleaned = result.value.content.trim();
      const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
      const codeBlockMatch = codeBlockRegex.exec(cleaned);
      if (codeBlockMatch?.[1] !== undefined) {
        cleaned = codeBlockMatch[1].trim();
      }

      try {
        const parsed = JSON.parse(cleaned) as unknown;

        if (!isValidExtractionResponse(parsed)) {
          log.error({ userId, rawPreview: cleaned.slice(0, 500) }, 'Invalid response format');
          return err({ code: 'EXTRACTION_FAILED', message: 'Invalid LLM response format' });
        }

        const extracted = parsed as ExtractedIssueData;
        log.info({ userId, title: extracted.title, valid: extracted.valid }, 'Extraction complete');

        return ok(extracted);
      } catch (error) {
        log.error({ userId, parseError: getErrorMessage(error) }, 'Failed to parse LLM response');
        return err({
          code: 'EXTRACTION_FAILED',
          message: `Failed to parse: ${getErrorMessage(error)}`,
        });
      }
    },
  };
}

function isValidExtractionResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj['title'] !== 'string') return false;
  if (typeof obj['priority'] !== 'number') return false;
  if (obj['priority'] < 0 || obj['priority'] > 4) return false;
  if (obj['functionalRequirements'] !== null && typeof obj['functionalRequirements'] !== 'string')
    return false;
  if (obj['technicalDetails'] !== null && typeof obj['technicalDetails'] !== 'string') return false;
  if (typeof obj['valid'] !== 'boolean') return false;
  if (obj['error'] !== null && typeof obj['error'] !== 'string') return false;
  if (typeof obj['reasoning'] !== 'string') return false;

  return true;
}
````

## Add FakeLinearActionExtractionService to fakes.ts

```typescript
export class FakeLinearActionExtractionService implements LinearActionExtractionService {
  private response: ExtractedIssueData = {
    title: 'Test Issue',
    priority: 0,
    functionalRequirements: null,
    technicalDetails: null,
    valid: true,
    error: null,
    reasoning: 'Test extraction',
  };
  private shouldFail = false;
  private failError: LinearError = { code: 'EXTRACTION_FAILED', message: 'Fake extraction error' };

  async extractIssue(
    userId: string,
    text: string
  ): Promise<Result<ExtractedIssueData, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok({ ...this.response, title: text.slice(0, 50) });
  }

  // Test helpers
  setResponse(response: Partial<ExtractedIssueData>): void {
    this.response = { ...this.response, ...response };
  }

  setFailure(fail: boolean, error?: LinearError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
