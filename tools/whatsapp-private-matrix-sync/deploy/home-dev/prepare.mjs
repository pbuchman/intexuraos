import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const assets = path.dirname(fileURLToPath(import.meta.url));
const options = {};
try {
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === '--prepare-only') {
      options.prepareOnly = true;
      continue;
    }
    if (
      ![
        '--source-sha',
        '--deploy-dir',
        '--env-file',
        '--state-dir',
        '--secrets-dir',
        '--targets-file',
        '--ca-file',
      ].includes(key)
    ) {
      throw new Error('unknown_install_option');
    }
    const value = process.argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error('missing_install_option');
    options[key.slice(2)] = value;
  }
  if (options.prepareOnly !== true) throw new Error('prepare_only_required');
  const sourceSha = options['source-sha'] ?? '';
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('exact_source_sha_required');
  const head = execFileSync('git', ['-C', assets, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== sourceSha) throw new Error('source_revision_mismatch');
  const dirty = execFileSync('git', ['-C', assets, 'status', '--porcelain', '--', '../..'], {
    encoding: 'utf8',
  }).trim();
  if (dirty !== '') throw new Error('canonical_tool_source_not_committed');
  const target = options['deploy-dir'] ?? '/home/pbuchman/services/intexuraos-matrix-sync';
  for (const value of [
    target,
    ...['env-file', 'state-dir', 'secrets-dir', 'targets-file', 'ca-file'].map(
      (key) => options[key]
    ),
  ]) {
    if (typeof value !== 'string' || !/^\/[A-Za-z0-9_./-]+$/.test(value)) {
      throw new Error('explicit_absolute_deployment_paths_required');
    }
  }
  if (
    !(await fs.stat(options['state-dir'])).isDirectory() ||
    !(await fs.stat(options['secrets-dir'])).isDirectory()
  ) {
    throw new Error('protected_directories_missing');
  }
  for (const file of [
    options['targets-file'],
    ...[
      'matrix-access-token',
      'matrix-outbound-auth-token',
      'private-sync-service-account.json',
    ].map((name) => path.join(options['secrets-dir'], name)),
  ]) {
    if (!(await fs.stat(file)).isFile()) throw new Error('protected_adapter_files_missing');
  }
  const publicCa = await fs.readFile(options['ca-file'], 'utf8');
  if (!publicCa.includes('-----BEGIN CERTIFICATE-----') || publicCa.includes('PRIVATE KEY')) {
    throw new Error('public_root_ca_required');
  }
  const suppliedEnv = await fs.readFile(options['env-file'], 'utf8');
  const deploymentKeys = new Set([
    'INTEXURAOS_SOURCE_SHA',
    'MATRIX_SYNC_STATE_DIR',
    'MATRIX_SYNC_SECRETS_DIR',
    'MATRIX_SYNC_TARGETS_FILE',
    'MATRIX_SYNC_CA_FILE',
  ]);
  for (const line of suppliedEnv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    // Compose also accepts export-prefixed and colon assignments. Identify
    // protected keys before requiring the simple KEY=VALUE input format.
    const key = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*[=:]|\s*$)/)?.[1];
    if (key === 'NODE_TLS_REJECT_UNAUTHORIZED') throw new Error('tls_bypass_forbidden');
    if (deploymentKeys.has(key)) throw new Error('deployment_mounts_must_be_explicit_arguments');
    if (!/^[A-Z_][A-Z0-9_]*=[^\r\n]*$/.test(line))
      throw new Error('simple_env_assignments_required');
  }
  const environment = `${suppliedEnv.trimEnd()}\nINTEXURAOS_SOURCE_SHA=${sourceSha}\nMATRIX_SYNC_STATE_DIR=${options['state-dir']}\nMATRIX_SYNC_SECRETS_DIR=${options['secrets-dir']}\nMATRIX_SYNC_TARGETS_FILE=${options['targets-file']}\nMATRIX_SYNC_CA_FILE=${options['ca-file']}\n`;
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const envPath = path.join(target, '.env');
  try {
    const existing = await fs.readFile(envPath, 'utf8');
    if (existing !== environment) throw new Error('existing_deployment_environment_differs');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(envPath, environment, { mode: 0o600, flag: 'wx' });
  }
  await fs.copyFile(path.join(assets, 'compose.yaml'), path.join(target, 'compose.yaml'));
  const unit = (
    await fs.readFile(path.join(assets, 'intexuraos-matrix-sync.service'), 'utf8')
  ).replaceAll('@DEPLOY_DIR@', target);
  await fs.writeFile(path.join(target, 'intexuraos-matrix-sync.service'), unit, { mode: 0o600 });
  execFileSync(
    'docker',
    [
      'compose',
      '--project-name',
      'intexuraos-matrix-sync',
      '--env-file',
      envPath,
      '-f',
      path.join(target, 'compose.yaml'),
      'config',
      '--quiet',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  console.log(JSON.stringify({ prepared: true, started: false, sourceSha, deployDir: target }));
} catch (error) {
  // External command stderr can include configuration. Print only our safe code.
  const safeCode = /^[a-z_]+$/.test(error.message) ? error.message : 'prepare_failed';
  console.error(JSON.stringify({ prepared: false, error: safeCode }));
  process.exitCode = 1;
}
