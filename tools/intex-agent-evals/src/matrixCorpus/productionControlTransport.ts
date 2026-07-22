import { GoogleAuth } from 'google-auth-library';

export const MATRIX_CORPUS_PRODUCTION_CONTROL_ORIGIN = 'https://intexuraos.cloud' as const;

interface IdentityHeaders {
  get(name: string): string | null;
}

interface IdentityClient {
  getRequestHeaders(url: string): Promise<IdentityHeaders>;
}

interface ProductionControlAuthorizationOptions {
  readonly createIdentityClient?: () => Promise<IdentityClient>;
}

export function createProductionControlAuthorizationHeaderProvider(
  options: ProductionControlAuthorizationOptions = {}
): () => Promise<string> {
  let identityClient: Promise<IdentityClient> | undefined;
  const createIdentityClient = options.createIdentityClient ?? createGoogleIdentityClient;

  return async (): Promise<string> => {
    identityClient ??= createIdentityClient();
    try {
      const headers = await (
        await identityClient
      ).getRequestHeaders(MATRIX_CORPUS_PRODUCTION_CONTROL_ORIGIN);
      const authorization = headers.get('authorization');
      if (authorization === null || !/^Bearer [A-Za-z0-9._~-]+$/u.test(authorization)) {
        throw new Error('invalid_authorization');
      }
      return authorization;
    } catch {
      identityClient = undefined;
      throw new Error('production_control_authorization_unavailable');
    }
  };
}

async function createGoogleIdentityClient(): Promise<IdentityClient> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(MATRIX_CORPUS_PRODUCTION_CONTROL_ORIGIN);
  return {
    async getRequestHeaders(url): Promise<IdentityHeaders> {
      return await client.getRequestHeaders(url);
    },
  };
}
