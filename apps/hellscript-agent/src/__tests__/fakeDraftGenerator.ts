import type { Result, Logger } from '@intexuraos/common-core';
import type { DraftGenerator } from '../domain/ports/draftGenerator.js';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';
import type { WritingCategory } from '../domain/models/writingCategory.js';

export class FakeDraftGenerator implements DraftGenerator {
  private nextMarkdown = '# Generated Draft\n\nDefault content.';
  private nextError: Error | null = null;
  private callLog: {
    state: MaterializedBufferState;
    priorDraft: string | null;
    requestText: string;
    styleInstructions: string | null;
    writingSamples: string[];
    category: WritingCategory;
  }[] = [];

  setNextMarkdown(markdown: string): void {
    this.nextMarkdown = markdown;
  }

  simulateError(error: Error): void {
    this.nextError = error;
  }

  getCalls(): {
    state: MaterializedBufferState;
    priorDraft: string | null;
    requestText: string;
    styleInstructions: string | null;
    writingSamples: string[];
    category: WritingCategory;
  }[] {
    return this.callLog;
  }

  async generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    styleInstructions: string | null,
    writingSamples: string[],
    category: WritingCategory,
    _logger: Logger
  ): Promise<Result<string>> {
    this.callLog.push({ state, priorDraft, requestText, styleInstructions, writingSamples, category });

    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      return { ok: false, error };
    }

    return { ok: true, value: this.nextMarkdown };
  }
}
