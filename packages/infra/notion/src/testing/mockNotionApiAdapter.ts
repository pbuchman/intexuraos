/**
 * Mock test implementation of NotionApiPort.
 * Lives in infra/notion for reuse across tests.
 */
import { ok, type Result } from '@praxos/common';
import type {
  NotionApiPort,
  NotionPage,
  NotionBlock,
  CreatedNote,
  NotionError,
  CreatePromptVaultNoteParams,
} from '@praxos/domain-promptvault';

/**
 * Captured PromptVault note creation call for test assertions.
 */
export interface CapturedPromptVaultNote {
  params: CreatePromptVaultNoteParams;
  result: CreatedNote;
}

/**
 * Mock implementation of NotionApiPort for testing.
 * Returns deterministic data for predictable test behavior.
 */
export class MockNotionApiAdapter implements NotionApiPort {
  private pageCounter = 0;
  private capturedNotes: CapturedPromptVaultNote[] = [];

  async validateToken(token: string): Promise<Result<boolean, NotionError>> {
    // Simulate invalid token for testing
    if (token === 'invalid-token') {
      return await Promise.resolve(ok(false));
    }
    return await Promise.resolve(ok(true));
  }

  async getPageWithPreview(
    _token: string,
    pageId: string
  ): Promise<Result<{ page: NotionPage; blocks: NotionBlock[] }, NotionError>> {
    const page: NotionPage = {
      id: pageId,
      title: 'Prompt Vault',
      url: `https://notion.so/${pageId}`,
    };

    const blocks: NotionBlock[] = [
      { type: 'heading_1', content: 'Prompt Vault' },
      { type: 'paragraph', content: 'This is a stub preview of your Prompt Vault page.' },
      { type: 'bulleted_list_item', content: 'Item 1: System prompts' },
      { type: 'bulleted_list_item', content: 'Item 2: Templates' },
    ];

    return await Promise.resolve(ok({ page, blocks }));
  }

  async createPromptVaultNote(
    params: CreatePromptVaultNoteParams
  ): Promise<Result<CreatedNote, NotionError>> {
    this.pageCounter++;
    const id = `note_${String(this.pageCounter).padStart(6, '0')}`;

    const result: CreatedNote = {
      id,
      url: `https://notion.so/${id.replace(/_/g, '-')}`,
      title: params.title,
    };

    // Capture the call for test assertions
    this.capturedNotes.push({ params, result });

    return await Promise.resolve(ok(result));
  }

  /**
   * Get all captured PromptVault note creation calls.
   * Useful for verifying verbatim storage and block structure.
   */
  getCapturedNotes(): CapturedPromptVaultNote[] {
    return [...this.capturedNotes];
  }

  /**
   * Get the last captured PromptVault note.
   */
  getLastCapturedNote(): CapturedPromptVaultNote | undefined {
    return this.capturedNotes[this.capturedNotes.length - 1];
  }

  /**
   * Reset counter and captured notes (for test cleanup).
   */
  reset(): void {
    this.pageCounter = 0;
    this.capturedNotes = [];
  }
}
