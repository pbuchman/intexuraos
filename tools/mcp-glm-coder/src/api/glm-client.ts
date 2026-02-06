import type { GLMResponse } from '../types.js';
import { logger } from '../utils/logger.js';
import { formatDuration } from '../utils/format.js';

const DEFAULT_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4';
const DEFAULT_MODEL = 'glm-4.7';

export interface GLMClientConfig {
  apiKey: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

export interface GLMRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export class GLMClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly defaultTemperature: number;
  private readonly maxRetries: number;

  constructor(config: GLMClientConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.model = config.model ?? DEFAULT_MODEL;
    this.defaultTemperature = config.temperature ?? 0.2;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async generateCode(options: GLMRequestOptions): Promise<{
    content: string;
    tokensUsed: number;
    latencyMs: number;
  }> {
    const startTime = Date.now();

    const response = await this.callAPI({
      model: this.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      temperature: options.temperature ?? this.defaultTemperature,
      thinking: {
        type: 'enabled',
        clear_thinking: true,
      },
    });

    const content = response.choices[0]?.message?.content ?? '';
    const tokensUsed = response.usage?.total_tokens ?? this.estimateTokens(content);

    return {
      content: this.cleanOutput(content),
      tokensUsed,
      latencyMs: Date.now() - startTime,
    };
  }

  private async callAPI(body: Record<string, unknown>): Promise<GLMResponse> {
    const url = `${this.endpoint}/chat/completions`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info('GLM API request', {
          url,
          model: body.model,
          attempt: attempt + 1,
          messagesCount: Array.isArray(body.messages) ? body.messages.length : 0,
        });

        const startTime = Date.now();
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('GLM API error response', {
            status: response.status,
            latency: formatDuration(latencyMs),
            error: errorText,
          });
          throw new Error(`GLM API error ${response.status}: ${errorText}`);
        }

        const jsonResponse = (await response.json()) as GLMResponse;
        logger.info('GLM API success', {
          latency: formatDuration(latencyMs),
          tokensUsed: jsonResponse.usage?.total_tokens,
          finishReason: jsonResponse.choices[0]?.finish_reason,
        });

        return jsonResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('API attempt failed', { attempt: attempt + 1, error: lastError.message });

        if (attempt < this.maxRetries) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('GLM API call failed');
  }

  private cleanOutput(content: string): string {
    let cleaned = content.trim();

    const fenceMatch = cleaned.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
    if (fenceMatch?.[1]) {
      cleaned = fenceMatch[1];
    }

    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

    return cleaned.trim();
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createGLMClient(): GLMClient {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error('ZAI_API_KEY environment variable is required');
  }

  return new GLMClient({
    apiKey,
    endpoint: process.env.GLM_ENDPOINT,
    model: process.env.GLM_MODEL,
  });
}
