/**
 * Notion adapter for Inbox Notes repository.
 * Maps domain InboxNote to Notion database properties.
 */
import { Client } from '@notionhq/client';
import { ok, err, type Result, getErrorMessage } from '@praxos/common';
import type { InboxNote, InboxNotesRepository, InboxError } from '@praxos/domain-inbox';

/**
 * Configuration for Notion Inbox Notes repository.
 */
export interface NotionInboxNotesConfig {
  /**
   * Notion API token.
   */
  token: string;

  /**
   * Inbox Notes database ID (data source ID).
   */
  databaseId: string;
}

/**
 * Notion implementation of InboxNotesRepository.
 */
export class NotionInboxNotesRepository implements InboxNotesRepository {
  private readonly client: Client;
  private readonly databaseId: string;

  constructor(config: NotionInboxNotesConfig) {
    this.client = new Client({ auth: config.token });
    this.databaseId = config.databaseId;
  }

  async createNote(note: InboxNote): Promise<Result<InboxNote, InboxError>> {
    try {
      // Map domain InboxNote to Notion properties
      const properties = this.mapNoteToNotionProperties(note);

      const response = await this.client.pages.create({
        parent: { database_id: this.databaseId },
        properties,
      });

      // Return note with Notion page ID
      return ok({
        ...note,
        id: response.id,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to create inbox note in Notion: ${getErrorMessage(error, 'Unknown Notion error')}`,
      });
    }
  }

  async getNote(noteId: string): Promise<Result<InboxNote | null, InboxError>> {
    try {
      const response = await this.client.pages.retrieve({ page_id: noteId });

      if (!('properties' in response)) {
        return ok(null);
      }

      // Map Notion page to domain InboxNote
      const note = this.mapNotionPageToNote(response);
      return ok(note);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get inbox note from Notion: ${getErrorMessage(error, 'Unknown Notion error')}`,
      });
    }
  }

  async updateNote(
    noteId: string,
    updates: Partial<InboxNote>
  ): Promise<Result<InboxNote, InboxError>> {
    try {
      const properties = this.mapNoteToNotionProperties(updates);

      const response = await this.client.pages.update({
        page_id: noteId,
        properties,
      });

      if (!('properties' in response)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Failed to update inbox note',
        });
      }

