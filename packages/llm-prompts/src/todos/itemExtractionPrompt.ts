import type { PromptBuilder, PromptDeps } from '../types.js';

export interface ItemExtractionPromptInput {
  description: string;
}

export interface ItemExtractionPromptDeps extends PromptDeps {
  maxItems?: number;
  maxDescriptionLength?: number;
}

export const itemExtractionPrompt: PromptBuilder<
  ItemExtractionPromptInput,
  ItemExtractionPromptDeps
> = {
  name: 'todo-item-extraction',
  description: 'Extracts actionable, non-repetitive todo items from description',

  build(input: ItemExtractionPromptInput, deps?: ItemExtractionPromptDeps): string {
    const maxItems = deps?.maxItems ?? 50;
    const maxLength = deps?.maxDescriptionLength ?? 10000;
    const descriptionPreview =
      input.description.length > maxLength
        ? input.description.slice(0, maxLength)
        : input.description;

    const truncationWarning =
      input.description.length > maxLength
        ? `\n\n⚠️ IMPORTANT: Description was truncated to first ${String(maxLength)} characters. Items will only be extracted from this portion.\n`
        : '';

    return `Extract actionable, non-repetitive items from following todo description.

MAXIMUM ITEMS: ${String(maxItems)} items maximum
LANGUAGE: Maintain the SAME LANGUAGE as the description (English → English items, Polish → Polish items, Spanish → Spanish items, etc.)

PRIORITY INFERENCE:
- Infer priority from urgency words in the description:
  - "urgent", "asap", "immediately", "now", "critical" → 'urgent'
  - "important", "high", "priority", "must" → 'high'
  - "should", "need to", "try to" → 'medium'
  - "maybe", "consider", "could" → 'low'
  - If no urgency indicated → null
- Context matters: "urgent task about X" makes that item urgent, not the entire todo

DUE DATE INFERENCE:
- Parse relative time expressions to ISO-8601 dates (YYYY-MM-DD):
  - "today", "now" → current date
  - "tomorrow" → current date + 1 day
  - "in 2 days", "in 2d" → current date + 2 days
  - "next week", "in 1 week" → current date + 7 days
  - "by Friday" → next Friday's date
  - "end of month" → last day of current month
  - If no date indicated or ambiguous → null

EXTRACTION RULES:
- Items must be ACTIONABLE (can be done, not just notes)
- DEDUPLICATE: Remove similar/redundant items
- Be specific: "research X" is better than "do something"
- Items should be independent: not dependent on other items
- Maximum ${String(maxItems)} items total
- Prioritize most important/actionable items if more exist

RESPONSE FORMAT:
Return ONLY a JSON object in this exact format:
{
  "items": [
    {
      "title": "<item title>",
      "priority": "low" | "medium" | "high" | "urgent" | null,
      "dueDate": "<ISO-8601-date>" | null,
      "reasoning": "<brief explanation>"
    }
  ],
  "summary": "<brief summary of extraction decisions>"
}

${truncationWarning}
DESCRIPTION TO PROCESS:
${descriptionPreview}

Extract items:`;
  },
};
