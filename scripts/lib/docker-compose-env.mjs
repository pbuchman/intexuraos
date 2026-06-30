import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function readDockerConfig(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function linkDockerSubdir(sourceConfigDir, targetConfigDir, name) {
  const source = join(sourceConfigDir, name);
  if (!existsSync(source)) {
    return;
  }

  const stats = lstatSync(source);
  if (!stats.isDirectory() && !stats.isSymbolicLink()) {
    return;
  }

  symlinkSync(source, join(targetConfigDir, name));
}

export function createDockerComposeEnv(options = {}) {
  const env = options.env ?? process.env;
  const home = env.HOME ?? '';
  const activeConfigDir = env.DOCKER_CONFIG ?? (home === '' ? '' : join(home, '.docker'));
  const configPath = activeConfigDir === '' ? '' : join(activeConfigDir, 'config.json');
  const config = configPath === '' ? null : readDockerConfig(configPath);

  if (config === null || config.credsStore === undefined) {
    return {
      env,
      dockerConfigDir: activeConfigDir,
      cleanup() {},
    };
  }

  const dockerConfigDir = mkdtempSync(join(options.tmpParent ?? tmpdir(), 'intex-docker-config-'));
  const rewritten = { ...config };
  delete rewritten.credsStore;

  writeFileSync(join(dockerConfigDir, 'config.json'), `${JSON.stringify(rewritten, null, 2)}\n`);
  linkDockerSubdir(dirname(configPath), dockerConfigDir, 'cli-plugins');
  linkDockerSubdir(dirname(configPath), dockerConfigDir, 'contexts');

  return {
    env: {
      ...env,
      DOCKER_CONFIG: dockerConfigDir,
    },
    dockerConfigDir,
    cleanup() {
      rmSync(dockerConfigDir, { recursive: true, force: true });
    },
  };
}
