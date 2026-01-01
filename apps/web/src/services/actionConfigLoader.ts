/**
 * Action configuration loader.
 * Fetches, parses, validates, and caches the action configuration YAML file.
 */

import { load as parseYaml } from 'js-yaml';
import type { ActionConfig } from '../types/actionConfig';

interface CacheEntry {
  config: ActionConfig;
  timestamp: number;
}

const CACHE_DURATION_MS = import.meta.env.DEV ? 0 : 60_000; // 1 min in prod, no cache in dev
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
    throw new Error(`Failed to fetch action config: ${response.status} ${response.statusText}`);
  }

  const yamlText = await response.text();
  const parsed = parseYaml(yamlText);

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: expected object at root');
  }

  return parsed as ActionConfig;
}

/**
 * Validates the structure of the loaded configuration.
 *
 * @param config - Configuration to validate
 * @throws Error if validation fails
 */
function validateConfig(config: ActionConfig): void {
  if (config.actions === null || typeof config.actions !== 'object') {
    throw new Error('Invalid config: missing or invalid "actions" section');
  }

  if (config.types === null || typeof config.types !== 'object') {
    throw new Error('Invalid config: missing or invalid "types" section');
  }

  // Validate each action definition
  for (const [actionId, action] of Object.entries(config.actions)) {
    if (action.endpoint === null || typeof action.endpoint !== 'object') {
      throw new Error(`Invalid action "${actionId}": missing endpoint`);
    }

    if (typeof action.endpoint.path !== 'string') {
      throw new Error(`Invalid action "${actionId}": endpoint.path must be string`);
    }

    if (typeof action.endpoint.method !== 'string') {
      throw new Error(`Invalid action "${actionId}": endpoint.method must be string`);
    }

    if (action.ui === null || typeof action.ui !== 'object') {
      throw new Error(`Invalid action "${actionId}": missing ui`);
    }

    if (typeof action.ui.label !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.label must be string`);
    }

    if (typeof action.ui.variant !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.variant must be string`);
    }

    if (typeof action.ui.icon !== 'string') {
      throw new Error(`Invalid action "${actionId}": ui.icon must be string`);
    }
  }

  // Validate type mappings
  for (const [typeName, typeConfig] of Object.entries(config.types)) {
    if (!Array.isArray(typeConfig.actions)) {
      throw new Error(`Invalid type "${typeName}": actions must be array`);
    }

    for (const mapping of typeConfig.actions) {
      if (typeof mapping.action !== 'string') {
        throw new Error(`Invalid type "${typeName}": action reference must be string`);
      }

      // Verify action exists
      if (config.actions[mapping.action] === undefined) {
        throw new Error(`Invalid type "${typeName}": references undefined action "${mapping.action}"`);
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
          path: '/router/actions/{actionId}',
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
