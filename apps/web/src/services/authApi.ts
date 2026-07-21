import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { UserInfo, UserSettings } from '@/types';

export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  return await apiRequest<UserInfo>(config.authServiceUrl, '/auth/me', accessToken);
}

export async function getUserSettings(
  accessToken: string,
  userId: string,
  signal?: AbortSignal
): Promise<UserSettings> {
  const path = `/users/${encodeURIComponent(userId)}/settings`;
  const response =
    signal === undefined
      ? await apiRequest<unknown>(config.authServiceUrl, path, accessToken)
      : await apiRequest<unknown>(config.authServiceUrl, path, accessToken, { signal });
  return decodeUserSettings(response);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function decodeTestRunsCapability(value: unknown): UserSettings['intexAgentCapabilities']['testRuns'] {
  if (!isPlainRecord(value) || typeof value['status'] !== 'string') {
    throw new Error('Invalid user settings response');
  }
  if (value['status'] === 'available' && hasExactKeys(value, ['status', 'runtimeAudience']) && value['runtimeAudience'] === 'home-dev') {
    return { status: 'available', runtimeAudience: 'home-dev' };
  }
  if (value['status'] === 'unavailable' && hasExactKeys(value, ['status'])) {
    return { status: 'unavailable' };
  }
  throw new Error('Invalid user settings response');
}

function decodeUserSettings(value: unknown): UserSettings {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(
      value,
      ['userId', 'createdAt', 'updatedAt', 'intexAgentCapabilities'],
      ['timezone']
    ) ||
    typeof value['userId'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['updatedAt'] !== 'string' ||
    (Object.hasOwn(value, 'timezone') && typeof value['timezone'] !== 'string') ||
    !isPlainRecord(value['intexAgentCapabilities']) ||
    !hasExactKeys(value['intexAgentCapabilities'], ['testRuns'])
  ) {
    throw new Error('Invalid user settings response');
  }
  const testRuns = decodeTestRunsCapability(value['intexAgentCapabilities']['testRuns']);
  return {
    userId: value['userId'],
    ...(typeof value['timezone'] === 'string' ? { timezone: value['timezone'] } : {}),
    createdAt: value['createdAt'],
    updatedAt: value['updatedAt'],
    intexAgentCapabilities: { testRuns },
  };
}
