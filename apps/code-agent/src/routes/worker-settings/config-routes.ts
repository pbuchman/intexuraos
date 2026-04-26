/**
 * Default-worker-type configuration sub-plugin.
 *
 * Registers the five `PATCH /code/worker-settings/default-*-worker-type`
 * endpoints. Each endpoint updates or clears (via the sentinel
 * `workerType: "auto"`) a single default worker-type field on the user's
 * settings document. All five share a common request body schema,
 * response schema, and use case.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { JwtValidator } from '../codeRoutes.js';
import type { DefaultWorkerTypeField } from '../../domain/ports/workerSettingsRepository.js';
import { createUpdateDefaultWorkerTypeUseCase } from '../../domain/usecases/workerSettings/updateDefaultWorkerType.js';
import { defaultWorkerTypeBody, defaultWorkerTypeResponse } from './schemas.js';

export interface ConfigRoutesOptions {
  jwtValidator: JwtValidator;
}

interface DefaultWorkerTypeRoute {
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly field: DefaultWorkerTypeField;
  readonly label: string;
}

const DEFAULT_WORKER_TYPE_ROUTES: readonly DefaultWorkerTypeRoute[] = [
  {
    path: '/code/worker-settings/default-review-worker-type',
    operationId: 'updateDefaultReviewWorkerType',
    summary: 'Update default review worker type',
    description: 'Set the default worker type for automated PR reviews. Requires Auth0 JWT.',
    field: 'defaultReviewWorkerType',
    label: 'review',
  },
  {
    path: '/code/worker-settings/default-remediation-worker-type',
    operationId: 'updateDefaultRemediationWorkerType',
    summary: 'Update default remediation worker type',
    description: 'Set the default worker type for automated remediations. Requires Auth0 JWT.',
    field: 'defaultRemediationWorkerType',
    label: 'remediation',
  },
  {
    path: '/code/worker-settings/default-execution-worker-type',
    operationId: 'updateDefaultExecutionWorkerType',
    summary: 'Update default execution worker type',
    description: 'Set the default worker type for code execution tasks. Requires Auth0 JWT.',
    field: 'defaultExecutionWorkerType',
    label: 'execution',
  },
  {
    path: '/code/worker-settings/default-planning-worker-type',
    operationId: 'updateDefaultPlanningWorkerType',
    summary: 'Update default planning worker type',
    description: 'Set the default worker type for planning tasks. Requires Auth0 JWT.',
    field: 'defaultPlanningWorkerType',
    label: 'planning',
  },
  {
    path: '/code/worker-settings/default-pull-request-worker-type',
    operationId: 'updateDefaultPullRequestWorkerType',
    summary: 'Update default pull request worker type',
    description: 'Set the default worker type for pull request tasks. Requires Auth0 JWT.',
    field: 'defaultPullRequestWorkerType',
    label: 'pull request',
  },
] as const;

export const configRoutes: FastifyPluginCallback<ConfigRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;

  for (const route of DEFAULT_WORKER_TYPE_ROUTES) {
    fastify.patch<{ Body: { workerType: CodeTaskWorkerType } }>(
      route.path,
      {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onRequest: jwtValidator,
        schema: {
          operationId: route.operationId,
          summary: route.summary,
          description: route.description,
          tags: ['public', 'worker-settings'],
          body: defaultWorkerTypeBody,
          response: defaultWorkerTypeResponse,
        },
      },
      async (
        request: FastifyRequest<{ Body: { workerType: CodeTaskWorkerType } }>,
        reply: FastifyReply
      ) => {
        logIncomingRequest(request, {
          message: `Received request to PATCH ${route.path}`,
        });

        const { workerSettingsRepo } = getServices();
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */
        const { workerType } = request.body;

        const useCase = createUpdateDefaultWorkerTypeUseCase({
          workerSettingsRepo,
          logger: request.log,
        });

        const result = await useCase({
          userId,
          field: route.field,
          label: route.label,
          workerType,
        });

        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }

        return await reply.ok(result.value);
      }
    );
  }

  done();
};

// Exported for tests that need to iterate or assert route configuration.
export { DEFAULT_WORKER_TYPE_ROUTES };
