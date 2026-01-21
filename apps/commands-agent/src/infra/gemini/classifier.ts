import { commandClassifierPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels, type ResearchModel } from '@intexuraos/llm-contract';
import type { CommandType } from '../../domain/models/command.js';
import type {
  Classifier,
  ClassificationResult,
  ClassifyOptions,
} from '../../domain/ports/classifier.js';

const VALID_TYPES: readonly CommandType[] = [
  'todo',
  'research',
  'note',
  'link',
  'calendar',
  'reminder',
  'linear',
] as const;

const MODEL_KEYWORDS: Record<ResearchModel, string[]> = {
  [LlmModels.Gemini25Pro]: ['gemini pro', 'gemini-pro'],
  [LlmModels.Gemini25Flash]: ['gemini flash', 'gemini-flash', 'gemini', 'google'],
  [LlmModels.ClaudeOpus45]: ['claude opus', 'opus'],
  [LlmModels.ClaudeSonnet45]: ['claude sonnet', 'sonnet', 'claude', 'anthropic'],
  [LlmModels.O4MiniDeepResearch]: ['o4', 'o4-mini', 'deep research'],
  [LlmModels.GPT52]: ['gpt', 'gpt-5', 'openai', 'chatgpt'],
  [LlmModels.Sonar]: ['sonar basic'],
  [LlmModels.SonarPro]: ['sonar', 'sonar pro', 'pplx', 'perplexity'],
  [LlmModels.SonarDeepResearch]: ['sonar deep', 'perplexity deep', 'deep sonar'],
  [LlmModels.Glm47]: ['glm', 'glm-4', 'glm-4.7', 'zai'],
  [LlmModels.Glm47Flash]: ['glm flash', 'glm-4.7-flash', 'glm-flash'],
};

const DEFAULT_MODELS: ResearchModel[] = [
  LlmModels.Gemini25Pro,
  LlmModels.ClaudeOpus45,
  LlmModels.GPT52,
  LlmModels.SonarPro,
];

const ALL_LLMS_PATTERNS = [
  /\ball\s+(llms?|models?|ais?)\b/i,
  /\buse\s+(all|every)\b/i,
  /\bużyj\s+wszystk/i,
  /\bwszystkie\s+(modele|llm)/i,
];

const PWA_SHARED_LINK_CONFIDENCE_BOOST = 0.1;

export function createGeminiClassifier(client: LlmGenerateClient): Classifier {
  return {
    async classify(text: string, options?: ClassifyOptions): Promise<ClassificationResult> {
      const prompt = commandClassifierPrompt.build({ message: text });

      const result = await client.generate(prompt);

      if (!result.ok) {
        throw new Error(`Classification failed: ${result.error.message}`);
      }

      const parsed = parseClassifyResponse(result.value.content, VALID_TYPES);
      const selectedModels = extractSelectedModels(text);

      let adjustedConfidence = parsed.confidence;
      let adjustedReasoning = parsed.reasoning;

      if (parsed.type === 'link' && options?.sourceType === 'pwa-shared') {
        adjustedConfidence = Math.min(1, parsed.confidence + PWA_SHARED_LINK_CONFIDENCE_BOOST);
        adjustedReasoning = `${parsed.reasoning} (confidence boosted: PWA share source)`;
      }

      const classificationResult: ClassificationResult = {
        type: parsed.type,
        confidence: adjustedConfidence,
        title: parsed.title,
        reasoning: adjustedReasoning,
      };
      if (selectedModels !== undefined) {
        classificationResult.selectedModels = selectedModels;
      }

      return classificationResult;
    },
  };
}

export function extractSelectedModels(text: string): ResearchModel[] | undefined {
  const lowerText = text.toLowerCase();

  for (const pattern of ALL_LLMS_PATTERNS) {
    if (pattern.test(text)) {
      return DEFAULT_MODELS;
    }
  }

  const found: ResearchModel[] = [];
  for (const [model, keywords] of Object.entries(MODEL_KEYWORDS) as [ResearchModel, string[]][]) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        found.push(model);
        break;
      }
    }
  }

  return found.length > 0 ? found : undefined;
}

function parseClassifyResponse(
  response: string,
  validTypes: readonly CommandType[]
): { type: CommandType; confidence: number; title: string; reasoning: string } {
  const jsonMatch = /\{[\s\S]*}/.exec(response);
  if (jsonMatch === null) {
    return {
      type: 'note',
      confidence: 0.3,
      title: 'Unknown',
      reasoning: 'Failed to parse response, defaulting to note',
    };
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      type: 'note',
      confidence: 0.3,
      title: 'Unknown',
      reasoning: 'Invalid response format, defaulting to note',
    };
  }

  const obj = parsed as Record<string, unknown>;

  const type = validTypes.includes(obj['type'] as CommandType)
    ? (obj['type'] as CommandType)
    : 'note';

  const confidence =
    typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.5;

  const title = typeof obj['title'] === 'string' ? obj['title'].slice(0, 100) : 'Unknown';

  const reasoning =
    typeof obj['reasoning'] === 'string' ? obj['reasoning'].slice(0, 500) : 'No reasoning provided';

  return { type, confidence, title, reasoning };
}
