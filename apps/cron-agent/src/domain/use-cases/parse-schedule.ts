import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { LLMClient } from '@intexuraos/llm-contract';
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
  geminiClient: LLMClient;
}

export async function parseSchedule(
  deps: ParseScheduleDeps,
  schedule: string,
): Promise<Result<ParseScheduleResult, ParseScheduleError>> {
  const { logger, geminiClient } = deps;

  const prompt = parseSchedulePrompt.build({ description: schedule });
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

    // Validate minimum interval: reject schedules more frequent than every 5 minutes
    const interval = cronParser.parseExpression(cronExpression);
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    const intervalMs = second.getTime() - first.getTime();
    const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    if (intervalMs < MIN_INTERVAL_MS) {
      return err({
        code: 'INVALID_CRON',
        message: `Schedule frequency too high: interval is ${String(Math.round(intervalMs / 1000))}s, minimum is 300s (5 minutes)`,
      });
    }

    return ok({ cronExpression, humanSummary });
  } catch {
    return err({ code: 'PARSE_FAILED', message: 'Failed to parse LLM response as JSON' });
  }
}
