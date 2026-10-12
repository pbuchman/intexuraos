import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { queueRoutes } from '../../routes/code/queue-routes.js';
import { taskRoutes } from '../../routes/code/task-routes.js';
import { cleanupRoutes } from '../../routes/internal/cleanup-routes.js';
import { mergeQueueTickRoute } from '../../routes/merge-queue/mergeQueueTickRoute.js';
import { CODE_SCHEDULER_JOBS } from '../../routes/jobMonitoring.js';

describe('scheduler route plugin authentication', () => {
  it('protects every scheduler handler independently of the application monitoring hook', async () => {
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    const jwtValidator = async (): Promise<void> => {
      return;
    };
    await app.register(queueRoutes, { jwtValidator });
    await app.register(taskRoutes, { jwtValidator });
    await app.register(cleanupRoutes);
    await app.register(mergeQueueTickRoute);
    for (const path of Object.keys(CODE_SCHEDULER_JOBS)) {
      const response = await app.inject({ method: 'POST', url: path });
      expect(response.statusCode, path).toBe(401);
      expect(response.json().error.code, path).toBe('UNAUTHORIZED');
    }
    await app.close();
  });
});
