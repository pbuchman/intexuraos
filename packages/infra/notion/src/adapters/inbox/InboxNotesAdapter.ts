/**
 * Inbox Notes Notion adapter.
 * Implements InboxNotesRepository using Notion API.
 */
import { Client, isNotionClientError, APIErrorCode } from '@notionhq/client';
import { ok, err, type Result } from '@praxos/common';
import type {
  InboxNote,
  InboxNotesRepository,
  CreateInboxNoteParams,
  UpdateInboxNoteParams,
  InboxError,
  InboxErrorCode,
} from '@praxos/domain-inbox';

/**
 * Configuration for Inbox Notes adapter.
 */
export interface InboxNotesAdapterConfig {
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
 * Map Notion API errors to inbox domain errors.
 */
function mapNotionError(error: unknown): InboxError {
  if (isNotionClientError(error)) {
    let code: InboxErrorCode = 'INTERNAL_ERROR';

    switch (error.code) {
      case APIErrorCode.Unauthorized:
        code = 'UNAUTHORIZED';
        break;
      case APIErrorCode.ObjectNotFound:
        code = 'NOT_FOUND';
        break;
      case APIErrorCode.RateLimited:
        code = 'RATE_LIMITED';
        break;
      case APIErrorCode.ValidationError:
      case APIErrorCode.InvalidJSON:
      case APIErrorCode.ConflictError:
        code = 'VALIDATION_ERROR';
        break;
      default:
        code = 'INTERNAL_ERROR';
    }

    return {
      code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : 'Unknown Notion API error';
  return {
    code: 'INTERNAL_ERROR',
    message,
  };
}

/**
 * Extract text from rich text property.
 */
function extractRichText(prop: unknown): string {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'rich_text' in prop &&
    Array.isArray((prop as { rich_text: unknown[] }).rich_text)
  ) {
    const richTextArray = (prop as { rich_text: { plain_text?: string }[] }).rich_text;
    return richTextArray.map((t) => t.plain_text ?? '').join('');
  }
  return '';
}

/**
 * Extract select value from select property.
 */
function extractSelect(prop: unknown): string | undefined {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'select' in prop &&
    (prop as { select: unknown }).select !== null &&
    typeof (prop as { select: { name?: string } }).select === 'object'
  ) {
    return (prop as { select: { name?: string } }).select.name;
  }
  return undefined;
}

/**
 * Extract multi-select values from multi-select property.
 */
function extractMultiSelect(prop: unknown): string[] {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'multi_select' in prop &&
    Array.isArray((prop as { multi_select: unknown[] }).multi_select)
  ) {
    return (prop as { multi_select: { name?: string }[] }).multi_select
      .map((item) => item.name)
      .filter((name): name is string => name !== undefined);
  }
  return [];
}

/**
 * Extract date from date property.
 */
function extractDate(prop: unknown): Date | undefined {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'date' in prop &&
    (prop as { date: unknown }).date !== null &&
    typeof (prop as { date: { start?: string } }).date === 'object'
  ) {
    const start = (prop as { date: { start?: string } }).date.start;
    if (start) {
      return new Date(start);
    }
  }
  return undefined;
}

/**
 * Extract relation IDs from relation property.
 */
function extractRelationIds(prop: unknown): string[] {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'relation' in prop &&
    Array.isArray((prop as { relation: unknown[] }).relation)
  ) {
    return (prop as { relation: { id?: string }[] }).relation
      .map((item) => item.id)
      .filter((id): id is string => id !== undefined);
  }
  return [];
}

/**
 * Extract URL from URL property.
 */
function extractUrl(prop: unknown): string | undefined {
  if (typeof prop === 'object' && prop !== null && 'url' in prop) {
    const url = (prop as { url: unknown }).url;
    return typeof url === 'string' ? url : undefined;
  }
  return undefined;
}

/**
 * Extract title from title property.
 */
function extractTitle(prop: unknown): string {
  if (
    typeof prop === 'object' &&
    prop !== null &&
    'title' in prop &&
    Array.isArray((prop as { title: unknown[] }).title)
  ) {
    const titleArray = (prop as { title: { plain_text?: string }[] }).title;
    return titleArray.map((t) => t.plain_text ?? '').join('');
  }
  return 'Untitled';
}

/**
 * Convert Notion page response to InboxNote domain entity.
 */
function pageToInboxNote(page: { id: string; properties: Record<string, unknown> }): InboxNote {
  const props = page.properties;

  return {
    id: page.id,
    title: extractTitle(props['Title']),
    status: (extractSelect(props['Status']) as InboxNote['status']) ?? 'Inbox',
    source: (extractSelect(props['Source']) as InboxNote['source']) ?? 'WhatsApp',
    messageType: (extractSelect(props['Message type']) as InboxNote['messageType']) ?? 'Text',
    type: (extractSelect(props['Type']) as InboxNote['type']) ?? 'Other',
    topics: extractMultiSelect(props['Topic']) as InboxNote['topics'],
    originalText: extractRichText(props['Original text']),
    cleanText: extractRichText(props['Clean text']) || undefined,
    transcript: extractRichText(props['Transcript']) || undefined,
    media: [], // Media files are complex, skipping for now
    capturedAt: extractDate(props['Captured at']) ?? new Date(),
    sender: extractRichText(props['Sender']) || undefined,
    externalId: extractRichText(props['External ID']) || undefined,
    processingRunId: extractRichText(props['Processing run id']) || undefined,
    processedBy: (extractSelect(props['Processed by']) as InboxNote['processedBy']) ?? 'None',
    errors: extractRichText(props['Errors']) || undefined,
    actionIds: extractRelationIds(props['Actions']),
    url: extractUrl(props['URL']),
  };
}

