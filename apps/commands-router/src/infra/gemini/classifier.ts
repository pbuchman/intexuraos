import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { CommandType } from '../../domain/models/command.js';
import type { Classifier, ClassificationResult } from '../../domain/ports/classifier.js';
import type { LlmProvider } from '../../domain/events/actionCreatedEvent.js';

const VALID_TYPES: readonly CommandType[] = [
  'todo',
  'research',
  'note',
  'link',
  'calendar',
  'reminder',
  'unclassified',
] as const;

const CLASSIFICATION_PROMPT = `You are a command classifier. Analyze the user's message and classify it into one of these categories:

- todo: A task that needs to be done (e.g., "buy groceries", "call mom", "finish report")
- research: A question or topic to research (e.g., "how does X work?", "find out about Y")
- note: Information to remember or store (e.g., "meeting notes from today", "idea for project")
- link: A URL or reference to save (e.g., contains a URL or asks to save a link)
- calendar: A time-based event or appointment (e.g., "meeting tomorrow at 3pm", "dentist on Friday")
- reminder: Something to be reminded about at a specific time (e.g., "remind me to X in 2 hours")
- unclassified: Cannot be classified into any of the above categories

Respond with ONLY a JSON object in this exact format:
{
  "type": "<category>",
  "confidence": <number between 0 and 1>,
  "title": "<short descriptive title, max 50 chars>"
}

The confidence should reflect how certain you are about the classification:
- 0.9-1.0: Very confident
- 0.7-0.9: Fairly confident
- 0.5-0.7: Somewhat uncertain
- Below 0.5: Use "unclassified" instead

The title should be a concise summary of the action (e.g., "Buy groceries", "Research AI trends", "Team meeting notes").`;

const LLM_KEYWORDS: Record<LlmProvider, string[]> = {
  google: ['gemini', 'google'],
  openai: ['gpt', 'openai', 'chatgpt'],
  anthropic: ['claude', 'anthropic'],
};

const ALL_LLMS_PATTERNS = [
  /\ball\s+(llms?|models?|ais?)\b/i,
  /\buse\s+(all|every)\b/i,
  /\bużyj\s+wszystk/i,
  /\bwszystkie\s+(modele|llm)/i,
];

export interface GeminiClassifierConfig {
  apiKey: string;
}

export function extractSelectedLlms(text: string): LlmProvider[] | undefined {
  const lowerText = text.toLowerCase();

  for (const pattern of ALL_LLMS_PATTERNS) {
    if (pattern.test(text)) {
      return ['google', 'openai', 'anthropic'];
    }
  }

  const found: LlmProvider[] = [];
  for (const [provider, keywords] of Object.entries(LLM_KEYWORDS) as [LlmProvider, string[]][]) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        found.push(provider);
        break;
      }
    }
  }

  return found.length > 0 ? found : undefined;
}

export function createGeminiClassifier(config: GeminiClassifierConfig): Classifier {
  const client = createGeminiClient({ apiKey: config.apiKey });

  return {
    async classify(text: string): Promise<ClassificationResult> {
      const prompt = `${CLASSIFICATION_PROMPT}\n\nUser message to classify:\n${text}`;

      const result = await client.generate(prompt);

      if (!result.ok) {
        throw new Error(`Classification failed: ${result.error.message}`);
      }

      const parsed = parseClassifyResponse(result.value, VALID_TYPES);
      const selectedLlms = extractSelectedLlms(text);

      const classificationResult: ClassificationResult = {
        type: parsed.type,
        confidence: parsed.confidence,
        title: parsed.title,
      };
      if (selectedLlms !== undefined) {
        classificationResult.selectedLlms = selectedLlms;
      }

      return classificationResult;
    },
  };
}

function parseClassifyResponse(
  response: string,
  validTypes: readonly CommandType[]
): { type: CommandType; confidence: number; title: string } {
  const jsonMatch = /\{[\s\S]*}/.exec(response);
  if (jsonMatch === null) {
    return { type: 'unclassified', confidence: 0.5, title: 'Unknown' };
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (typeof parsed !== 'object' || parsed === null) {
    return { type: 'unclassified', confidence: 0.5, title: 'Unknown' };
  }

  const obj = parsed as Record<string, unknown>;

  const type = validTypes.includes(obj['type'] as CommandType)
    ? (obj['type'] as CommandType)
    : 'unclassified';

  const confidence =
    typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.5;

  const title = typeof obj['title'] === 'string' ? obj['title'].slice(0, 100) : 'Unknown';

  return { type, confidence, title };
}
