import {
  initWorker,
  type WorkerBootstrap,
  type WorkerBootstrapConfig,
} from '@intexuraos/infra-sentry';

const config: WorkerBootstrapConfig = {
  serviceName: 'vm-lifecycle',
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
};
const dsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (dsn !== undefined && dsn !== '') {
  config.sentryDsn = dsn;
}

const bootstrap: WorkerBootstrap = initWorker(config);

export const logger: WorkerBootstrap['logger'] = bootstrap.logger;
export const flush: WorkerBootstrap['flush'] = bootstrap.flush;
