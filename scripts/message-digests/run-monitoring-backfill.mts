import { getFirestore } from '@intexuraos/infra-firestore';
import { backfillDigestMonitoring } from './backfill-monitoring.mjs';

const [projectFlag, projectId, acknowledgement] = process.argv.slice(2);
let firestore: ReturnType<typeof getFirestore> | undefined;
try {
  if (
    projectFlag !== '--project' ||
    !projectId ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId) ||
    acknowledgement !== '--writers-deployed'
  )
    throw new Error('EXPLICIT_PROJECT_AND_DEPLOYED_WRITERS_REQUIRED');
  if (process.env['FIRESTORE_EMULATOR_HOST'] !== undefined)
    throw new Error('LIVE_BACKFILL_REJECTS_EMULATOR');
  process.env['INTEXURAOS_GCP_PROJECT_ID'] = projectId;
  firestore = getFirestore();
  console.log(JSON.stringify(await backfillDigestMonitoring(firestore)));
} catch (error) {
  const allowed = [
    'EXPLICIT_PROJECT_AND_DEPLOYED_WRITERS_REQUIRED',
    'LIVE_BACKFILL_REJECTS_EMULATOR',
    'DIGEST_MONITORING_SOURCE_INVALID',
  ];
  const code =
    error instanceof Error && allowed.includes(error.message)
      ? error.message
      : 'DIGEST_MONITORING_BACKFILL_FAILED';
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
} finally {
  try {
    await firestore?.terminate();
  } catch {
    process.stderr.write('{"error":"DIGEST_MONITORING_CLIENT_CLOSE_FAILED"}\n');
    process.exitCode = 1;
  }
}
