import type { LlmGenerateClient, GenerateOptions, GenerateResult, LLMError } from '@intexuraos/llm-factory';
import { ok, err, type Result } from '@intexuraos/common-core';

export interface FakeLlmCall {
  readonly prompt: string;
  readonly options: GenerateOptions | undefined;
}

/**
 * In-memory fake LlmGenerateClient that returns scripted responses in order.
 * A response of type 'error' returns `err(...)`; 'content' returns ok with that string.
 * After exhausting the script, falls back to the `defaultResponse`.
 */
export interface ScriptedResponse {
  readonly type: 'content' | 'error';
  readonly value: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export class FakeLlmClient implements LlmGenerateClient {
  public readonly calls: FakeLlmCall[] = [];
  private cursor = 0;

  constructor(
    private readonly script: ScriptedResponse[],
    private readonly defaultResponse: ScriptedResponse = { type: 'content', value: '{}' },
  ) {}

  async generate(prompt: string, options?: GenerateOptions): Promise<Result<GenerateResult, LLMError>> {
    this.calls.push({ prompt, options });
    const response = this.script[this.cursor] ?? this.defaultResponse;
    this.cursor += 1;
    if (response.type === 'error') {
      return err({ code: 'UPSTREAM_ERROR', message: response.value } as unknown as LLMError);
    }
    return ok({
      content: response.value,
      usage: {
        inputTokens: response.inputTokens ?? 100,
        outputTokens: response.outputTokens ?? 200,
        totalTokens: (response.inputTokens ?? 100) + (response.outputTokens ?? 200),
        costUsd: 0.0001,
      },
    });
  }
}
