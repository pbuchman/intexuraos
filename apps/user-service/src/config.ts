export type IntexAgentModelSelectorConfig =
  | { status: 'disabled' }
  | {
      status: 'enabled';
      userId: string;
      openRouterAppApiKey: string;
    };

export interface UserServiceConfig {
  platformOpenRouterApiKey?: string;
  intexAgentModelSelector: IntexAgentModelSelectorConfig;
  intexAgentTestRunsRead:
    | { status: 'disabled' }
    | { status: 'enabled'; runtimeAudience: 'hetzner-prod'; userId: string };
}

export function loadConfig(): UserServiceConfig {
  const readFlag = process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'];
  if (readFlag !== 'true' && readFlag !== 'false') {
    throw new Error('INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED must be true or false');
  }
  const intexAgentTestRunsRead = readFlag === 'false'
    ? ({ status: 'disabled' } as const)
    : loadEnabledTestRunsReadConfig();
  const userId = process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'];
  if (userId === undefined || userId === '') {
    throw new Error('INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID is required');
  }
  const openRouterAppApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY']?.trim();
  if (userId === 'disabled') {
    return {
      ...(openRouterAppApiKey !== undefined &&
        openRouterAppApiKey !== '' && { platformOpenRouterApiKey: openRouterAppApiKey }),
      intexAgentModelSelector: { status: 'disabled' },
      intexAgentTestRunsRead,
    };
  }

  if (openRouterAppApiKey === undefined || openRouterAppApiKey === '') {
    throw new Error('INTEXURAOS_OPENROUTER_APP_API_KEY is required');
  }
  return {
    platformOpenRouterApiKey: openRouterAppApiKey,
    intexAgentModelSelector: {
      status: 'enabled',
      userId,
      openRouterAppApiKey,
    },
    intexAgentTestRunsRead,
  };
}

function loadEnabledTestRunsReadConfig(): Extract<
  UserServiceConfig['intexAgentTestRunsRead'],
  { status: 'enabled' }
> {
  if (process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] !== 'hetzner-prod')
    throw new Error('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE must be hetzner-prod');
  const userId = process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
  if (userId === undefined || userId === '')
    throw new Error('INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID is required');
  return { status: 'enabled', runtimeAudience: 'hetzner-prod', userId };
}
