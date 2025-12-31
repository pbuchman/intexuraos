import { createGeminiClient, type ClassifyOptions } from '@intexuraos/infra-gemini';
import type { CommandType } from '../../domain/models/command.js';
import type { Classifier, ClassificationResult } from '../../domain/ports/classifier.js';

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

export interface GeminiClassifierConfig {
  apiKey: string;
}

export function createGeminiClassifier(config: GeminiClassifierConfig): Classifier {
  const client = createGeminiClient({ apiKey: config.apiKey });

  return {
    async classify(text: string): Promise<ClassificationResult> {
      const options: ClassifyOptions<CommandType> = {
        text,
        systemPrompt: CLASSIFICATION_PROMPT,
        validTypes: VALID_TYPES,
        defaultType: 'unclassified',
      };

      const result = await client.classify(options);

      if (!result.ok) {
        throw new Error(`Classification failed: ${result.error.message}`);
      }

      return result.value;
    },
  };
}
