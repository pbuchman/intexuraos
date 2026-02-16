export interface OtelConfig {
  readonly endpoint: string;
  readonly authToken: string;
  readonly environment: string;
}

export function buildOtelConfig(): OtelConfig | undefined {
  const endpoint = process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'];
  if (endpoint === undefined || endpoint === '') {
    return undefined;
  }

  return {
    endpoint,
    authToken: process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] ?? '',
    environment:
      process.env['INTEXURAOS_ENVIRONMENT'] === undefined ||
      process.env['INTEXURAOS_ENVIRONMENT'] === ''
        ? 'unknown'
        : process.env['INTEXURAOS_ENVIRONMENT'],
  };
}
