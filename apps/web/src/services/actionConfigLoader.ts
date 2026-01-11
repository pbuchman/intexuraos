/**
 * Action configuration loader.
 * Fetches, parses, validates, and caches the action configuration YAML file.
 */

import { load as parseYaml } from 'js-yaml';
import type { ActionConfig } from '../types/actionConfig';
import { config as appConfig } from '../config';

type ConfigKey = keyof typeof appConfig;

const ENV_VAR_MAPPING: Record<string, ConfigKey> = {
  INTEXURAOS_ACTIONS_AGENT_URL: 'actionsAgentUrl',
  INTEXURAOS_COMMANDS_AGENT_URL: 'commandsAgentServiceUrl',
};

interface CacheEntry {
  config: ActionConfig;
  timestamp: number;
}

const CACHE_DURATION_MS = import.meta.env.DEV ? 60_000 : Infinity;
let cachedConfig: CacheEntry | null = null;

/**
 * Loads the action configuration from YAML file.
 * Uses cache if available and not expired.
 *
 * @returns Promise resolving to ActionConfig
 * @throws Error if config cannot be loaded or is invalid
 */
export async function loadActionConfig(): Promise<ActionConfig> {
  // Check cache
  if (cachedConfig !== null) {
    const age = Date.now() - cachedConfig.timestamp;
    if (age < CACHE_DURATION_MS) {
      return cachedConfig.config;
    }
  }

  // Fetch and parse
  const config = await fetchAndParseConfig();

  // Validate
  validateConfig(config);

  // Cache
  cachedConfig = {
    config,
    timestamp: Date.now(),
  };

  return config;
}

/**
 * Fetches and parses the YAML configuration file.
 *
 * @returns Parsed configuration object
 * @throws Error if fetch or parse fails
 */
async function fetchAndParseConfig(): Promise<ActionConfig> {
  // Add version query param to bust cache (timestamp in dev, could use hash in prod)
  const version = import.meta.env.DEV ? Date.now() : '1';
  const url = `/action-config.yaml?v=${String(version)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch action config: ${String(response.status)} ${response.statusText}`
    );
  }

  const yamlText = await response.text();
  const parsed = parseYaml(yamlText);

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: expected object at root');
  }

  return resolveEnvVariables(parsed as ActionConfig);
}

/**
 * Resolves ${VARIABLE_NAME} placeholders in the configuration using app config.
 *
 * @param config - Raw configuration with placeholders
 * @returns Configuration with resolved values
 */
function resolveEnvVariables(config: ActionConfig): ActionConfig {
  const resolved = structuredClone(config);
  const envVarPattern = /^\$\{(\w+)}$/;

  for (const action of Object.values(resolved.actions)) {
    const endpoint = action.endpoint;

    if (typeof endpoint.baseUrl === 'string') {
      const match = envVarPattern.exec(endpoint.baseUrl);
      if (match !== null) {
        const varName = match[1];
        const configKey = varName !== undefined ? ENV_VAR_MAPPING[varName] : undefined;
        if (configKey !== undefined) {
          endpoint.baseUrl = appConfig[configKey];
        }
      }
    }
  }

  return resolved;
}

/**
 * Validates the structure of the loaded configuration.
 * Uses `unknown` type to allow runtime type checking on parsed YAML.
 *
 * @param config - Configuration to validate
 * @throws Error if validation fails
 */
function validateConfig(config: ActionConfig): void {
  const c = config as unknown as Record<string, unknown>;
  if (c['actions'] === null || typeof c['actions'] !== 'object') {
    throw new Error('Invalid config: missing or invalid "actions" section');
  }

  if (c['types'] === null || typeof c['types'] !== 'object') {
    throw new Error('Invalid config: missing or invalid "types" section');
  }

  // Validate each action definition
  const actions = c['actions'] as Record<string, Record<string, unknown>>;
  for (const [actionId, action] of Object.entries(actions)) {
    if (action['endpoint'] === null || typeof action['endpoint'] !== 'object') {
      throw new Error(`Invalid action "${actionId}": missing endpoint`);
    }

    const endpoint = action['endpoint'] as Record<string, unknown>;
    if (typeof endpoint['path'] !== 'string') {
      throw new Error(`Invalid action "${actionId}": endpoint.path must be string`);
    }

    if (typeof endpoint['method'] !== 'string') {
      throw new Error(`Invalid action "${actionId}": endpoint.method must be string`);
    }

    if (action['ui'] === null || typeof action['ui'] !== 'object') {
      throw new Error(`Invalid action "${actionId}": missing ui`);
    }

    const ui = action['ui'] as Record<string, unknown>;
    if (typeof ui['label'] !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.label must be string`);
    }

    if (typeof ui['variant'] !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.variant must be string`);
    }

    if (typeof ui['icon'] !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.icon must be string`);
    }
  }

  // Validate type mappings
  const types = c['types'] as Record<string, Record<string, unknown>>;
  for (const [typeName, typeConfig] of Object.entries(types)) {
    if (!Array.isArray(typeConfig['actions'])) {
      throw new Error(`Invalid type "${typeName}": actions must be array`);
    }

    for (const mapping of typeConfig['actions'] as { action?: unknown }[]) {
      if (typeof mapping.action !== 'string') {
        throw new Error(`Invalid type "${typeName}": action reference must be string`);
      }

      // Verify action exists
      if (actions[mapping.action] === undefined) {
        throw new Error(
          `Invalid type "${typeName}": references undefined action "${mapping.action}"`
        );
      }
    }
  }
}

/**
 * Gets the fallback configuration (only delete action).
 * Used when the main config fails to load.
 *
 * @returns Minimal fallback configuration
 */
export function getFallbackConfig(): ActionConfig {
  return {
    actions: {
      delete: {
        endpoint: {
          path: '/actions/{actionId}',
          method: 'DELETE',
        },
        ui: {
          label: 'Delete',
          variant: 'danger',
          icon: 'Trash2',
        },
      },
    },
    types: {},
  };
}

/**
 * Clears the cached configuration (useful for testing).
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
