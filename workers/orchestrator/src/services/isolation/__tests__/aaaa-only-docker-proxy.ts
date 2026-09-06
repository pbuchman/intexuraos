import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface AaaaOnlyDockerProxyConfig {
  readonly directory: string;
  readonly host: string;
  readonly ipv6Address: string;
  readonly realDockerPath: string;
}

interface AaaaOnlyDockerProxy {
  readonly environment: Readonly<Record<string, string>>;
  readonly executable: string;
}

export function createAaaaOnlyDockerProxy(config: AaaaOnlyDockerProxyConfig): AaaaOnlyDockerProxy {
  const executable = join(config.directory, 'docker');
  writeFileSync(
    executable,
    `#!/bin/bash
set -euo pipefail

if [[ "\${1:-}" == "run" ]]; then
  arguments=("$@")
  image_index=$((\${#arguments[@]} - 1))
  exec "$AAAA_ONLY_REAL_DOCKER" \
    "\${arguments[@]:0:image_index}" \
    --add-host "$AAAA_ONLY_HOST=$AAAA_ONLY_IPV6" \
    "\${arguments[@]:image_index}"
fi

exec "$AAAA_ONLY_REAL_DOCKER" "$@"
`,
    'utf8'
  );
  chmodSync(executable, 0o755);

  return {
    environment: {
      AAAA_ONLY_HOST: config.host,
      AAAA_ONLY_IPV6: config.ipv6Address,
      AAAA_ONLY_REAL_DOCKER: config.realDockerPath,
    },
    executable,
  };
}
