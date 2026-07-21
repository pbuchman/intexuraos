import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import {
  decodeTestRunDtoV1,
  decodeTestRunListDtoV1,
  decodeTestScenarioDtoV1,
} from './intexAgentTestRunsDecoder.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  TestRunDtoV1,
  TestRunListDtoV1,
  TestScenarioDtoV1,
} from '@/types';

export interface IntexAgentPreferencesResponse {
  instructions: string;
  externalSave: IntexAgentExternalSaveConfig;
  updatedAt: string | null;
}

export interface IntexAgentExternalSaveConfig {
  enabled: boolean;
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
}

export interface SaveIntexAgentPreferencesRequest {
  instructions: string;
  externalSave: IntexAgentExternalSaveConfig;
}

export interface IntexAgentExternalSaveTestResponse {
  status: 'success' | 'failure';
  message: string;
}

export type IntexAgentPromptPreferenceActor =
  | { actor: 'web_ui'; userId: string }
  | { actor: 'agent_tool'; userId: string; sessionId: string; messageId?: string };

export interface IntexAgentPromptPreferenceItem {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntexAgentPromptPreferences {
  userId: string;
  schemaVersion: 1;
  currentVersion: number;
  items: IntexAgentPromptPreferenceItem[];
  renderedPromptBlock: string;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: IntexAgentPromptPreferenceActor | null;
}

export type IntexAgentPromptPreferenceChangeType = 'add' | 'update' | 'delete';

export interface IntexAgentPromptPreferenceVersionSummary {
  version: number;
  changeType: IntexAgentPromptPreferenceChangeType;
  changedItemId?: string;
  previousText?: string;
  nextText?: string;
  itemCount: number;
  createdAt: string;
  createdBy: IntexAgentPromptPreferenceActor;
}

export interface IntexAgentPromptPreferenceVersion
  extends IntexAgentPromptPreferenceVersionSummary {
  id: string;
  userId: string;
  items: IntexAgentPromptPreferenceItem[];
  renderedPromptBlock: string;
}

export interface MutateIntexAgentPromptPreferenceRequest {
  text: string;
  expectedVersion: number;
}

export interface DeleteIntexAgentPromptPreferenceRequest {
  expectedVersion: number;
}

export async function listIntexAgentSessions(accessToken: string): Promise<IntexAgentSession[]> {
  return await apiRequest<IntexAgentSession[]>(config.intexAgentUrl, '/sessions', accessToken);
}

export async function getIntexAgentSession(
  accessToken: string,
  sessionId: string
): Promise<IntexAgentSession> {
  return await apiRequest<IntexAgentSession>(
    config.intexAgentUrl,
    `/sessions/${encodeURIComponent(sessionId)}`,
    accessToken
  );
}

export async function listIntexAgentSessionEvents(
  accessToken: string,
  sessionId: string
): Promise<IntexAgentSessionEvent[]> {
  return await apiRequest<IntexAgentSessionEvent[]>(
    config.intexAgentUrl,
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    accessToken
  );
}

export async function listIntexAgentTestRuns(
  accessToken: string,
  signal?: AbortSignal
): Promise<TestRunListDtoV1> {
  const response =
    signal === undefined
      ? await apiRequest<unknown>(config.intexAgentUrl, '/test-runs', accessToken)
      : await apiRequest<unknown>(config.intexAgentUrl, '/test-runs', accessToken, { signal });
  return decodeTestRunListDtoV1(response);
}

export async function getIntexAgentTestRun(
  accessToken: string,
  runId: string,
  signal?: AbortSignal
): Promise<TestRunDtoV1> {
  const path = `/test-runs/${encodeURIComponent(runId)}`;
  const response =
    signal === undefined
      ? await apiRequest<unknown>(config.intexAgentUrl, path, accessToken)
      : await apiRequest<unknown>(config.intexAgentUrl, path, accessToken, { signal });
  return decodeTestRunDtoV1(response);
}

export async function getIntexAgentTestScenario(
  accessToken: string,
  runId: string,
  scenarioId: string,
  signal?: AbortSignal
): Promise<TestScenarioDtoV1> {
  const path = `/test-runs/${encodeURIComponent(runId)}/scenarios/${encodeURIComponent(scenarioId)}`;
  const response =
    signal === undefined
      ? await apiRequest<unknown>(config.intexAgentUrl, path, accessToken)
      : await apiRequest<unknown>(config.intexAgentUrl, path, accessToken, { signal });
  return decodeTestScenarioDtoV1(response);
}

export async function getIntexAgentPreferences(
  accessToken: string
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken
  );
}

export async function saveIntexAgentPreferences(
  accessToken: string,
  request: SaveIntexAgentPreferencesRequest
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(request),
    }
  );
}

export async function testIntexAgentExternalSave(
  accessToken: string,
  externalSave: IntexAgentExternalSaveConfig
): Promise<IntexAgentExternalSaveTestResponse> {
  return await apiRequest<IntexAgentExternalSaveTestResponse>(
    config.intexAgentUrl,
    '/preferences/external-save/test',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ externalSave }),
    }
  );
}

export async function clearIntexAgentPreferences(
  accessToken: string
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function getIntexAgentPromptPreferences(
  accessToken: string
): Promise<IntexAgentPromptPreferences> {
  return await apiRequest<IntexAgentPromptPreferences>(
    config.intexAgentUrl,
    '/preferences/prompt',
    accessToken
  );
}

export async function addIntexAgentPromptPreference(
  accessToken: string,
  request: MutateIntexAgentPromptPreferenceRequest
): Promise<IntexAgentPromptPreferences> {
  return await apiRequest<IntexAgentPromptPreferences>(
    config.intexAgentUrl,
    '/preferences/prompt/items',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );
}

export async function updateIntexAgentPromptPreference(
  accessToken: string,
  itemId: string,
  request: MutateIntexAgentPromptPreferenceRequest
): Promise<IntexAgentPromptPreferences> {
  return await apiRequest<IntexAgentPromptPreferences>(
    config.intexAgentUrl,
    `/preferences/prompt/items/${encodeURIComponent(itemId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(request),
    }
  );
}

export async function deleteIntexAgentPromptPreference(
  accessToken: string,
  itemId: string,
  request: DeleteIntexAgentPromptPreferenceRequest
): Promise<IntexAgentPromptPreferences> {
  return await apiRequest<IntexAgentPromptPreferences>(
    config.intexAgentUrl,
    `/preferences/prompt/items/${encodeURIComponent(itemId)}`,
    accessToken,
    {
      method: 'DELETE',
      body: JSON.stringify(request),
    }
  );
}

export async function listIntexAgentPromptPreferenceVersions(
  accessToken: string
): Promise<IntexAgentPromptPreferenceVersionSummary[]> {
  return await apiRequest<IntexAgentPromptPreferenceVersionSummary[]>(
    config.intexAgentUrl,
    '/preferences/prompt/versions',
    accessToken
  );
}

export async function getIntexAgentPromptPreferenceVersion(
  accessToken: string,
  version: number
): Promise<IntexAgentPromptPreferenceVersion> {
  return await apiRequest<IntexAgentPromptPreferenceVersion>(
    config.intexAgentUrl,
    `/preferences/prompt/versions/${String(version)}`,
    accessToken
  );
}
