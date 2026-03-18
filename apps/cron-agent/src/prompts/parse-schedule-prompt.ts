import type { PromptBuilder } from '@intexuraos/llm-prompts';

interface ParseScheduleInput {
  description: string;
}

export const parseSchedulePrompt: PromptBuilder<ParseScheduleInput> = {
  name: 'parse-schedule',
  description: 'Converts human-language schedule descriptions into standard cron expressions',
  version: '1.0.0',

  build(input: ParseScheduleInput): string {
    return `You are a cron expression parser. Convert the following human-language schedule description into a standard 5-field cron expression (minute hour day-of-month month day-of-week).

Rules:
- Use standard cron syntax: * for any, */N for every N, ranges like 1-5, lists like 1,3,5
- Day of week: 0=Sunday, 1=Monday, ..., 6=Saturday
- Return ONLY valid JSON, no markdown, no explanation

Input: "${input.description}"

Return JSON in exactly this format:
{"cronExpression": "<5-field cron expression>", "humanSummary": "<readable summary of when it runs>"}

If the input is not a valid schedule description or cannot be converted to cron, return:
{"error": "<reason why it cannot be converted>"}`;
  },
};
