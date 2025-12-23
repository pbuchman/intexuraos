/**
 * Notion repository for creating inbox notes.
 */
import {
  ok,
  err,
  type Result,
  createNotionClient,
  mapNotionError,
  type NotionError,
} from '@praxos/common';
import type { InboxNote } from '../../domain/inbox/index.js';

/**
 * Create an inbox note in Notion.
 */
export async function createInboxNote(
  token: string,
  databaseId: string,
  note: InboxNote
): Promise<Result<InboxNote, NotionError>> {
  try {
    const client = createNotionClient(token);

    const properties = mapNoteToNotionProperties(note);

    const response = await client.pages.create({
      parent: { database_id: databaseId },
      properties,
    });

    return ok({ ...note, id: response.id });
  } catch (error) {
    return err(mapNotionError(error));
  }
}

/**
 * Map domain InboxNote to Notion properties.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNoteToNotionProperties(note: Partial<InboxNote>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {};

  if (note.title !== undefined) {
    properties['Title'] = { title: [{ text: { content: note.title } }] };
  }

  if (note.status !== undefined) {
    properties['Status'] = { select: { name: note.status } };
  }

  if (note.source !== undefined) {
    properties['Source'] = { select: { name: note.source } };
  }

  if (note.messageType !== undefined) {
    properties['Message type'] = { select: { name: note.messageType } };
  }

  if (note.contentType !== undefined) {
    properties['Type'] = { select: { name: note.contentType } };
  }

  if (note.topics !== undefined && note.topics.length > 0) {
    properties['Topic'] = { multi_select: note.topics.map((topic) => ({ name: topic })) };
  }

  if (note.originalText !== undefined) {
    properties['Original text'] = {
      rich_text: [{ text: { content: truncateText(note.originalText, 2000) } }],
    };
  }

  if (note.cleanText !== undefined) {
    properties['Clean text'] = {
      rich_text: [{ text: { content: truncateText(note.cleanText, 2000) } }],
    };
  }

  if (note.transcript !== undefined) {
    properties['Transcript'] = {
      rich_text: [{ text: { content: truncateText(note.transcript, 2000) } }],
    };
  }

  if (note.capturedAt !== undefined) {
    properties['Captured at'] = { date: { start: note.capturedAt } };
  }

  if (note.sender !== undefined) {
    properties['Sender'] = { rich_text: [{ text: { content: truncateText(note.sender, 2000) } }] };
  }

  if (note.externalId !== undefined) {
    properties['External ID'] = {
      rich_text: [{ text: { content: truncateText(note.externalId, 2000) } }],
    };
  }

  if (note.processingRunId !== undefined) {
    properties['Processing run id'] = {
      rich_text: [{ text: { content: truncateText(note.processingRunId, 2000) } }],
    };
  }

  if (note.processedBy !== undefined) {
    properties['Processed by'] = { select: { name: note.processedBy } };
  }

  if (note.errors !== undefined) {
    properties['Errors'] = {
      rich_text: [{ text: { content: truncateText(note.errors, 2000) } }],
    };
  }

  if (note.url !== undefined) {
    properties['URL'] = { url: note.url };
  }

  return properties;
}

function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.substring(0, maxLength - 3) + '...';
}
