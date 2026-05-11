/**
 * Error from service client operations.
 */
export interface ServiceClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

/**
 * Configuration for internal service clients.
 */
export interface ServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: import('@intexuraos/common-core').Logger;
}

export type { ServiceClientOptions } from './http.js';
export { fetchWithAuth } from './http.js';
