/**
 * Feed name generation prompt for creating names for composite data feeds.
 * Used to generate descriptive names based on feed purpose and components.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface FeedNamePromptInput {
  /** The purpose or description of the feed */
  purpose: string;
  /** Names of data sources included in the feed */
  sourceNames: string[];
  /** Names of notification filters applied to the feed */
  filterNames: string[];
}

export interface FeedNamePromptDeps extends PromptDeps {
  /** Maximum character length for the name */
  maxLength?: number;
}

export const feedNamePrompt: PromptBuilder<FeedNamePromptInput, FeedNamePromptDeps> = {
  name: 'feed-name-generation',
  description: 'Generates descriptive names for composite data feeds',

  build(input: FeedNamePromptInput, deps?: FeedNamePromptDeps): string {
    const maxLength = deps?.maxLength ?? 100;
    const sourcesText = input.sourceNames.length > 0 ? input.sourceNames.join(', ') : 'None';
    const filtersText = input.filterNames.length > 0 ? input.filterNames.join(', ') : 'None';

    return `Generate a concise, descriptive name for a data feed based on the following information.

Purpose: ${input.purpose}
Data sources included: ${sourcesText}
Notification filters: ${filtersText}

Requirements:
- Maximum ${String(maxLength)} characters
- Be specific and descriptive
- Do not include quotes around the name
- Do not include any explanations, just the name itself
- The name should reflect what data the feed aggregates

Name:`;
  },
};
