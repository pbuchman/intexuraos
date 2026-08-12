/**
 * HTTP client for user-service internal API.
 * Provides access to user API keys and LLM client creation.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ERROR_HTTP_STATUS, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  getProviderForModel,
  DEFAULT_PLATFORM_LLM_MODEL,
  IntexAgentModels,
  isDefaultEligibleModel,
  isIntexAgentModel,
  isLegacyGoogleModel,
  isOpenRouterModel,
  LlmProviders,
  type LlmProvider,
  type ExecutableLlmProvider,
  type DefaultEligibleModel,
} from '@intexuraos/llm-contract';
import {
  createLlmClient,
  type LlmClientConfig,
  type LlmGenerateClient,
  type GenerateOptions,
} from '@intexuraos/llm-factory';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';

import type {
  UserServiceConfig,
  UserServiceError,
  DecryptedApiKeys,
  UserServiceClient,
  OAuthTokenResult,
  OAuthProvider,
  UserTimezoneLookupOptions,
  IntexAgentRuntimeSettingsClient,
  IntexAgentRuntimeSettingsClientError,
  IntexAgentRuntimeSettingsV1,
} from './types.js';

export type { LlmProvider } from '@intexuraos/llm-contract';
export type {
  UserServiceConfig,
  UserServiceError,
  DecryptedApiKeys,
  UserServiceClient,
  OAuthTokenResult,
  OAuthProvider,
  UserTimezoneLookupOptions,
  IntexAgentRuntimeSettingsClient,
  IntexAgentRuntimeSettingsClientError,
  IntexAgentRuntimeSettingsV1,
} from './types.js';

const PROVIDER_KEYS: Record<ExecutableLlmProvider, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  perplexity: 'perplexity',
  openrouter: 'openrouter',
};

const runtimeSettingsTransportLogger = {
  warn: (): void => undefined,
};

function hasOnlyOwnKeys(value: object, expectedKeys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return (
    ownKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isRuntimeSettingsObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype;
}

const runtimeSettingsDiagnosticsKeys: readonly string[] = [
  'requestId',
  'durationMs',
  'downstreamStatus',
  'downstreamRequestId',
  'endpointCalled',
];

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRuntimeSettingsDiagnostics(value: unknown): boolean {
  if (!isRuntimeSettingsObject(value)) {
    return false;
  }

  const ownKeys = Object.keys(value);
  if (
    !hasOwnKey(value, 'requestId') ||
    ownKeys.some((key) => !runtimeSettingsDiagnosticsKeys.includes(key))
  ) {
    return false;
  }

  const requestId = ownValue(value, 'requestId');
  const durationMs = ownValue(value, 'durationMs');
  const downstreamStatus = ownValue(value, 'downstreamStatus');
  const downstreamRequestId = ownValue(value, 'downstreamRequestId');
  const endpointCalled = ownValue(value, 'endpointCalled');

  return (
    typeof requestId === 'string' &&
    (!hasOwnKey(value, 'durationMs') ||
      (typeof durationMs === 'number' && Number.isFinite(durationMs))) &&
    (!hasOwnKey(value, 'downstreamStatus') || Number.isInteger(downstreamStatus)) &&
    (!hasOwnKey(value, 'downstreamRequestId') || typeof downstreamRequestId === 'string') &&
    (!hasOwnKey(value, 'endpointCalled') || typeof endpointCalled === 'string')
  );
}

function hasValidOptionalDiagnostics(value: object, requiredKeys: readonly string[]): boolean {
  if (!hasOwnKey(value, 'diagnostics')) {
    return hasOnlyOwnKeys(value, requiredKeys);
  }

  return (
    hasOnlyOwnKeys(value, [...requiredKeys, 'diagnostics']) &&
    isRuntimeSettingsDiagnostics(ownValue(value, 'diagnostics'))
  );
}

type RuntimeSettingsEnvelopeResult =
  | { status: 'data'; data: unknown }
  | { status: 'api_error' }
  | { status: 'malformed' };

function decodeRuntimeSettingsEnvelope(value: unknown): RuntimeSettingsEnvelopeResult {
  if (!isRuntimeSettingsObject(value)) {
    return { status: 'malformed' };
  }

  const success = ownValue(value, 'success');
  if (success === true) {
    if (!hasValidOptionalDiagnostics(value, ['success', 'data'])) {
      return { status: 'malformed' };
    }
    return { status: 'data', data: ownValue(value, 'data') };
  }

  if (success === false) {
    if (!hasValidOptionalDiagnostics(value, ['success', 'error'])) {
      return { status: 'malformed' };
    }

    const error = ownValue(value, 'error');
    if (
      !isRuntimeSettingsObject(error) ||
      (!hasOnlyOwnKeys(error, ['code', 'message']) &&
        !hasOnlyOwnKeys(error, ['code', 'message', 'details']))
    ) {
      return { status: 'malformed' };
    }

    const errorCode = ownValue(error, 'code');
    if (
      typeof errorCode !== 'string' ||
      !Object.hasOwn(ERROR_HTTP_STATUS, errorCode) ||
      typeof ownValue(error, 'message') !== 'string'
    ) {
      return { status: 'malformed' };
    }

    return { status: 'api_error' };
  }

  return { status: 'malformed' };
}

function decodeIntexAgentRuntimeSettings(value: unknown): IntexAgentRuntimeSettingsV1 | undefined {
  if (!isRuntimeSettingsObject(value)) {
    return undefined;
  }

  const status = ownValue(value, 'status');
  if (status === 'available') {
    if (
      !hasOnlyOwnKeys(value, [
        'status',
        'effectiveModel',
        'explicitModel',
        'source',
        'revision',
        'timeZone',
      ])
    ) {
      return undefined;
    }

    const effectiveModel = ownValue(value, 'effectiveModel');
    const explicitModel = ownValue(value, 'explicitModel');
    const source = ownValue(value, 'source');
    const revision = ownValue(value, 'revision');
    const timeZone = ownValue(value, 'timeZone');
    if (
      !isIntexAgentModel(effectiveModel) ||
      (explicitModel !== null && !isIntexAgentModel(explicitModel)) ||
      (source !== 'explicit' && source !== 'default_absent') ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      typeof timeZone !== 'string'
    ) {
      return undefined;
    }

    if (
      (source === 'explicit' && (explicitModel === null || effectiveModel !== explicitModel)) ||
      (source === 'default_absent' &&
        (explicitModel !== null || effectiveModel !== IntexAgentModels.DeepSeekV4Flash))
    ) {
      return undefined;
    }

    return { status, effectiveModel, explicitModel, source, revision, timeZone };
  }

  if (status === 'unavailable') {
    if (!hasOnlyOwnKeys(value, ['status', 'effectiveModel', 'source', 'timeZone'])) {
      return undefined;
    }

    const effectiveModel = ownValue(value, 'effectiveModel');
    const source = ownValue(value, 'source');
    const timeZone = ownValue(value, 'timeZone');
    if (
      effectiveModel !== IntexAgentModels.DeepSeekV4Flash ||
      source !== 'platform_default' ||
      typeof timeZone !== 'string'
    ) {
      return undefined;
    }

    return {
      status,
      effectiveModel: IntexAgentModels.DeepSeekV4Flash,
      source,
      timeZone,
    };
  }

  return undefined;
}

function runtimeSettingsError(
  code: IntexAgentRuntimeSettingsClientError['code']
): IntexAgentRuntimeSettingsClientError {
  switch (code) {
    case 'TIMEOUT':
      return { code, message: 'User Service runtime settings request timed out' };
    case 'MALFORMED_RESPONSE':
      return { code, message: 'User Service runtime settings response was malformed' };
    case 'NETWORK_ERROR':
    case 'API_ERROR':
      return { code, message: 'User Service runtime settings request failed' };
  }
}

export function providerToKeyField(provider: ExecutableLlmProvider): string {
  return PROVIDER_KEYS[provider];
}

function normalizeLegacyModelPreference(model: string): string {
  if (isLegacyGoogleModel(model)) {
    return DEFAULT_PLATFORM_LLM_MODEL;
  }

  return model;
}

/**
 * Create a user service client with the given configuration.
 */