/**
 * Notion adapter for Inbox Notes.
 */
export class InboxNotesAdapter implements InboxNotesRepository {
  private readonly client: Client;
  private readonly databaseId: string;

  constructor(config: InboxNotesAdapterConfig) {
    this.client = new Client({ auth: config.token });
    this.databaseId = config.databaseId;
  }

  async create(params: CreateInboxNoteParams): Promise<Result<InboxNote, InboxError>> {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: this.databaseId },
        properties: {
          Title: {
            title: [{ text: { content: params.title } }],
          },
          Status: { select: { name: 'Inbox' } },
          Source: { select: { name: params.source } },
          'Message type': { select: { name: params.messageType } },
          Type: { select: { name: params.type ?? 'Other' } },
          Topic: {
            multi_select: (params.topics ?? []).map((t) => ({ name: t })),
          },
          'Original text': {
            rich_text: [{ text: { content: params.originalText } }],
          },
          ...(params.cleanText && {
            'Clean text': {
              rich_text: [{ text: { content: params.cleanText } }],
            },
          }),
          ...(params.transcript && {
            Transcript: {
              rich_text: [{ text: { content: params.transcript } }],
            },
          }),
          ...(params.sender && {
            Sender: {
              rich_text: [{ text: { content: params.sender } }],
            },
          }),
          ...(params.externalId && {
            'External ID': {
              rich_text: [{ text: { content: params.externalId } }],
            },
          }),
          'Processed by': { select: { name: 'None' } },
          Errors: { rich_text: [{ text: { content: '' } }] },
          'Captured at': {
            date: { start: params.capturedAt.toISOString() },
          },
          ...(params.url && {
            URL: { url: params.url },
          }),
        },
      });

      if (!('properties' in response)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const note = pageToInboxNote(response as { id: string; properties: Record<string, unknown> });
      return ok(note);
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async getById(id: string): Promise<Result<InboxNote | null, InboxError>> {
    try {
      const response = await this.client.pages.retrieve({ page_id: id });

      if (!('properties' in response)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const note = pageToInboxNote(response as { id: string; properties: Record<string, unknown> });
      return ok(note);
    } catch (error) {
      const mappedError = mapNotionError(error);
      if (mappedError.code === 'NOT_FOUND') {
        return ok(null);
      }
      return err(mappedError);
    }
  }

  async getByExternalId(externalId: string): Promise<Result<InboxNote | null, InboxError>> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          property: 'External ID',
          rich_text: {
            equals: externalId,
          },
        },
        page_size: 1,
      });

      if (response.results.length === 0) {
        return ok(null);
      }

      const firstResult = response.results[0];
      if (firstResult && 'properties' in firstResult) {
        const note = pageToInboxNote(firstResult as { id: string; properties: Record<string, unknown> });
        return ok(note);
      }

      return err({
        code: 'INTERNAL_ERROR',
        message: 'Unexpected page response format',
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async update(params: UpdateInboxNoteParams): Promise<Result<InboxNote, InboxError>> {
    try {
      const properties: Record<string, Record<string, unknown>> = {};

      if (params.status) {
        properties['Status'] = { select: { name: params.status } };
      }
      if (params.cleanText !== undefined) {
        properties['Clean text'] = {
          rich_text: [{ text: { content: params.cleanText } }],
        };
      }
      if (params.transcript !== undefined) {
        properties['Transcript'] = {
          rich_text: [{ text: { content: params.transcript } }],
        };
      }
      if (params.processedBy) {
        properties['Processed by'] = { select: { name: params.processedBy } };
      }
      if (params.processingRunId !== undefined) {
        properties['Processing run id'] = {
          rich_text: [{ text: { content: params.processingRunId } }],
        };
      }
      if (params.errors !== undefined) {
        properties['Errors'] = {
          rich_text: [{ text: { content: params.errors } }],
        };
      }
      if (params.actionIds !== undefined) {
        properties['Actions'] = {
          relation: params.actionIds.map((id) => ({ id })),
        };
      }
      if (params.topics !== undefined) {
        properties['Topic'] = {
          multi_select: params.topics.map((t) => ({ name: t })),
        };
      }
      if (params.type) {
        properties['Type'] = { select: { name: params.type } };
      }

      const response = await this.client.pages.update({
        page_id: params.id,
        properties: properties as never,
      });

      if (!('properties' in response)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const note = pageToInboxNote(response as { id: string; properties: Record<string, unknown> });
      return ok(note);
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async queryByStatus(status: InboxNote['status']): Promise<Result<InboxNote[], InboxError>> {
    try {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: {
          property: 'Status',
          select: {
            equals: status,
          },
        },
        sorts: [
          {
            property: 'Captured at',
            direction: 'ascending',
          },
        ],
      });

      const notes: InboxNote[] = [];
      for (const page of response.results) {
        if ('properties' in page) {
          notes.push(pageToInboxNote(page as { id: string; properties: Record<string, unknown> }));
        }
      }

      return ok(notes);
    } catch (error) {
      return err(mapNotionError(error));
    }
  }
}
