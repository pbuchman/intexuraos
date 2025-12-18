import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { verifyJwt, clearJwksCache, type JwtConfig } from '../auth/jwt.js';

describe('JWT verification', () => {
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  let publicKeyJwk: jose.JWK;

  const issuer = 'https://test-issuer.example.com/';
  const audience = 'test-audience';

  beforeAll(async () => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

    // Export public key as JWK
    publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    // Start local JWKS server
    jwksServer = Fastify({ logger: false });

    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({
        keys: [publicKeyJwk],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(() => {
    clearJwksCache();
  });

  async function createToken(
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

  it('verifies a valid token and returns sub and claims', async () => {
    const token = await createToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    const result = await verifyJwt(token, config);

    expect(result.sub).toBe('user-123');
    expect(result.claims['email']).toBe('test@example.com');
    expect(result.claims['iss']).toBe(issuer);
    expect(result.claims['aud']).toBe(audience);
  });

  it('rejects empty token', async () => {
    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    await expect(verifyJwt('', config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Token is empty',
    });
  });

  it('rejects token with wrong issuer', async () => {
    const token = await createToken({ sub: 'user-123' });

    const config: JwtConfig = {
      jwksUrl,
      issuer: 'https://wrong-issuer.example.com/',
      audience,
    };

    await expect(verifyJwt(token, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects token with wrong audience', async () => {
    const token = await createToken({ sub: 'user-123' });

    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience: 'wrong-audience',
    };

    await expect(verifyJwt(token, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects token missing sub claim', async () => {
    const token = await createToken({});

    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    await expect(verifyJwt(token, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Token missing sub claim',
    });
  });

  it('rejects expired token', async () => {
    const token = await createToken({ sub: 'user-123' }, { expiresIn: '-1s' });

    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    await expect(verifyJwt(token, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Token has expired',
    });
  });

  it('rejects malformed token', async () => {
    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    await expect(verifyJwt('not-a-jwt', config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects token signed with wrong key', async () => {
    // Generate a different key pair
    const { privateKey: wrongKey } = await jose.generateKeyPair('RS256');

    const token = await new jose.SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'RS256', kid: 'wrong-key' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(issuer)
      .setAudience(audience)
      .sign(wrongKey);

    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };

    await expect(verifyJwt(token, config)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
