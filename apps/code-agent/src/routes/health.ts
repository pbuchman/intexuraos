import type { FastifyInstance } from 'fastify';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', () => {
    return { status: 'ok', service: 'code-agent' };
  });
}
