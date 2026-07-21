export type IntexAgentModelSelectorConfig =
  | { status: 'disabled' }
  | {
      status: 'enabled';
      userId: string;
      openRouterAppApiKey: string;
    };

export interface UserServiceConfig {
  intexAgentModelSelector: IntexAgentModelSelectorConfig;
  intexAgentTestRunsRead:
    | { status: 'disabled' }
    | { status: 'enabled'; runtimeAudience: 'home-dev'; userId: string };
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
  if (userId === 'disabled') {
    return { intexAgentModelSelector: { status: 'disabled' }, intexAgentTestRunsRead };
  }

  const openRouterAppApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
  if (openRouterAppApiKey === undefined || openRouterAppApiKey === '') {
    throw new Error('INTEXURAOS_OPENROUTER_APP_API_KEY is required');
  }
  return {
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
  if (process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] !== 'home-dev')
    throw new Error('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE must be home-dev');
  const userId = process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
  if (userId === undefined || userId === '')
    throw new Error('INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID is required');
  return { status: 'enabled', runtimeAudience: 'home-dev', userId };
}
