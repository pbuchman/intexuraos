/**
 * Insights generation prompt for analyzing feed data and generating insights.
 * Converts feed snapshot data into analytical insights about patterns, trends, and key findings.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface InsightsPromptInput {
  /** The feed snapshot data to analyze */
  snapshotData: object;
  /** The feed purpose/description for context */
  feedPurpose: string;
}

export interface InsightsPromptDeps extends PromptDeps {
  /** Maximum data size to process (default: 100000) */
  maxDataSize?: number;
}

export const insightsPrompt: PromptBuilder<InsightsPromptInput, InsightsPromptDeps> = {
  name: 'visualization-insights',
  description: 'Generates analytical insights from feed snapshot data',

  build(input: InsightsPromptInput, deps?: InsightsPromptDeps): string {
    const maxDataSize = deps?.maxDataSize ?? 100000;
    const dataStr = JSON.stringify(input.snapshotData, null, 2);
    const truncatedData =
      dataStr.length > maxDataSize ? dataStr.slice(0, maxDataSize) + '...' : dataStr;

    return `You are an expert data analyst. Analyze the provided feed data and generate insights.

FEED PURPOSE:
${input.feedPurpose}

YOUR TASK:
Analyze the data and identify:
1. Key patterns and trends
2. Notable statistics or outliers
3. Temporal patterns (if time-based data)
4. Correlations or relationships
5. Actionable insights

REQUIREMENTS:
- Be specific and data-driven
- Cite actual values from the data
- Focus on meaningful, actionable insights
- Keep insights concise (3-5 bullet points)
- Each insight should be 1-2 sentences maximum
- Use clear, professional language

OUTPUT FORMAT:
Return ONLY a plain text list of insights, one per line, starting with a bullet point (•).
Do NOT include explanations, markdown formatting, or any other text.

FEED DATA:
${truncatedData}

Generate insights:`;
  },
};
