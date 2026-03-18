import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { GeminiClient } from '@intexuraos/infra-gemini';
import cronParser from 'cron-parser';
import { parseSchedulePrompt } from '../../prompts/parse-schedule-prompt.js';

export interface ParseScheduleError {
  code: 'PARSE_FAILED' | 'INVALID_CRON' | 'LLM_ERROR';
  message: string;
}

export interface ParseScheduleResult {
  cronExpression: string;
  humanSummary: string;
}

export interface ParseScheduleDeps {
  logger: Logger;
  geminiClient: GeminiClient;
}

export async function parseSchedule(
  deps: ParseScheduleDeps,
  description: string,
): Promise<Result<ParseScheduleResult, ParseScheduleError>> {
  const { logger, geminiClient } = deps;

  const prompt = parseSchedulePrompt.build({ description });
  const result = await geminiClient.generate(prompt);

  if (!result.ok) {
    logger.error({ error: result.error }, 'LLM call failed for schedule parsing');
    return err({ code: 'LLM_ERROR', message: result.error.message });
  }

  const content = result.value.content.trim();

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    if (typeof parsed['error'] === 'string') {
      return err({ code: 'PARSE_FAILED', message: parsed['error'] });
    }

    const cronExpression = parsed['cronExpression'];
    const humanSummary = parsed['humanSummary'];

    if (typeof cronExpression !== 'string' || typeof humanSummary !== 'string') {
      return err({ code: 'PARSE_FAILED', message: 'LLM returned invalid response format' });
    }

    try {
      cronParser.parseExpression(cronExpression);
    } catch {
      return err({ code: 'INVALID_CRON', message: `Invalid cron expression: ${cronExpression}` });
    }

    return ok({ cronExpression, humanSummary });
  } catch {
    return err({ code: 'PARSE_FAILED', message: 'Failed to parse LLM response as JSON' });
  }
}
