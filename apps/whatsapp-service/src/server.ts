import Fastify, { type FastifyInstance } from 'fastify';
import { praxosFastifyPlugin } from '@praxos/common';
import { getFirestore } from '@praxos/infra-firestore';
import { createV1Routes } from './v1/routes.js';
import { validateConfigEnv, type Config } from './config.js';

const SERVICE_NAME = 'whatsapp-service';
const SERVICE_VERSION = '0.0.1';

type HealthStatus = 'ok' | 'degraded' | 'down';

interface HealthCheck {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

interface HealthResponse {
  status: HealthStatus;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheck[];
}

function checkSecrets(): HealthCheck {
  const start = Date.now();
  const missing = validateConfigEnv();

  return {
    name: 'secrets',
    status: missing.length === 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: missing.length > 0 ? { missing } : null,
  };
}

async function checkFirestore(): Promise<HealthCheck> {
  const start = Date.now();

  // Skip actual Firestore check in test environment
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] !== undefined) {
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: { note: 'Skipped in test environment' },
    };
  }

  try {
    const db = getFirestore();
    // Simple connectivity check with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Firestore health check timed out'));
      }, 3000);
    });

    await Promise.race([db.listCollections(), timeoutPromise]);
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      name: 'firestore',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: message },
    };
  }
}

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    // Enable raw body access for signature validation
  });

  // Add content type parser to capture raw body
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      // Store raw body for signature validation
      (req as unknown as { rawBody: string }).rawBody = body as string;
      const json: unknown = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(praxosFastifyPlugin);

  // Register v1 routes
  await app.register(createV1Routes(config));

  // Health endpoint (NOT wrapped in envelope per api-contracts.md)
  app.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            required: ['status', 'serviceName', 'version', 'timestamp', 'checks'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              serviceName: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'status', 'latencyMs'],
                  properties: {
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
                    latencyMs: { type: 'number' },
                    details: { type: 'object', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const started = Date.now();
      const firestoreCheck = await checkFirestore();
      const checks: HealthCheck[] = [checkSecrets(), firestoreCheck];
      const status = computeOverallStatus(checks);

      const response: HealthResponse = {
        status,
        serviceName: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString(),
        checks: checks.map((c) => c),
      };

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
