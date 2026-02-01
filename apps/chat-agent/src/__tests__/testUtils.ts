/**
 * Test utilities for chat-agent.
 * Provides JWKS server setup and token creation for authenticated route testing.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';

export const issuer = 'https://test-issuer.example.com/';
export const audience = 'test-audience';

let jwksServer: FastifyInstance;
let privateKey: Awaited<ReturnType<typeof jose.generateKeyPair>>['privateKey'];

/**
 * Create a signed JWT token for testing.
 * Uses the test JWKS server's private key to generate valid tokens.
 */
export async function createToken(
  claims: Record<string, unknown>,
  options?: { expiresIn?: string }
): Promise<string> {
  const builder = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience);

  if (options?.expiresIn !== undefined) {
    builder.setExpirationTime(options.expiresIn);
  } else {
    builder.setExpirationTime('1h');
  }

  return await builder.sign(privateKey);
}

/**
 * Set up a local JWKS server for JWT validation in tests.
 * Sets environment variables that the auth plugin reads.
 */
export async function setupJwksServer(): Promise<void> {
  const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
  privateKey = privKey;

  const publicKeyJwk = await jose.exportJWK(publicKey);
  publicKeyJwk.kid = 'test-key-1';
  publicKeyJwk.alg = 'RS256';
  publicKeyJwk.use = 'sig';

  jwksServer = Fastify({ logger: false });

  jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
    return await reply.send({ keys: [publicKeyJwk] });
  });

  await jwksServer.listen({ port: 0, host: '127.0.0.1' });
  const address = jwksServer.server.address();
  if (address !== null && typeof address === 'object') {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] =
      `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = audience;
  }
}

/**
 * Tear down the JWKS server and clean up environment variables.
 */
export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  delete process.env['INTEXURAOS_AUTH_ISSUER'];
  delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
}
