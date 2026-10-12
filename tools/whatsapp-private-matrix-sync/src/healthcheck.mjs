import fs from 'node:fs/promises';

// Never put the bearer in command arguments, health output or Docker inspect.
try {
  const token = (
    await fs.readFile(process.env.MATRIX_OUTBOUND_AUTH_TOKEN_FILE ?? '', 'utf8')
  ).trim();
  if (token === '') throw new Error('missing_health_credential');
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? '8099'}/health`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 200 || (await response.json()).ok !== true) {
    throw new Error('sync_unhealthy');
  }
} catch {
  process.exitCode = 1;
}
