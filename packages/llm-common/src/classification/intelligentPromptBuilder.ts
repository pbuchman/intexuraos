/**
 * Intelligent prompt builder for command classification.
 * Dynamically includes historical examples and user corrections to improve accuracy.
 */

import type { PromptBuilder, PromptDeps } from '../shared/types.js';

export type CommandCategory =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'linear';

/**
 * A historical example of a correctly classified command.
 */
export interface ClassificationExample {
  /** The original user message */
  text: string;
  /** The assigned category */
  type: CommandCategory;
  /** Optional confidence score from original classification */
  confidence?: number;
}

/**
 * A correction where user fixed a misclassification.
 * These are prioritized as they represent "hard cases" the model got wrong.
 */
export interface ClassificationCorrection {
  /** The original user message */
  text: string;
  /** What the model originally classified it as */
  originalType: CommandCategory;
  /** What the user corrected it to */
  correctedType: CommandCategory;
  /** Original confidence (useful to identify overconfident mistakes) */
  originalConfidence?: number;
}

export interface IntelligentClassifierPromptInput {
  /** The user message to classify */
  message: string;
}

export interface IntelligentClassifierPromptDeps extends PromptDeps {
  /** Historical examples of correct classifications (20-50 recommended) */
  examples?: ClassificationExample[];
  /** User corrections of misclassifications (prioritized in prompt) */
  corrections?: ClassificationCorrection[];
  /** Maximum number of examples to include per category */
  maxExamplesPerCategory?: number;
  /** Maximum number of corrections to include */
  maxCorrections?: number;
}

/**
 * Groups examples by category for balanced representation.
 */
function groupByCategory(
  examples: ClassificationExample[]
): Map<CommandCategory, ClassificationExample[]> {
  const grouped = new Map<CommandCategory, ClassificationExample[]>();

  for (const example of examples) {
    const existing = grouped.get(example.type) ?? [];
    existing.push(example);
    grouped.set(example.type, existing);
  }

  return grouped;
}

/**
 * Selects a balanced subset of examples per category.
 */
function selectBalancedExamples(
  examples: ClassificationExample[],
  maxPerCategory: number
): ClassificationExample[] {
  const grouped = groupByCategory(examples);
  const selected: ClassificationExample[] = [];

  for (const categoryExamples of grouped.values()) {
    const sorted = categoryExamples.sort((a, b) => {
      const confA = a.confidence ?? 0.5;
      const confB = b.confidence ?? 0.5;
      return confB - confA;
    });

    selected.push(...sorted.slice(0, maxPerCategory));
  }

  return selected;
}

/**
 * Formats examples for the prompt.
 */
function formatExamples(examples: ClassificationExample[]): string {
  if (examples.length === 0) {
    return '';
  }

  const lines = examples.map((ex) => `- "${truncateText(ex.text, 80)}" → ${ex.type}`);

  return `
## REAL EXAMPLES FROM HISTORY
These are actual commands that were correctly classified:
${lines.join('\n')}
`;
}

/**
 * Formats corrections as high-priority learning examples.
 */
function formatCorrections(corrections: ClassificationCorrection[]): string {
  if (corrections.length === 0) {
    return '';
  }

  const lines = corrections.map(
    (c) => `- "${truncateText(c.text, 80)}" → ${c.correctedType} (NOT ${c.originalType})`
  );

  return `
## CRITICAL: LEARNED CORRECTIONS
These are commands that were MISCLASSIFIED and corrected by users. Pay special attention:
${lines.join('\n')}
`;
}

/**
 * Truncates text with ellipsis.
 */
function truncateText(text: string, maxLength: number): string {
  const cleaned = text.replace(/[\n\r]+/g, ' ').trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(0, maxLength - 3) + '...';
}

/**
 * Intelligent command classifier prompt that learns from historical data.
 * Includes real examples and prioritizes user corrections.
 */
export const intelligentClassifierPrompt: PromptBuilder<
  IntelligentClassifierPromptInput,
  IntelligentClassifierPromptDeps
