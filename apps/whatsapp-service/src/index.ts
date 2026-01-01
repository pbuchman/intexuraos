import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize services with config
  const serviceConfig: Parameters<typeof initServices>[0] = {
    mediaBucket: config.mediaBucket,
    gcpProjectId: config.gcpProjectId,
    mediaCleanupTopic: config.mediaCleanupTopic,
    whatsappAccessToken: config.accessToken,
    whatsappPhoneNumberId: config.allowedPhoneNumberIds[0] ?? '',
    speechmaticsApiKey: config.speechmaticsApiKey,
  };

  if (config.commandsIngestTopic !== undefined) {
    serviceConfig.commandsIngestTopic = config.commandsIngestTopic;
  }
  if (config.webhookProcessTopic !== undefined) {
    serviceConfig.webhookProcessTopic = config.webhookProcessTopic;
  }
  if (config.transcriptionTopic !== undefined) {
    serviceConfig.transcriptionTopic = config.transcriptionTopic;
  }

  initServices(serviceConfig);

  const app = await buildServer(config);

  const close = (): void => {
    app.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