      const note = this.mapNotionPageToNote(response);
      return ok(note);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update inbox note in Notion: ${getErrorMessage(error, 'Unknown Notion error')}`,
      });
    }
  }

  /**
   * Map domain InboxNote to Notion properties structure.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapNoteToNotionProperties(note: Partial<InboxNote>): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {};

    if (note.title !== undefined) {
      properties['Title'] = {
        title: [{ text: { content: note.title } }],
      };
    }

    if (note.status !== undefined) {
      properties['Status'] = {
        select: { name: note.status },
      };
    }

    if (note.source !== undefined) {
      properties['Source'] = {
        select: { name: note.source },
      };
    }

    if (note.messageType !== undefined) {
      properties['Message type'] = {
        select: { name: note.messageType },
      };
    }

    if (note.contentType !== undefined) {
      properties['Type'] = {
        select: { name: note.contentType },
      };
    }

    if (note.topics !== undefined && note.topics.length > 0) {
      properties['Topic'] = {
        multi_select: note.topics.map((topic) => ({ name: topic })),
      };
    }

    if (note.originalText !== undefined) {
      properties['Original text'] = {
        rich_text: [{ text: { content: this.truncateText(note.originalText, 2000) } }],
      };
    }

    if (note.cleanText !== undefined) {
      properties['Clean text'] = {
        rich_text: [{ text: { content: this.truncateText(note.cleanText, 2000) } }],
      };
    }

    if (note.transcript !== undefined) {
      properties['Transcript'] = {
        rich_text: [{ text: { content: this.truncateText(note.transcript, 2000) } }],
      };
    }

    if (note.capturedAt !== undefined) {
      properties['Captured at'] = {
        date: { start: note.capturedAt },
      };
    }

    if (note.sender !== undefined) {
      properties['Sender'] = {
        rich_text: [{ text: { content: this.truncateText(note.sender, 2000) } }],
      };
    }

    if (note.externalId !== undefined) {
      properties['External ID'] = {
        rich_text: [{ text: { content: this.truncateText(note.externalId, 2000) } }],
      };
    }

    if (note.processingRunId !== undefined) {
      properties['Processing run id'] = {
        rich_text: [{ text: { content: this.truncateText(note.processingRunId, 2000) } }],
      };
    }

    if (note.processedBy !== undefined) {
      properties['Processed by'] = {
        select: { name: note.processedBy },
      };
    }

    if (note.errors !== undefined) {
      properties['Errors'] = {
        rich_text: [{ text: { content: this.truncateText(note.errors, 2000) } }],
      };
    }

    if (note.url !== undefined) {
      properties['URL'] = {
        url: note.url,
      };
    }

    return properties;
  }

  /**
   * Map Notion page to domain InboxNote.
   * This is a minimal implementation for reading back created notes.
   */
  private mapNotionPageToNote(page: {
    id: string;
    properties: Record<string, unknown>;
  }): InboxNote {
    // Extract properties (simplified for phase 1)
    const props = page.properties;

    const cleanText = this.extractRichText(props['Clean text']);
    const transcript = this.extractRichText(props['Transcript']);
    const processingRunId = this.extractRichText(props['Processing run id']);
    const errors = this.extractRichText(props['Errors']);
    const url = this.extractUrl(props['URL']);

    return {
      id: page.id,
      title: this.extractTitle(props['Title']),
      status: this.extractSelect(props['Status']) as InboxNote['status'],
      source: this.extractSelect(props['Source']) as InboxNote['source'],
      messageType: this.extractSelect(props['Message type']) as InboxNote['messageType'],
      contentType: this.extractSelect(props['Type']) as InboxNote['contentType'],
      topics: this.extractMultiSelect(props['Topic']) as InboxNote['topics'],
      originalText: this.extractRichText(props['Original text']),
      ...(cleanText !== '' && { cleanText }),
      ...(transcript !== '' && { transcript }),
      capturedAt: this.extractDate(props['Captured at']) ?? new Date().toISOString(),
      sender: this.extractRichText(props['Sender']),
      externalId: this.extractRichText(props['External ID']),
      ...(processingRunId !== '' && { processingRunId }),
      processedBy: this.extractSelect(props['Processed by']) as InboxNote['processedBy'],
      ...(errors !== '' && { errors }),
      ...(url !== undefined && { url }),
    };
  }

  private extractTitle(prop: unknown): string {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'title' in prop &&
      Array.isArray((prop as { title: unknown }).title)
    ) {
      const titleArray = (prop as { title: { plain_text?: string }[] }).title;
      return titleArray.map((t) => t.plain_text ?? '').join('');
    }
    return '';
  }

  private extractSelect(prop: unknown): string {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'select' in prop &&
      typeof (prop as { select: unknown }).select === 'object' &&
      (prop as { select: unknown }).select !== null
    ) {
      const select = (prop as { select: { name?: string } }).select;
      return select.name ?? '';
    }
    return '';
  }

  private extractMultiSelect(prop: unknown): string[] {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'multi_select' in prop &&
      Array.isArray((prop as { multi_select: unknown }).multi_select)
    ) {
      const multiSelect = (prop as { multi_select: { name?: string }[] }).multi_select;
      return multiSelect.map((item) => item.name ?? '');
    }
    return [];
  }

  private extractRichText(prop: unknown): string {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'rich_text' in prop &&
      Array.isArray((prop as { rich_text: unknown }).rich_text)
    ) {
      const richText = (prop as { rich_text: { plain_text?: string }[] }).rich_text;
      return richText.map((t) => t.plain_text ?? '').join('');
    }
    return '';
  }

  private extractDate(prop: unknown): string | undefined {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'date' in prop &&
      typeof (prop as { date: unknown }).date === 'object' &&
      (prop as { date: unknown }).date !== null
    ) {
      const date = (prop as { date: { start?: string } }).date;
      return date.start;
    }
    return undefined;
  }

  private extractUrl(prop: unknown): string | undefined {
    if (typeof prop === 'object' && prop !== null && 'url' in prop) {
      const url = (prop as { url: unknown }).url;
      return typeof url === 'string' ? url : undefined;
    }
    return undefined;
  }

  /**
   * Truncate text to fit Notion's limits.
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
