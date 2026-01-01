/**
 * React hook for loading and filtering action configuration.
 */

import { useEffect, useState } from 'react';
import type { Action } from '../types';
import type { ActionConfig, ResolvedActionButton, UseActionConfigResult } from '../types/actionConfig';
import { evaluateCondition } from '../services/conditionEvaluator';
import { loadActionConfig, getFallbackConfig } from '../services/actionConfigLoader';

/**
 * Hook for getting available action buttons for a specific action.
 *
 * Steps:
 * 1. Loads action configuration from YAML
 * 2. Gets type-specific action mappings
 * 3. Evaluates conditions for each action
 * 4. Returns resolved buttons ready for rendering
 *
 * @param action - Action to get buttons for
 * @returns Resolved buttons, loading state, and error
 */
export function useActionConfig(action: Action): UseActionConfigResult {
  const [config, setConfig] = useState<ActionConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadConfig(): Promise<void> {
      try {
        const loadedConfig = await loadActionConfig();
        if (mounted) {
          setConfig(loadedConfig);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load action config';
          console.warn('Action config load failed, using fallback:', errorMessage);
          setConfig(getFallbackConfig());
          setError(errorMessage);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadConfig();

    return (): void => {
      mounted = false;
    };
  }, []);

  // Resolve buttons once config is loaded
  const buttons: ResolvedActionButton[] = config !== null ? resolveButtons(action, config) : [];

  return { buttons, isLoading, error };
}

/**
 * Resolves action buttons for a specific action based on configuration.
 *
 * @param action - Action to resolve buttons for
 * @param config - Loaded action configuration
 * @returns Array of resolved action buttons
 */
function resolveButtons(action: Action, config: ActionConfig): ResolvedActionButton[] {
  // Get type-specific configuration
  const typeConfig = config.types[action.type];

  if (typeConfig === undefined) {
    console.warn(`No configuration found for action type "${action.type}", using fallback`);
    // Return only delete button as fallback
    const deleteAction = config.actions['delete'];
    if (deleteAction === undefined) {
      return [];
    }
    return [
      {
        id: 'delete',
        label: deleteAction.ui.label,
        variant: deleteAction.ui.variant,
        icon: deleteAction.ui.icon,
        endpoint: deleteAction.endpoint,
        action,
      },
    ];
  }

  // Filter and resolve actions based on conditions
  const resolved: ResolvedActionButton[] = [];

  for (const mapping of typeConfig.actions) {
    const actionDef = config.actions[mapping.action];

    if (actionDef === undefined) {
      console.warn(`Action definition not found: "${mapping.action}"`);
      continue;
    }

    // Evaluate when condition (undefined = always true)
    const conditionsMet = evaluateCondition(action, mapping.when);

    if (conditionsMet) {
      resolved.push({
        id: mapping.action,
        label: actionDef.ui.label,
        variant: actionDef.ui.variant,
        icon: actionDef.ui.icon,
        endpoint: actionDef.endpoint,
        action,
      });
    }
  }

  return resolved;
}
