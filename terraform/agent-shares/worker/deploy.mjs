import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { functionOrigin } from './origin.mjs';

const [value, mode, ...extra] = process.argv.slice(2);
const origin = functionOrigin(value);
if (!origin || (mode !== undefined && mode !== '--dry-run') || extra.length !== 0) {
  console.error('Usage: node deploy.mjs <Terraform function_origin HTTPS run.app URL> [--dry-run]');
  process.exit(2);
}

const args = ['deploy', '--config', 'wrangler.json', '--var', `FUNCTION_ORIGIN:${origin}`];
if (mode === '--dry-run') args.push('--dry-run');

const result = spawnSync('wrangler', args, {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  stdio: 'inherit',
});

if (result.error) console.error(`Could not run Wrangler (${result.error.code}).`);
process.exitCode = result.status ?? 1;
