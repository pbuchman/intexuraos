/**
 * Generate Issue Title Use Case
 *
 * Generates a concise issue title from a task description using LLM.
 * Uses the shared linearIssueTitlePrompt from @intexuraos/llm-prompts.
 * Retries once on failure. Returns an error instead of silently degrading.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import {
  linearIssueTitlePrompt,
  LinearIssueTitleSchema,
  type LinearIssueType,
} from '@intexuraos/llm-prompts';
import { formatZodErrors } from '@intexuraos/llm-utils';
import type { UserServiceClient } from '@intexuraos/internal-clients';

export interface GenerateIssueTitleDeps {
  userServiceClient: UserServiceClient;
  logger: Logger;
}

export interface GenerateIssueTitleRequest {
  description: string;
  userId: string;
}

export interface GeneratedTitle {
  title: string;
  issueType: LinearIssueType;
}

export interface GenerateTitleError {
  code: 'LLM_ERROR' | 'PARSE_ERROR';
  message: string;
}

const MAX_ATTEMPTS = 2;

export async function generateIssueTitle(
  request: GenerateIssueTitleRequest,
  deps: GenerateIssueTitleDeps
): Promise<Result<GeneratedTitle, GenerateTitleError>> {
  const { description, userId } = request;
  const { userServiceClient, logger } = deps;

  if (description.trim() === '') {
    return ok({ title: 'Code task', issueType: 'feature' });
  }

  const clientResult = await userServiceClient.getLlmClient(userId);
  if (!clientResult.ok) {
    logger.error({ userId, error: clientResult.error }, 'Failed to get LLM client');
    return err({ code: 'LLM_ERROR', message: 'Failed to get LLM client' });
  }

  const llmClient = clientResult.value;
  const prompt = linearIssueTitlePrompt.build({ description }, { maxLength: 80 });

  logger.info({ userId, descriptionLength: description.length }, 'Generating issue title via LLM');

  let lastError: GenerateTitleError = { code: 'LLM_ERROR', message: 'Title generation failed' };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;

    const result = await llmClient.generate(prompt, { promptType: linearIssueTitlePrompt.name });

    if (!result.ok) {
      if (isLastAttempt) {
        logger.error({ attempt, error: result.error }, 'LLM title generation failed after 2 attempts');
      } else {
        logger.warn({ attempt, error: result.error }, 'LLM title generation failed, retrying');
      }
      lastError = { code: 'LLM_ERROR', message: `LLM title generation failed after ${String(attempt)} attempts` };
      continue;
    }

    let cleaned = result.value.content.trim();
    const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
    const codeBlockMatch = codeBlockRegex.exec(cleaned);
    if (codeBlockMatch?.[1] !== undefined) {
      cleaned = codeBlockMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      if (isLastAttempt) {
        logger.error(
          { attempt, parseError: getErrorMessage(e), responsePreview: cleaned.slice(0, 200) },
          'Failed to parse LLM response as JSON after 2 attempts'
        );
      } else {
        logger.warn(
          { attempt, parseError: getErrorMessage(e), responsePreview: cleaned.slice(0, 200) },
          'Failed to parse LLM response as JSON, retrying'
        );
      }
      lastError = { code: 'PARSE_ERROR', message: `Failed to parse LLM response after ${String(attempt)} attempts` };
      continue;
    }

    const validationResult = LinearIssueTitleSchema.safeParse(parsed);
    if (!validationResult.success) {
      const zodErrors = formatZodErrors(validationResult.error);
      if (isLastAttempt) {
        logger.error(
          { attempt, zodErrors, responsePreview: cleaned.slice(0, 200) },
          'LLM returned invalid response format after 2 attempts'
        );
      } else {
        logger.warn(
          { attempt, zodErrors, responsePreview: cleaned.slice(0, 200) },
          'LLM returned invalid response format, retrying'
        );
      }
      lastError = { code: 'PARSE_ERROR', message: `LLM returned invalid format after ${String(attempt)} attempts` };
      continue;
    }

    logger.info(
      { title: validationResult.data.title, issueType: validationResult.data.issueType },
      'Generated issue title'
    );

    return ok(validationResult.data);
  }

  return err(lastError);
}
