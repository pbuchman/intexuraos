import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateCodeAgentHealthResponse } from './lib/codeAgentProductionHealth.js';

function parseHeaders(raw: string): Record<string, string> {
  const blocks = raw.trim().split(/\r?\n\r?\n/u).filter((block) => block.trim() !== '');
  const finalBlock = blocks.at(-1) ?? '';
  const headers: Record<string, string> = {};
  for (const line of finalBlock.split(/\r?\n/u).slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runCodeAgentProductionHealthVerifier(argv: readonly string[]): Promise<void> {
  const [statusRaw, headersPath] = argv;
  if (statusRaw === undefined || !/^\d{3}$/u.test(statusRaw) || headersPath === undefined) {
    throw new Error('Usage: verifyCodeAgentProductionHealth.ts <status> <headers-file>');
  }
  const [headersRaw, body] = await Promise.all([readFile(headersPath, 'utf8'), readStdin()]);
  validateCodeAgentHealthResponse({
    status: Number(statusRaw),
    headers: parseHeaders(headersRaw),
    body,
  });
}

const scriptPath = process.argv[1];
if (scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href) {
  void runCodeAgentProductionHealthVerifier(process.argv.slice(2)).catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'HEALTH_VERIFICATION_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
