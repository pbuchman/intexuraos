/**
 * Generate Issue Title Use Case
 *
 * Generates a concise issue title from a task description using LLM.
 * Uses the shared linearIssueTitlePrompt from @intexuraos/llm-prompts.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, getErrorMessage } from '@intexuraos/common-core';
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
    logger.warn({ userId, error: clientResult.error }, 'Failed to get LLM client, using fallback');
    return ok({
      title: generateFallbackTitle(description),
      issueType: 'feature',
    });
  }

  const llmClient = clientResult.value;

  const prompt = linearIssueTitlePrompt.build({ description }, { maxLength: 80 });

  logger.info({ userId, descriptionLength: description.length }, 'Generating issue title via LLM');

  const result = await llmClient.generate(prompt);

  if (!result.ok) {
    logger.warn({ error: result.error }, 'LLM title generation failed, using fallback');
    return ok({
      title: generateFallbackTitle(description),
      issueType: 'feature',
    });
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
    logger.warn(
      { parseError: getErrorMessage(e), responsePreview: cleaned.slice(0, 200) },
      'Failed to parse LLM response as JSON, using fallback'
    );
    return ok({
      title: generateFallbackTitle(description),
      issueType: 'feature',
    });
  }

  const validationResult = LinearIssueTitleSchema.safeParse(parsed);
  if (!validationResult.success) {
    const zodErrors = formatZodErrors(validationResult.error);
    logger.warn(
      { zodErrors, responsePreview: cleaned.slice(0, 200) },
      'LLM returned invalid response format, using fallback'
    );
    return ok({
      title: generateFallbackTitle(description),
      issueType: 'feature',
    });
  }

  logger.info(
    { title: validationResult.data.title, issueType: validationResult.data.issueType },
    'Generated issue title'
  );

  return ok(validationResult.data);
}

/**
 * Fallback title generation using regex (no LLM).
 */
function generateFallbackTitle(description: string): string {
  let clean = description;
  clean = clean.replace(/```[\s\S]*?```/g, '');
  clean = clean.replace(/`[^`]+`/g, '');
  clean = clean.replace(/https?:\/\/\S+/g, '');
  clean = clean.replace(/[#*_~]/g, '');

  const extracted = clean.split(/[.\n]/)[0]?.trim();
  const firstLine = extracted !== undefined && extracted !== '' ? extracted : 'Code task';
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}