export function createUserServiceClient(
  config: UserServiceConfig
): UserServiceClient & IntexAgentRuntimeSettingsClient {
  const { logger } = config;
  const runtimeSettingsHttp = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: runtimeSettingsTransportLogger,
    defaultTimeoutMs: 30_000,
  });

  return {
    async resolveIntexAgentRuntimeSettings(
      userId: string
    ): Promise<Result<IntexAgentRuntimeSettingsV1, IntexAgentRuntimeSettingsClientError>> {
      const response = await runtimeSettingsHttp.request<unknown>({
        method: 'GET',
        path: `/internal/users/${encodeURIComponent(userId)}/settings/intex-agent-runtime`,
        timeoutMs: 30_000,
        responseMode: 'raw',
      });

      if (!response.ok) {
        if (response.error.code === 'TIMEOUT') {
          return err(runtimeSettingsError('TIMEOUT'));
        }
        return err(
          runtimeSettingsError(
            response.error.code === 'NETWORK_ERROR' ? 'NETWORK_ERROR' : 'API_ERROR'
          )
        );
      }

      const envelope = decodeRuntimeSettingsEnvelope(response.value);
      if (envelope.status === 'malformed') {
        return err(runtimeSettingsError('MALFORMED_RESPONSE'));
      }
      if (envelope.status === 'api_error') {
        return err(runtimeSettingsError('API_ERROR'));
      }

      const settings = decodeIntexAgentRuntimeSettings(envelope.data);
      if (settings === undefined) {
        return err(runtimeSettingsError('MALFORMED_RESPONSE'));
      }

      return ok(settings);
    },

    async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!response.ok) {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as {
          success: boolean;
          data: {
            openai?: string | null;
            anthropic?: string | null;
            perplexity?: string | null;
            openrouter?: string | null;
          };
        };

        const data = body.data;

        // Convert null values to undefined (null is used by JSON to distinguish from missing)
        const result: DecryptedApiKeys = {};
        if (data.openai !== null && data.openai !== undefined) {
          result.openai = data.openai;
        }
        if (data.anthropic !== null && data.anthropic !== undefined) {
          result.anthropic = data.anthropic;
        }
        if (data.perplexity !== null && data.perplexity !== undefined) {
          result.perplexity = data.perplexity;
        }
        if (data.openrouter !== null && data.openrouter !== undefined) {
          result.openrouter = data.openrouter;
        } else if (config.platformOpenRouterApiKey !== undefined) {
          result.openrouter = config.platformOpenRouterApiKey;
        }

        return ok(result);
      } catch (error) {
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
      logger.info({ userId }, 'Creating LLM client for user');

      try {
        // Step 1: Fetch user settings to get default model
        const settingsResponse = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/settings`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!settingsResponse.ok) {
          logger.error(
            { userId, status: settingsResponse.status },
            'Failed to fetch user settings'
          );
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch user settings: HTTP ${String(settingsResponse.status)}`,
          });
        }

        const settingsBody = (await settingsResponse.json()) as {
          success: boolean;
          data: {
            llmPreferences?: {
              defaultModel: string;
              fallbackModel?: string;
            };
          };
        };

        // Step 2: Determine model (use user's preference or default)
        const rawModel =
          settingsBody.data.llmPreferences?.defaultModel ?? DEFAULT_PLATFORM_LLM_MODEL;
        const fallbackModelRaw = settingsBody.data.llmPreferences?.fallbackModel;

        const defaultModel = normalizeLegacyModelPreference(rawModel);
        const fallbackModel =
          fallbackModelRaw === undefined
            ? undefined
            : normalizeLegacyModelPreference(fallbackModelRaw);

        // Validate that the model is supported (including OpenRouter models)
        if (!isDefaultEligibleModel(defaultModel)) {
          logger.warn({ userId, invalidModel: rawModel }, 'User has invalid model preference');
          return err({
            code: 'INVALID_MODEL',
            message: `Invalid model: ${rawModel}. Please select a valid model.`,
          });
        }

        // Step 3: Get API key for that model
        const provider = getProviderForModel(defaultModel);
        const keyField = providerToKeyField(provider);

        const keysResponse = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!keysResponse.ok) {
          logger.error({ userId, status: keysResponse.status }, 'Failed to fetch API keys');
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch API keys: HTTP ${String(keysResponse.status)}`,
          });
        }

        const keysBody = (await keysResponse.json()) as {
          success: boolean;
          data: Record<string, string | null | undefined>;
        };

        const configuredApiKey = keysBody.data[keyField];
        const apiKey =
          configuredApiKey ??
          (isOpenRouterModel(defaultModel) ? config.platformOpenRouterApiKey : undefined);

        if (apiKey === undefined) {
          if (config.platformOpenRouterApiKey !== undefined) {
            logger.warn(
              { userId, provider, requestedModel: defaultModel },
              'No API key for provider, falling back to platform OpenRouter default'
            );
            const fallbackModel = DEFAULT_PLATFORM_LLM_MODEL;
            const fallbackClient = createLlmClient({
              apiKey: config.platformOpenRouterApiKey,
              model: fallbackModel,
              userId,
              logger: config.logger,
              usageSink: config.usageSink,
              ownerType: 'user',
            });

            logger.info(
              { userId, model: fallbackModel, provider: LlmProviders.OpenRouter },
              'LLM client created successfully'
            );

            return ok(fallbackClient);
          }

          logger.info({ userId, provider }, 'No API key configured for provider');
          return err({
            code: 'NO_API_KEY',
            message: `No API key configured for ${provider}. Please add your ${provider} API key in settings.`,
          });
        }

        // Helper: build a client for a given model using the fetched API keys
        function buildClientForModel(
          model: DefaultEligibleModel,
          apiKeys: Record<string, string | null | undefined>
        ): LlmGenerateClient | null {
          const modelProvider = getProviderForModel(model);
          const modelKeyField = providerToKeyField(modelProvider);
          const modelApiKey =
            apiKeys[modelKeyField] ??
            (isOpenRouterModel(model) ? config.platformOpenRouterApiKey : undefined);
          if (modelApiKey === undefined) return null;

          return createLlmClient({
            apiKey: modelApiKey,
            model,
            userId,
            logger: config.logger,
            usageSink: config.usageSink,
            ownerType: 'user',
          });
        }

        // Step 4: Create and return the LLM client
        const clientConfig: LlmClientConfig = {
          apiKey,
          model: defaultModel,
          userId,
          logger: config.logger,
          usageSink: config.usageSink,
          ownerType: 'user',
        };

        const client: LlmGenerateClient = createLlmClient(clientConfig);

        logger.info({ userId, model: defaultModel, provider }, 'LLM client created successfully');

        // Step 6: Wrap with fallback retry if fallback model is configured
        if (
          fallbackModel !== undefined &&
          fallbackModel !== defaultModel &&
          isDefaultEligibleModel(fallbackModel)
        ) {
          const primaryClient = client;
          const wrappedClient: LlmGenerateClient = {
            async generate(prompt: string, options: GenerateOptions) {
              const primaryResult = await primaryClient.generate(prompt, options);
              if (primaryResult.ok) return primaryResult;

              logger.warn(
                {
                  userId,
                  primaryModel: defaultModel,
                  fallbackModel,
                  error: primaryResult.error,
                  _skipSentry: true,
                },
                'Primary model failed, attempting fallback'
              );

              const fallbackClient = buildClientForModel(fallbackModel, keysBody.data);
              if (fallbackClient === null) {
                logger.warn({ userId, fallbackModel }, 'No API key for fallback model');
                return primaryResult;
              }

              const fallbackResult = await fallbackClient.generate(prompt, options);
              if (fallbackResult.ok) {
                logger.info(
                  { userId, primaryModel: defaultModel, fallbackModel },
                  'Fallback model succeeded after primary failure'
                );
              }
              return fallbackResult;
            },
          };
          return ok(wrappedClient);
        }

        return ok(client);
      } catch (error) {
        logger.error(
          { userId, error: getErrorMessage(error) },
          'Network error while creating LLM client'
        );
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void> {
      try {
        await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`,
          {
            method: 'POST',
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );
      } catch {
        // Best effort - don't block on failure
      }
    },

    async resolveGitHubUsername(
      gitHubUsername: string
    ): Promise<Result<{ userId: string } | null, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/by-github-username/${encodeURIComponent(gitHubUsername)}`,
          { headers: { 'X-Internal-Auth': config.internalAuthToken } }
        );
        if (response.status === 404) return ok(null);
        if (!response.ok) {
          return err({ code: 'API_ERROR', message: `HTTP ${String(response.status)}` });
        }
        const body = (await response.json()) as { success: boolean; data: { userId: string } };
        return ok({ userId: body.data.userId });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getUserTimezone(
      userId: string,
      options?: UserTimezoneLookupOptions
    ): Promise<string | undefined> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/settings`,
          {
            headers: { 'X-Internal-Auth': config.internalAuthToken },
            ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          }
        );

        if (!response.ok) {
          if (options?.throwOnError === true) {
            throw new Error(`HTTP ${String(response.status)}`);
          }
          logger.warn({ userId, status: response.status }, 'Failed to fetch user timezone');
          return undefined;
        }

        const body = (await response.json()) as {
          success: boolean;
          data: {
            timezone?: string;
          };
        };

        return body.data.timezone;
      } catch (error) {
        if (options?.throwOnError === true) {
          throw error;
        }
        logger.warn({ userId, error: getErrorMessage(error) }, 'Failed to fetch user timezone');
        return undefined;
      }
    },

    async getOAuthToken(
      userId: string,
      provider: OAuthProvider
    ): Promise<Result<OAuthTokenResult, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/oauth/${provider}/token`,
          {
            headers: { 'X-Internal-Auth': config.internalAuthToken },
          }
        );

        if (!response.ok) {
          const errorBody = (await response.json()) as { code?: string; error?: string };
          const code = errorBody.code;

          if (code === 'CONNECTION_NOT_FOUND' || response.status === 404) {
            return err({ code: 'CONNECTION_NOT_FOUND', message: 'OAuth not connected' });
          }
          if (code === 'TOKEN_REFRESH_FAILED') {
            return err({ code: 'TOKEN_REFRESH_FAILED', message: 'Failed to refresh token' });
          }
          if (code === 'CONFIGURATION_ERROR') {
            return err({ code: 'OAUTH_NOT_CONFIGURED', message: 'OAuth not configured' });
          }

          return err({
            code: 'API_ERROR',
            message: errorBody.error ?? `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as {
          success: boolean;
          data: { accessToken: string; email: string };
        };
        return ok({ accessToken: body.data.accessToken, email: body.data.email });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
