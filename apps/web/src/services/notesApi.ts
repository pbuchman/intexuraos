import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { Note, CreateNoteRequest, UpdateNoteRequest } from '@/types';

export async function createNote(accessToken: string, request: CreateNoteRequest): Promise<Note> {
  return await apiRequest<Note>(config.notesAgentUrl, '/', accessToken, {
    method: 'POST',
    body: request,
  });
}

export async function listNotes(accessToken: string): Promise<Note[]> {
  return await apiRequest<Note[]>(config.notesAgentUrl, '/', accessToken);
}

export async function getNote(accessToken: string, id: string): Promise<Note> {
  return await apiRequest<Note>(config.notesAgentUrl, `/${id}`, accessToken);
}

export async function updateNote(
  accessToken: string,
  id: string,
  request: UpdateNoteRequest
): Promise<Note> {
  return await apiRequest<Note>(config.notesAgentUrl, `/${id}`, accessToken, {
    method: 'PATCH',
    body: request,
  });
}

export async function deleteNote(accessToken: string, id: string): Promise<void> {
  await apiRequest<undefined>(config.notesAgentUrl, `/${id}`, accessToken, {
    method: 'DELETE',
  });
}
