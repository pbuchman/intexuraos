import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  NotesServiceClient,
  CreateNoteRequest,
  CreateNoteResponse,
} from '../../domain/ports/notesServiceClient.js';
import pino, { type Logger } from 'pino';

export interface NotesServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'notesServiceHttpClient',
});

interface ApiResponse {
  success: boolean;
  data?: {
    id: string;
    userId: string;
    title: string;
  };
  error?: { code: string; message: string };
}

export function createNotesServiceHttpClient(
  config: NotesServiceHttpClientConfig
): NotesServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async createNote(request: CreateNoteRequest): Promise<Result<CreateNoteResponse>> {
      const url = `${config.baseUrl}/internal/notes`;

      logger.info({ url, userId: request.userId }, 'Creating note via notes-agent');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(request),
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call notes-agent');
        return err(new Error(`Failed to call notes-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'notes-agent returned error'
        );
        return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from notes-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from notes-agent'));
      }

      const result: CreateNoteResponse = {
        id: body.data.id,
        userId: body.data.userId,
        title: body.data.title,
      };

      logger.info({ noteId: result.id }, 'Note created successfully');
      return ok(result);
    },
  };
}