> = {
  name: 'intelligent-command-classification',
  description: 'Classifies user messages using historical examples and learned corrections',

  build(input: IntelligentClassifierPromptInput, deps?: IntelligentClassifierPromptDeps): string {
    const maxExamplesPerCategory = deps?.maxExamplesPerCategory ?? 5;
    const maxCorrections = deps?.maxCorrections ?? 20;

    const examples = deps?.examples ?? [];
    const corrections = deps?.corrections ?? [];

    const selectedExamples = selectBalancedExamples(examples, maxExamplesPerCategory);
    const selectedCorrections = corrections.slice(0, maxCorrections);

    const correctionsSection = formatCorrections(selectedCorrections);
    const examplesSection = formatExamples(selectedExamples);

    return `Classify the message into exactly one category. Follow this decision tree IN ORDER:

## STEP 1: Explicit Prefix Override
If message STARTS with a category keyword (with or without colon), use that category.
Prefixes: linear, todo, note, research, reminder, link, calendar
Polish: do lineara, zadanie, notatka, zbadaj, przypomnij

Examples:
- "linear: buy groceries" → linear (user override)
- "todo: meeting tomorrow" → todo (user override)
- "do lineara: fix bug" → linear

## STEP 2: Linear Detection (if no prefix override)
Classify as "linear" when message contains:
- Linear PM context: "add to linear", "create linear issue", "in linear", "do lineara"
- Engineering terms: bug, issue, ticket, feature request, PR, pull request

EXCEPTION: "linear" in math/science context (e.g., "linear regression", "linear algebra") → NOT linear

Examples:
- "bug: mobile menu broken" → linear
- "create linear issue for auth" → linear
- "research linear regression" → research (math context)

## STEP 3: Category Detection (if no linear match)
Apply in this priority order:

**calendar** — Time-specific event or appointment
Signals: tomorrow, today, weekday names, time (3pm, 15:00), meeting, appointment, schedule, book
- "meeting tomorrow at 3" → calendar
- "dentist next Tuesday 10am" → calendar
- "call mom tomorrow" → calendar

**reminder** — Request to be reminded about something
Signals: remind me, przypomnij, don't forget
- "remind me about the meeting" → reminder
- "przypomnij o spotkaniu" → reminder

**research** — Question or topic to investigate
Signals: how does, what is, why, find out, learn about, ?
- "how does OAuth work?" → research
- "find out about competitor pricing" → research

**link** — URL to save
Signals: contains http://, https://, or "save this link"
- "https://example.com interesting article" → link

**note** — Information to store
Signals: notes, idea, remember that, jot down
- "meeting notes: discussed Q4 goals" → note
- "idea for new feature" → note

**todo** — Action to complete (default for actionable requests)
- "buy groceries" → todo
- "finish the report" → todo
- "call mom" → todo (no time specified)
${correctionsSection}${examplesSection}
## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "type": "<category>",
  "confidence": <0.0-1.0>,
  "title": "<concise title, max 50 chars, SAME LANGUAGE as input>",
  "reasoning": "<brief explanation>"
}

## CONFIDENCE SEMANTICS
- 0.90+: Clear match (explicit prefix, multiple strong signals)
- 0.70-0.90: Strong match (single clear signal like "bug", time expression)
- 0.50-0.70: Choosing between 2-3 plausible categories, picked the best fit
- <0.50: Genuinely uncertain → default to "note" (everything can be a note)

Message to classify:
${input.message}`;
  },
};

/**
 * Helper type for building example data from Firestore commands.
 */
export interface CommandExampleSource {
  text: string;
  classificationType: string;
  classificationConfidence?: number;
}

/**
 * Converts raw command data to ClassificationExample.
 */
export function toClassificationExample(
  source: CommandExampleSource
): ClassificationExample | null {
  const validTypes: CommandCategory[] = [
    'todo',
    'research',
    'note',
    'link',
    'calendar',
    'reminder',
    'linear',
  ];

  if (!validTypes.includes(source.classificationType as CommandCategory)) {
    return null;
  }

  return {
    text: source.text,
    type: source.classificationType as CommandCategory,
    ...(source.classificationConfidence !== undefined && {
      confidence: source.classificationConfidence,
    }),
  };
}

/**
 * Helper type for building correction data from Firestore transitions.
 */
export interface TransitionSource {
  commandText: string;
  originalType: string;
  newType: string;
  originalConfidence?: number;
}

/**
 * Converts raw transition data to ClassificationCorrection.
 */
export function toClassificationCorrection(
  source: TransitionSource
): ClassificationCorrection | null {
  const validTypes: CommandCategory[] = [
    'todo',
    'research',
    'note',
    'link',
    'calendar',
    'reminder',
    'linear',
  ];

  if (
    !validTypes.includes(source.originalType as CommandCategory) ||
    !validTypes.includes(source.newType as CommandCategory)
  ) {
    return null;
  }

  return {
    text: source.commandText,
    originalType: source.originalType as CommandCategory,
    correctedType: source.newType as CommandCategory,
    ...(source.originalConfidence !== undefined && {
      originalConfidence: source.originalConfidence,
    }),
  };
}
