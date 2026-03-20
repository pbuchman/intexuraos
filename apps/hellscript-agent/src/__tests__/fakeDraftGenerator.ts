import type { DraftGenerator } from '../domain/ports/draftGenerator.js';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';
import type { Logger } from '@intexuraos/common-core';

export class FakeDraftGenerator implements DraftGenerator {
  private nextMarkdown = '# Generated Draft\n\nDefault content.';
  private callLog: {
    state: MaterializedBufferState;
    priorDraft: string | null;
    requestText: string;
  }[] = [];

  setNextMarkdown(markdown: string): void {
    this.nextMarkdown = markdown;
  }

  getCalls(): {
    state: MaterializedBufferState;
    priorDraft: string | null;
    requestText: string;
  }[] {
    return this.callLog;
  }

  async generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    _logger: Logger
  ): Promise<string> {
    this.callLog.push({ state, priorDraft, requestText });
    return this.nextMarkdown;
  }
}
