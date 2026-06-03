import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const nginxConfigPath = resolve(repoRoot, 'scripts/hetzner/nginx/intexuraos.conf');
const jwtVerifierPath = resolve(repoRoot, 'scripts/hetzner/nginx/jwt-verify.lua');
const loadSecretsPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const deployWebPath = resolve(repoRoot, 'scripts/hetzner/deploy-web.sh');
const reloadPm2Path = resolve(repoRoot, 'scripts/hetzner/reload-pm2.sh');
const cutoverEdgePath = resolve(repoRoot, 'scripts/hetzner/cutover-gcp-edge.sh');
const installNginxPath = resolve(repoRoot, 'scripts/hetzner/install-nginx-and-cert.sh');
const provisionPath = resolve(repoRoot, 'scripts/hetzner/provision.sh');
const githubActionsDeployPath = resolve(repoRoot, 'scripts/hetzner/github-actions-deploy.sh');
const runbookPath = resolve(repoRoot, 'docs/operations/hetzner-prod-runbook.md');
const migrationPlanPath = resolve(repoRoot, 'docs/operations/hetzner-prod-migration-plan.md');
const selfReviewPath = resolve(repoRoot, 'docs/operations/hetzner-prod-self-review.md');
const deployWorkflowPath = resolve(repoRoot, '.github/workflows/deploy.yml');
const terraformDevMainPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');
const terraformDevTfvarsExamplePath = resolve(
  repoRoot,
  'terraform/environments/dev/terraform.tfvars.example'
);
const terraformDevPrTriagePath = resolve(
  repoRoot,
  'terraform/environments/dev/pubsub_pr_triage.tf'
);
const terraformPubsubPushModuleMainPath = resolve(
  repoRoot,
  'terraform/modules/pubsub-push/main.tf'
);
const terraformPubsubPushModuleOutputsPath = resolve(
  repoRoot,
  'terraform/modules/pubsub-push/outputs.tf'
);
const terraformPubsubPushModuleVariablesPath = resolve(
  repoRoot,
  'terraform/modules/pubsub-push/variables.tf'
);
const terraformHetznerMainPath = resolve(repoRoot, 'terraform/hetzner-prod/main.tf');
const terraformHetznerImportsPath = resolve(repoRoot, 'terraform/hetzner-prod/imports.tf');
const terraformHetznerBootstrapPath = resolve(repoRoot, 'terraform/hetzner-prod/bootstrap.tf');
const terraformHetznerCloudInitPath = resolve(
  repoRoot,
  'terraform/hetzner-prod/cloud-init.yaml.tftpl'
);
const terraformHetznerPubsubPath = resolve(repoRoot, 'terraform/hetzner-prod/pubsub.tf');
const terraformHetznerSchedulerPath = resolve(repoRoot, 'terraform/hetzner-prod/scheduler.tf');
const terraformHetznerVariablesPath = resolve(repoRoot, 'terraform/hetzner-prod/variables.tf');
const terraformHetznerOutputsPath = resolve(repoRoot, 'terraform/hetzner-prod/outputs.tf');
const terraformHetznerTfvarsExamplePath = resolve(
  repoRoot,
  'terraform/hetzner-prod/terraform.tfvars.example'
);
const terraformHetznerProdAutoTfvarsPath = resolve(
  repoRoot,
  'terraform/hetzner-prod/prod.auto.tfvars.json'
);
const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const pnpmWorkspacePath = resolve(repoRoot, 'pnpm-workspace.yaml');

interface ManifestService {
  name: string;
  apiPath: string;
  proxyTarget: string;
}

function readRequired(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Missing required file: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function upstreamName(serviceName: string): string {
  return serviceName.replace(/-/g, '_');
}

describe('Hetzner nginx runtime config', () => {
  it('defines public API routes that exactly match apps/web/service-manifest.json', () => {
    const config = readRequired(nginxConfigPath);
    const manifest = JSON.parse(readRequired(manifestPath)) as { services: ManifestService[] };
    const publicApiSection = config.slice(
      config.indexOf('location = /api/user'),
      config.indexOf('location /internal/whatsapp/')
    );

    for (const service of manifest.services) {
      const upstream = upstreamName(service.name);
      expect(config, service.apiPath).toContain(`location ${service.apiPath}/`);
      expect(config, service.apiPath).toContain(`proxy_pass http://${upstream}/;`);
    }

    expect(config).toContain('location ~ ^/api/[a-z0-9-]+/internal(?:/|$)');
    expect(config).toContain('return 404;');
    expect(config).toContain('set $edge_internal_auth_token "";');
    expect(config).toContain('proxy_set_header X-Internal-Auth $edge_internal_auth_token;');
    expect(config).toContain('proxy_set_header From "";');
    expect(config).toContain('proxy_set_header Cookie "";');
    expect(config).toContain('return 301 https://intexuraos.cloud$request_uri;');
    expect(config).toContain('if ($host != "intexuraos.cloud") {');
    expect(config).toContain('proxy_set_header X-Forwarded-Host intexuraos.cloud;');
    expect(publicApiSection).not.toContain('proxy_set_header Authorization "";');
    expect(config).toContain('location /oauth/connections/ { proxy_pass http://user_service; }');
    expect(config).toContain('api_docs_hub is intentionally local-only');
    expect(config).not.toContain('/api/mobile-notifications/');
    expect(config).not.toContain('/api/data-insights/');
    expect(config).not.toContain('/api/image/');
    expect(config).not.toContain('/api/app-settings/');
    expect(config).not.toContain('/api/cron/');
    expect(config).not.toContain('/api/hellscript/');
    expect(config).not.toContain('data_insights_agent');
  });

  it('does not forward browser credentials to retained public GCS buckets', () => {
    const config = readRequired(nginxConfigPath);
    const storageSection = config.slice(config.indexOf('location /share/ {'));

    expect(config).toContain('set $gcs_origin storage.googleapis.com;');
    expect(storageSection).toContain(
      'rewrite ^/share/(.*)$ /intexuraos-shared-content-dev/$1 break;'
    );
    expect(storageSection).toContain(
      'rewrite ^/images/(.*)$ /intexuraos-images-dev/images/$1 break;'
    );
    expect(storageSection.match(/proxy_pass https:\/\/\$gcs_origin;/g)).toHaveLength(2);
    expect(storageSection).not.toContain('proxy_pass https://storage.googleapis.com/');
    expect(storageSection.match(/proxy_set_header Authorization "";/g)).toHaveLength(2);
    expect(storageSection.match(/proxy_set_header Cookie "";/g)).toHaveLength(2);
  });

  it('serves PWA shell files with explicit cutover cache headers', () => {
    const config = readRequired(nginxConfigPath);

    expect(config).toContain('location = /sw.js {');
    expect(config).toContain('location = /manifest.webmanifest {');
    expect(config).toContain(
      'add_header Cache-Control "no-cache, no-store, must-revalidate" always;'
    );
    expect(config).toContain('location ~ ^/workbox-[A-Za-z0-9._-]+\\.js$ {');
    expect(config).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable" always;'
    );
  });

  it('fans out all async-control-plane internal routes to the owning service', () => {
    const config = readRequired(nginxConfigPath);
    const routes = [
      ['/internal/whatsapp/', 'whatsapp_service'],
      ['/internal/actions/', 'actions_agent'],
      ['/internal/actions', 'actions_agent'],
      ['/internal/llm/', 'research_agent'],
      ['/internal/commands', 'commands_agent'],
      ['/internal/calendar/', 'calendar_agent'],
      ['/internal/bookmarks/', 'bookmarks_agent'],
      ['/internal/bookmarks', 'bookmarks_agent'],
      ['/internal/todos/', 'todos_agent'],
      ['/internal/todos', 'todos_agent'],
      ['/internal/code/', 'code_agent'],
      ['/internal/code-tasks/', 'code_agent'],
      ['/internal/webhooks/', 'code_agent'],
      ['/internal/logs', 'code_agent'],
      ['/internal/turn-metrics', 'code_agent'],
      ['/internal/merge-conflicts/', 'code_agent'],
      ['/internal/merge-queue/', 'code_agent'],
      ['/internal/execution-memory/', 'code_agent'],
      ['/internal/archive-stale-groups', 'code_agent'],
      ['/internal/auto-archive-merged-tasks', 'code_agent'],
      ['/internal/linear/issue-context/', 'code_agent'],
      ['/internal/linear/sync-all', 'linear_agent'],
      ['/internal/linear/prune-issues', 'linear_agent'],
      ['/internal/cron/', 'cron_agent'],
      ['/internal/notifications/', 'mobile_notifications_service'],
      ['/internal/retry-pending', 'commands_agent'],
      ['/internal/drain-queue', 'code_agent'],
    ];

    for (const [path, upstream] of routes) {
      expect(config, path).toContain(`location ${path}`);
      expect(config, path).toContain(`proxy_pass http://${upstream}`);
    }
  });

  it('protects the entire internal namespace instead of falling through to the SPA', () => {
    const config = readRequired(nginxConfigPath);

    expect(config).toContain('location = /internal {');
    expect(config).toContain('location /internal/ {');
    expect(config).toContain('access_by_lua_file /etc/nginx/lua/jwt-verify.lua;');
    expect(config).toContain('content_by_lua_block');
    expect(config).toContain('ngx.exit(ngx.HTTP_NOT_FOUND)');
  });

  it('requires edge OIDC verification for internal routes and injects trusted internal auth', () => {
    const config = readRequired(nginxConfigPath);
    const verifier = readRequired(jwtVerifierPath);

    expect(config).toContain('access_by_lua_file /etc/nginx/lua/jwt-verify.lua;');
    expect(verifier).toContain('EXPECTED_AUD = "https://intexuraos.cloud"');
    expect(verifier).toContain('ALLOWED_SERVICE_ACCOUNTS');
    expect(verifier).toContain(
      'intexuraos-scheduler-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).toContain(
      'intexuraos-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).not.toContain(
      'intexuraos-linear-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).not.toContain(
      'intexuraos-cron-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).not.toContain(
      'intexuraos-mobile-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).toContain('claims.email');
    expect(verifier).toContain('ngx.HTTP_FORBIDDEN');
    expect(verifier).toContain('ngx.req.clear_header("Authorization")');
    expect(verifier).toContain('ngx.req.clear_header("X-Internal-Auth")');
    expect(verifier).toContain('ngx.req.clear_header("Cookie")');
    expect(verifier).toContain('ngx.req.clear_header("From")');
    expect(verifier).toContain('ngx.var.edge_internal_auth_token = internal_auth_token');
    expect(verifier).not.toContain('ngx.req.set_header("X-Internal-Auth"');
    expect(verifier).toContain('/etc/intexuraos/internal-auth-token');
  });
});

describe('Hetzner web asset deployment', () => {
  it('deploys Hetzner production automatically after development receives a merge', () => {
    const workflow = readRequired(deployWorkflowPath);
    const script = readRequired(githubActionsDeployPath);

    expect(workflow).toContain('name: Deploy');
    expect(workflow).toContain('branches: [development]');
    expect(workflow).toContain('hetzner-prod');
    expect(workflow).toContain('deploy-hetzner-prod:');
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain('HETZNER_DEPLOY_SSH_PRIVATE_KEY');
    expect(workflow).toContain('HETZNER_PROD_HOST');
    expect(workflow).toContain('scripts/hetzner/github-actions-deploy.sh');
    expect(workflow).toContain('deploy-retained-gcp:');
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('gcloud builds triggers run "$TARGET"');
    expect(workflow).not.toContain('deploy-monolith');
    expect(workflow).not.toContain('smart-dispatch');
    expect(workflow).not.toContain('CLOUD_RUN_SERVICES=(');

    expect(script).toContain('HETZNER_DEPLOY_SSH_PRIVATE_KEY');
    expect(script).toContain('HETZNER_PROD_HOST');
    expect(script).toContain('REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"');
    expect(script).toContain('rsync -az --delete');
    expect(script).toContain("--exclude '.git/'");
    expect(script).toContain('RETIRED_REMOTE_PATHS=(');
    expect(script).toContain('"packages/infra-otel"');
    expect(script).toContain('cleanup_retired_remote_paths');
    expect(script).toContain('Removing retired remote path');
    expect(script).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
    );
    expect(script).toContain('CI=true pnpm install --frozen-lockfile');
    expect(script).not.toContain(`pnpm --filter @intexuraos/infra-o${'tel'}`);
    expect(script).toContain('resolve_commit_metadata');
    expect(script).toContain('GITHUB_SHA');
    expect(script).toContain('git rev-parse HEAD');
    expect(script).toContain('git log -1 --pretty=%s');
    expect(script).toContain('COMMIT_SHA=${commit_sha_quoted}');
    expect(script).toContain('COMMIT_MESSAGE=${commit_message_quoted}');
    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh');
    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh');
    expect(script).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
    );
    expect(script).toContain('--resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"');
    expect(script).not.toContain('terraform apply');
    expect(script).not.toContain('gcloud run deploy');
    expect(script).not.toContain('gcloud builds triggers run');
  });

  it('allowlists native dependency build scripts needed by clean production installs', () => {
    const packageJson = JSON.parse(readRequired(packageJsonPath)) as { packageManager?: string };
    const workspace = readRequired(pnpmWorkspacePath);

    expect(packageJson.packageManager).toMatch(/^pnpm@10\./);
    expect(workspace).toContain('onlyBuiltDependencies:');
    for (const packageName of [
      '@firebase/util',
      'browser-tabs-lock',
      'cpu-features',
      'esbuild',
      'protobufjs',
      're2',
      'sharp',
      'ssh2',
    ]) {
      expect(workspace).toMatch(new RegExp(`  - ['"]?${packageName.replace('/', '\\/')}['"]?`));
    }
  });

  it('renders the CJS ecosystem config to JSON before reloading PM2', () => {
    const script = readRequired(reloadPm2Path);
    const runbook = readRequired(runbookPath);
    const plan = readRequired(migrationPlanPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('ecosystem.config.prod.cjs');
    expect(script).toContain('RENDERED_CONFIG=');
    expect(script).toContain('require(configPath)');
    expect(script).toContain('JSON.stringify(config, null, 2)');
    expect(script).toContain('install -m 600');
    expect(script).toContain('pm2 delete all');
    expect(script).toContain('pm2 start "${RENDERED_CONFIG}" --update-env');
    expect(script).toContain('PM2_START_TIMEOUT_SECONDS');
    expect(script).toContain('PM2_SYSTEMD_SERVICE');
    expect(script).toContain('PM2_HEALTH_URLS');
    expect(script).toContain('wait_for_pm2_online()');
    expect(script).toContain('wait_for_http_health()');
    expect(script).toContain('sync_pm2_systemd_service()');
    expect(script).toContain('pm2 jlist');
    expect(script).toContain('http://127.0.0.1:8122/health');
    expect(script).toContain('http://127.0.0.1:8110/health');
    expect(script).toContain("local IFS=' '");
    expect(script).toContain('curl --fail --silent --show-error --max-time 5');
    expect(script).toContain('failed to reach online state');
    expect(script).toContain('HTTP health checks did not become ready');
    expect(script).toContain('pm2 save');
    expect(script).toContain('systemctl start "${PM2_SYSTEMD_SERVICE}"');
    expect(script).toContain('systemctl is-active --quiet "${PM2_SYSTEMD_SERVICE}"');
    const reloadFlow = script.slice(script.indexOf('pm2 delete all'));
    expect(reloadFlow.indexOf('wait_for_pm2_online')).toBeGreaterThan(
      reloadFlow.indexOf('pm2 start "${RENDERED_CONFIG}" --update-env')
    );
    expect(reloadFlow.indexOf('pm2 save')).toBeGreaterThan(
      reloadFlow.indexOf('wait_for_http_health')
    );
    expect(reloadFlow.indexOf('wait_for_http_health')).toBeGreaterThan(
      reloadFlow.indexOf('wait_for_pm2_online')
    );
    expect(reloadFlow.indexOf('sync_pm2_systemd_service')).toBeGreaterThan(
      reloadFlow.indexOf('pm2 save')
    );
    expect(runbook).toContain('scripts/hetzner/reload-pm2.sh');
    expect(plan).toContain('scripts/hetzner/reload-pm2.sh');
  });

  it('bootstraps Corepack when an existing Node 22 install does not provide it', () => {
    const provision = readRequired(provisionPath);

    expect(provision).toContain('ensure_corepack()');
    expect(provision).toContain('command -v corepack >/dev/null 2>&1');
    expect(provision).toContain('npm install -g corepack');
    expect(provision).toContain('npm prefix -g');
    expect(provision).toContain('ln -sfn "${corepack_bin}" /usr/local/bin/corepack');
    expect(provision).toContain('corepack prepare "${package_manager}" --activate');
    expect(provision).toMatch(/ensure_corepack[\s\S]*corepack enable/);
  });

  it('installs an explicit systemd unit for PM2 resurrection', () => {
    const provision = readRequired(provisionPath);

    expect(provision).toContain('write_pm2_systemd_unit()');
    expect(provision).toContain('Type=oneshot');
    expect(provision).toContain('RemainAfterExit=yes');
    expect(provision).toContain('Environment=PM2_HOME=/home/${DEPLOY_USER}/.pm2');
    expect(provision).toContain('ExecStart=${pm2_bin} resurrect');
    expect(provision).toContain('ExecStop=${pm2_bin} kill');
    expect(provision).toContain('systemctl enable "pm2-${DEPLOY_USER}.service"');
    expect(provision).not.toContain('pm2 startup systemd');
  });

  it('provisions swap before runtime builds to avoid OOM during Terraform bootstrap', () => {
    const provision = readRequired(provisionPath);

    expect(provision).toContain('SWAP_FILE="${SWAP_FILE:-/swapfile}"');
    expect(provision).toContain('SWAP_SIZE="${SWAP_SIZE:-4G}"');
    expect(provision).toContain('ensure_swap()');
    expect(provision).toContain('fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}"');
    expect(provision).toContain('chmod 600 "${SWAP_FILE}"');
    expect(provision).toContain('mkswap "${SWAP_FILE}"');
    expect(provision).toContain('swapon "${SWAP_FILE}"');
    expect(provision).toContain('vm.swappiness=10');
    const mainFlow = provision.slice(provision.indexOf('main() {'));
    expect(mainFlow.indexOf('ensure_swap')).toBeGreaterThan(
      mainFlow.indexOf('install_google_cloud_cli')
    );
    expect(mainFlow.indexOf('install_node_22')).toBeGreaterThan(mainFlow.indexOf('ensure_swap'));
  });

  it('builds the SPA and publishes apps/web/dist into the nginx web root', () => {
    const script = readRequired(deployWebPath);
    const provision = readRequired(provisionPath);
    const runbook = readRequired(runbookPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('WEB_SAFE_SECRETS=(');
    expect(script).toContain('clear_intexuraos_env');
    expect(script).toContain('unset "${key}"');
    expect(script).toContain('prepare_sanitized_web_env_file');
    expect(script).toContain('.env.production.local');
    expect(script).toContain('read_env_value "${key}"');
    expect(script).toContain('export_build_metadata');
    expect(script).toContain('COMMIT_SHA');
    expect(script).toContain('COMMIT_MESSAGE');
    expect(script).toContain('COMMIT_SHA is required when COMMIT_MESSAGE is set');
    expect(script).not.toContain('export_web_safe_secrets');
    expect(script).not.toContain('export "${key}=${value}"');
    expect(script).not.toContain('source "${ENV_FILE}"');
    expect(script).not.toContain('set -a');
    expect(script).not.toContain('INTEXURAOS_INTERNAL_AUTH_TOKEN');
    expect(script).not.toContain('INTEXURAOS_GITHUB_APP_PRIVATE_KEY');
    expect(script).not.toContain('INTEXURAOS_OPENAI_APP_API_KEY');
    expect(script).toContain('apps/web/service-manifest.json');
    expect(script).toContain('export "${env_var}=${api_path}"');
    expect(script).toContain('pnpm --filter @intexuraos/web build');
    expect(script).toContain('rsync -a --delete apps/web/dist/ "${WEB_ROOT}/"');
    expect(script).toContain('apps/web/dist/index.html');
    expect(provision).toContain('rsync');
    expect(runbook).toContain('scripts/hetzner/deploy-web.sh');
  });

  it('installs nginx hash sizing in http context before testing and reloading nginx', () => {
    const script = readRequired(resolve(repoRoot, 'scripts/hetzner/deploy-nginx.sh'));
    const siteConfig = readRequired(nginxConfigPath);

    expect(script).toContain('NGINX_HASH_CONFIG_TARGET="/etc/nginx/conf.d/intexuraos-hash.conf"');
    expect(script).toContain('write_nginx_hash_config()');
    expect(script).toContain('variables_hash_max_size 2048;');
    expect(script).toContain('variables_hash_bucket_size 128;');
    expect(script).toContain('install -d -m 755 "$(dirname "${NGINX_HASH_CONFIG_TARGET}")"');
    expect(script).toContain('install -m 644');

    const deployFlow = script.slice(script.indexOf('main() {'));
    expect(deployFlow.indexOf('write_nginx_hash_config')).toBeGreaterThan(
      deployFlow.indexOf('install -m 644 -o root -g root "${NGINX_SOURCE_DIR}/jwt-verify.lua"')
    );
    expect(deployFlow.indexOf('nginx -t')).toBeGreaterThan(
      deployFlow.indexOf('write_nginx_hash_config')
    );
    expect(deployFlow.indexOf('reload_nginx')).toBeGreaterThan(deployFlow.indexOf('nginx -t'));
    expect(siteConfig).not.toContain('variables_hash_max_size');
    expect(siteConfig).not.toContain('variables_hash_bucket_size');
  });
});

describe('Hetzner async edge cutover', () => {
  it('stages retained GCP Pub/Sub and Scheduler consumers in the Hetzner Terraform root', () => {
    const script = readRequired(cutoverEdgePath);
    const runbook = readRequired(runbookPath);
    const devTerraform = readRequired(terraformDevMainPath);
    const prTriageTerraform = readRequired(terraformDevPrTriagePath);
    const hetznerMain = readRequired(terraformHetznerMainPath);
    const hetznerPubsub = readRequired(terraformHetznerPubsubPath);
    const hetznerScheduler = readRequired(terraformHetznerSchedulerPath);
    const hetznerOutputs = readRequired(terraformHetznerOutputsPath);
    const prodAutoTfvars = JSON.parse(readRequired(terraformHetznerProdAutoTfvarsPath)) as {
      activate_hetzner_async_consumers?: boolean;
    };

    expect(script).toContain('PUBSUB_ROUTES=(');
    expect(script).toContain('SCHEDULER_ROUTES=(');
    expect(script).toContain('validate_public_origin');
    expect(script).toContain('PUBLIC_ORIGIN must be an https:// origin without a path');
    expect(script).toContain('PUBLIC_ORIGIN must be exactly https://intexuraos.cloud');
    expect(script).toContain('gcloud pubsub subscriptions update');
    expect(script).toContain('gcloud scheduler jobs update http');
    expect(script).toContain('--push-auth-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('--oidc-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('/internal/linear/sync-all');
    expect(script).toContain('/internal/drain-queue');
    expect(script).toContain('/internal/execution-memory/process');
    expect(devTerraform).not.toContain('variable "hetzner_edge_origin"');
    expect(devTerraform).not.toContain('local.hetzner_edge_origin');
    expect(devTerraform).not.toContain('local.async_edge_audience');
    expect(prTriageTerraform).not.toContain('local.hetzner_edge_origin');
    expect(hetznerMain).toContain('activate_hetzner_async_consumers');
    expect(hetznerPubsub).toContain('google_pubsub_subscription" "hetzner_push"');
    expect(hetznerPubsub).toContain(
      'filter  = var.activate_hetzner_async_consumers ? null : local.pubsub_staging_filter'
    );
    expect(hetznerScheduler).toContain('paused      = !var.activate_hetzner_async_consumers');
    expect(hetznerOutputs).toContain(
      'filter        = subscription.filter == "" ? null : subscription.filter'
    );
    expect(prodAutoTfvars.activate_hetzner_async_consumers).toBe(true);
    expect(runbook).toContain('terraform -chdir=terraform/hetzner-prod apply');
    expect(runbook).toContain('activate_hetzner_async_consumers=false');
    expect(runbook).toContain('activate_hetzner_async_consumers=true');
  });

  it('keeps retained Pub/Sub topics but removes legacy Cloud Run app Scheduler jobs', () => {
    const devTerraform = readRequired(terraformDevMainPath);
    const prTriageTerraform = readRequired(terraformDevPrTriagePath);
    const tfvarsExample = readRequired(terraformDevTfvarsExamplePath);
    const pubsubModule = readRequired(terraformPubsubPushModuleMainPath);
    const pubsubOutputs = readRequired(terraformPubsubPushModuleOutputsPath);
    const pubsubVariables = readRequired(terraformPubsubPushModuleVariablesPath);

    expect(devTerraform).toContain('variable "enable_legacy_cloud_run_async_consumers"');
    expect(devTerraform).toContain('default     = false');
    expect(tfvarsExample).toContain('enable_legacy_cloud_run_async_consumers = false');
    expect(pubsubVariables).toContain('variable "enable_push_subscription"');
    expect(pubsubVariables).toContain('default     = true');
    expect(pubsubModule).toContain('count   = var.enable_push_subscription ? 1 : 0');
    expect(pubsubOutputs).toContain('try(google_pubsub_subscription.push[0].name, null)');
    expect(pubsubOutputs).toContain('try(google_pubsub_subscription.push[0].id, null)');

    for (const moduleName of [
      'pubsub_media_cleanup',
      'pubsub_whatsapp_webhook_process',
      'pubsub_srt_transcription_completed',
      'pubsub_commands_ingest',
      'pubsub_actions_queue',
      'pubsub_research_process',
      'pubsub_llm_analytics',
      'pubsub_llm_call',
      'pubsub_whatsapp_send',
      'pubsub_approval_reply',
      'pubsub_bookmark_enrich',
      'pubsub_bookmark_summarize',
      'pubsub_todos_processing',
      'pubsub_calendar_preview',
      'pubsub_transcription_completed',
    ]) {
      const moduleBody = devTerraform.split(`module "${moduleName}" {`)[1]?.split('\n}')[0] ?? '';
      expect(moduleBody, moduleName).toContain(
        'enable_push_subscription = var.enable_legacy_cloud_run_async_consumers'
      );
      expect(moduleBody, moduleName).toContain('local.retired_cloud_run_push_endpoint');
    }

    expect(prTriageTerraform).toContain(
      'enable_push_subscription = var.enable_legacy_cloud_run_async_consumers'
    );
    expect(prTriageTerraform).toContain('local.retired_cloud_run_push_endpoint');
    expect(devTerraform).toContain('resource "google_pubsub_subscription" "audio_stored_push"');
    expect(devTerraform).not.toContain(
      'resource "google_pubsub_subscription" "audio_stored_push" {\n  count'
    );

    for (const schedulerResource of [
      'mobile_notifications_digest_yesterday',
      'linear_sync_hourly',
      'linear_issues_prune_hourly',
      'cron_agent_tick',
      'retry_pending_commands',
      'retry_pending_actions',
      'drain_task_queue',
      'merge_conflict_reconcile',
      'merge_queue_tick',
      'code_tasks_zombie_sweep',
      'archive_stale_groups',
      'auto_archive_merged_tasks',
      'execution_memory_process',
      'execution_memory_sweep_errored',
      'execution_memory_prune_stale',
    ]) {
      expect(devTerraform, schedulerResource).not.toContain(
        `resource "google_cloud_scheduler_job" "${schedulerResource}"`
      );
    }

    expect(devTerraform).not.toContain('google_cloud_run_service_iam_member" "scheduler_invokes');
    expect(devTerraform).not.toContain('source = "../../modules/cloud-run-service"');
  });
});

describe('Hetzner secret loader', () => {
  it('fails fast unless INTEXURAOS_ENVIRONMENT=prod and writes protected env material', () => {
    const script = readRequired(loadSecretsPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('gcloud secrets versions access');
    expect(script).toContain('HETZNER_RUNTIME_SECRETS=(');
    expect(script).toContain('PROVISIONER_SA_KEY_FILE');
    expect(script).toContain('RUNTIME_SA_KEY_FILE');
    expect(script).toContain('TEMP_ENV_FILE=');
    expect(script).toContain('cleanup_temp_file()');
    expect(script).toContain('trap cleanup_temp_file EXIT');
    expect(script).toContain('GOOGLE_APPLICATION_CREDENTIALS" "${RUNTIME_SA_KEY_FILE}"');
    expect(script).toContain('printf \'%s\\n\' "${HETZNER_RUNTIME_SECRETS[@]}"');
    expect(script).toContain('install -m 600');
    expect(script).toContain('-o "${DEPLOY_USER}" -g "${DEPLOY_USER}"');
    expect(script).toContain('install -d -m 755 "$(dirname "${OUTPUT_FILE}")"');
    expect(script).toContain('install -d -m 755 "$(dirname "${INTERNAL_AUTH_TOKEN_FILE}")"');
    expect(script).toContain('install -m 640 -o root -g "${NGINX_TOKEN_GROUP}"');
    expect(script).toContain('internal-auth-token');
    expect(script).not.toContain('payload.data');
    expect(script).not.toContain('base64 --decode');
    expect(script).not.toContain('base64 is required');
    expect(script).not.toContain('trap \'rm -f "${temp_file}"\' EXIT');
    expect(script).not.toMatch(/echo\s+\$[A-Z_]*SECRET/);
    expect(script).not.toMatch(/set -x/);
    expect(script).not.toContain('extract_terraform_secret_names');
    expect(script).not.toContain('INTEXURAOS_GITHUB_APP_PRIVATE_KEY');
    expect(script).not.toContain('INTEXURAOS_LINEAR_API_KEY');
    expect(script).not.toContain('INTEXURAOS_MINIMAX_APP_API_KEY');
    expect(script).not.toContain('INTEXURAOS_SENTRY_AUTH_TOKEN');
    expect(script).not.toContain('INTEXURAOS_SSL_PRIVATE_KEY');
  });

  it('keeps certbot DNS credentials separate from the Cloudflare Browser Rendering API token', () => {
    const script = readRequired(installNginxPath);
    const provisionScript = readRequired(provisionPath);
    const terraform = readRequired(terraformDevMainPath);

    expect(script).toContain('INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN');
    expect(script).toContain('CLOUDFLARE_DNS_API_TOKEN_SECRET');
    expect(script).toContain('gcloud secrets versions access latest');
    expect(script).not.toContain('payload.data');
    expect(script).not.toContain('base64 --decode');
    expect(script).toContain('if [[ "${SKIP_CERTBOT}" -ne 1 ]]');
    expect(script).toContain('INTEXURAOS_SSL_PRIVATE_KEY');
    expect(script).toContain('terraform/certs/intexuraos.cloud/fullchain.pem');
    expect(script).toContain('install_existing_certificate()');
    expect(script).toContain('install -m 644');
    expect(script).toContain('install -m 600');
    expect(script).toContain('libnginx-mod-http-lua');
    expect(provisionScript).toContain('libnginx-mod-http-lua');
    expect(script).not.toContain('trap \'rm -f "${temp_key}"\' RETURN');
    expect(script).not.toContain('trap \'rm -f "${temp_file}"\' RETURN');
    expect(script).toContain('readFileSync(envFile, "utf8")');
    expect(script).toContain('unquote(line.slice(index + 1))');
    expect(script).not.toContain('sed -n "s/^${key}=//p"');
    expect(script).not.toContain('read_env_value "INTEXURAOS_CLOUDFLARE_API_TOKEN"');
    expect(terraform).not.toContain('"INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN" =');
    expect(terraform).toContain('google_secret_manager_secret" "cloudflare_dns_api_token"');
    expect(terraform).toContain('google_service_account" "hetzner_provisioner"');
    expect(terraform).toContain('google_service_account" "hetzner_runtime"');
    expect(terraform).toContain('hetzner_runtime_project_roles');
    expect(terraform).toContain('roles/datastore.user');
    expect(terraform).toContain('roles/pubsub.publisher');
    expect(terraform).toContain('roles/firebaseauth.admin');
    expect(terraform).toContain('roles/logging.logWriter');
    expect(terraform).toContain('hetzner_runtime_bucket_object_admin');
    expect(terraform).toContain('hetzner_runtime_token_creator');
    expect(terraform).toContain('hetzner_provisioner_cloudflare_dns');
    expect(terraform).toContain('hetzner_provisioner_ssl_private_key');
  });

  it('uses GCP-valid account IDs for Hetzner service accounts', () => {
    const terraform = readRequired(terraformDevMainPath);
    const gcpAccountIdPattern = /^[a-z](?:[-a-z0-9]{4,28}[a-z0-9])$/;
    const hetznerAccountIds = [
      ...terraform.matchAll(/account_id\s+=\s+"([^"]*hetzner[^"]*)"/g),
    ].map((match) => match[1]?.replace('${var.environment}', 'dev'));

    expect(hetznerAccountIds).toHaveLength(2);
    for (const accountId of hetznerAccountIds) {
      expect(accountId).toMatch(gcpAccountIdPattern);
    }
  });

  it('removes the legacy GCP web app hosting knobs after Hetzner cutover', () => {
    const terraform = readRequired(terraformDevMainPath);
    const tfvarsExample = readRequired(terraformDevTfvarsExamplePath);

    expect(terraform).not.toContain('variable "enable_load_balancer"');
    expect(terraform).not.toContain('source = "../../modules/web-app"');
    expect(terraform).not.toContain('module "web_app"');
    expect(tfvarsExample).not.toContain('enable_load_balancer');
    expect(tfvarsExample).not.toContain('web_app_domain');
  });

  it('makes the live Hetzner production environment reproducible from Terraform-managed state', () => {
    const hetznerMain = readRequired(terraformHetznerMainPath);
    const hetznerImports = readRequired(terraformHetznerImportsPath);
    const hetznerBootstrap = readRequired(terraformHetznerBootstrapPath);
    const hetznerCloudInit = readRequired(terraformHetznerCloudInitPath);
    const hetznerServer = readRequired(resolve(repoRoot, 'terraform/hetzner-prod/hetzner.tf'));
    const hetznerServerResource = hetznerServer.split('resource "hcloud_server" "prod" {')[1] ?? '';
    const hetznerVariables = readRequired(terraformHetznerVariablesPath);
    const hetznerTfvarsExample = readRequired(terraformHetznerTfvarsExamplePath);
    const hetznerAutoTfvars = JSON.parse(readRequired(terraformHetznerProdAutoTfvarsPath)) as {
      hetzner_server_type?: string;
      deploy_ssh_public_key?: string;
      admin_ssh_source_ips?: string[];
    };

    expect(hetznerMain).toContain('component   = "prod-hetzner"');
    expect(hetznerMain).toContain('environment = var.environment');
    expect(hetznerServer).toContain('user_data');
    expect(hetznerServer).toContain('cloud-init.yaml.tftpl');
    expect(hetznerServer).toContain('delete_protection  = false');
    expect(hetznerServer).toContain('rebuild_protection = false');
    expect(hetznerServerResource).not.toContain('prevent_destroy = true');
    expect(hetznerCloudInit).toContain('name: deploy');
    expect(hetznerCloudInit).toContain('NOPASSWD:ALL');
    expect(hetznerCloudInit).toContain('ssh_authorized_keys');
    expect(hetznerBootstrap).toContain('resource "terraform_data" "bootstrap_prod"');
    expect(hetznerBootstrap).toContain('hcloud_server.prod.id');
    expect(hetznerBootstrap).toContain('provisioner_sa_key_path');
    expect(hetznerBootstrap).toContain('runtime_sa_key_path');
    expect(hetznerBootstrap).toContain('rsync -az --delete');
    expect(hetznerBootstrap).toContain('scripts/hetzner/provision.sh --skip-certbot');
    expect(hetznerBootstrap).toContain('pnpm install --frozen-lockfile');
    expect(hetznerBootstrap).not.toContain(`infra-o${'tel'}`);
    expect(hetznerBootstrap).toContain("git -C '${local.repo_root}' rev-parse HEAD");
    expect(hetznerBootstrap).toContain("git -C '${local.repo_root}' log -1 --pretty=%s");
    expect(hetznerBootstrap).toContain('COMMIT_SHA=$commit_sha_quoted');
    expect(hetznerBootstrap).toContain('COMMIT_MESSAGE=$commit_message_quoted');
    expect(hetznerBootstrap).toContain('scripts/hetzner/deploy-web.sh');
    expect(hetznerBootstrap).toContain('scripts/hetzner/reload-pm2.sh');
    expect(hetznerBootstrap).toContain('scripts/hetzner/deploy-nginx.sh');
    expect(hetznerVariables).toContain('default     = "prod"');
    expect(hetznerVariables).toContain('default     = "cx33"');
    expect(hetznerVariables).toContain('deploy_ssh_private_key_path');
    expect(hetznerVariables).toContain('provisioner_sa_key_path');
    expect(hetznerVariables).toContain('runtime_sa_key_path');
    expect(hetznerTfvarsExample).toContain('environment = "prod"');
    expect(hetznerTfvarsExample).toContain('hetzner_server_type = "cx33"');
    expect(hetznerTfvarsExample).toMatch(/hetzner_bootstrap_enabled\s+=\s+true/);
    expect(hetznerAutoTfvars.hetzner_server_type).toBe('cx33');
    expect(hetznerAutoTfvars.deploy_ssh_public_key).toMatch(/^ssh-ed25519 /);
    expect(hetznerAutoTfvars.admin_ssh_source_ips).toEqual(['0.0.0.0/0', '::/0']);

    for (const importId of [
      '110595122',
      '125976522',
      '10824053',
      'intexuraos-bookmark-summarize-prod-hetzner',
      'intexuraos-whatsapp-media-cleanup-prod-hetzner',
      'intexuraos-llm-analytics-prod-hetzner',
      'intexuraos-whatsapp-webhook-process-prod-hetzner',
      'intexuraos-bookmark-enrich-prod-hetzner',
      'intexuraos-actions-queue-prod-hetzner',
      'intexuraos-commands-ingest-prod-hetzner',
      'intexuraos-approval-reply-prod-hetzner',
      'intexuraos-calendar-preview-prod-hetzner',
      'intexuraos-todos-processing-prod-hetzner',
      'intexuraos-research-process-prod-hetzner',
      'intexuraos-llm-call-prod-hetzner',
      'intexuraos-srt-transcription-completed-prod-hetzner',
    ]) {
      expect(hetznerImports).toContain(importId);
    }

    expect(hetznerImports).not.toContain('126413082');
  });
});

describe('Hetzner migration readiness documentation', () => {
  it('documents the integration PR workflow, cutover gate, endpoint changes, and rollback plan', () => {
    const plan = readRequired(migrationPlanPath);

    expect(plan).toContain('Linear: INT-1637');
    expect(plan).toContain('Parent issue: INT-1632');
    expect(plan).toContain('Superseded PRs');
    expect(plan).toContain('#2095');
    expect(plan).toContain('#2097');
    expect(plan).toContain('#2098');
    expect(plan).toContain('#2099');
    expect(plan).toContain('close the superseded PRs only after the replacement PR is open');
    expect(plan).toContain('Endpoint Changes');
    expect(plan).toContain('Modified');
    expect(plan).toContain('Created');
    expect(plan).toContain('Removed');
    expect(plan).toContain('Unchanged');
    expect(plan).toContain('Static web `/` and `/index.html` are served by Hetzner nginx');
    expect(plan).toContain('Retained GCS bucket routes `/share/*` and `/images/*`');
    expect(plan).toContain('Provider callback endpoints');
    expect(plan).toContain('api-docs-hub remains local-only on Hetzner');
    expect(plan).toContain('Do not execute migration or DNS cutover without explicit approval');
    expect(plan).toContain('terraform -chdir=terraform/hetzner-prod plan');
    expect(plan).toContain('terraform -chdir=terraform/hetzner-prod apply');
    expect(plan).toContain('activate_hetzner_async_consumers=false');
    expect(plan).toContain('activate_hetzner_async_consumers=true');
    expect(plan).toContain('disable the old Cloud Run-targeted Pub/Sub push consumers');
    expect(plan).toContain('pause the old app-targeted Cloud Scheduler jobs');
    expect(plan).toContain('restore the old Cloud Run-targeted Pub/Sub push consumers');
    expect(plan).toContain('Cloudflare DNS');
    expect(plan).toContain('162.55.210.48');
    expect(plan).toContain('136.110.232.83');
    expect(plan).toContain('enable_load_balancer=false');
    expect(plan).toContain('cloudflared');
    expect(plan).toContain('www');
    expect(plan).toContain('rollback');
  });

  it('records a final service and retained-resource disposition self-review', () => {
    const review = readRequired(selfReviewPath);

    for (const name of [
      'user-service',
      'api-docs-hub',
      'fishing-assistant-service',
      'llm-usage-service',
      'web frontend',
      'workers/transcription',
      'workers/vm-lifecycle',
      'workers/orchestrator',
      'docker/code-worker',
      'Firestore',
      'Pub/Sub topics',
      'Cloud Scheduler jobs',
      'Secret Manager',
      'GCS buckets',
      'Cloud Functions',
      'Artifact Registry',
      'Cloud Build',
      'monitoring',
    ]) {
      expect(review).toContain(name);
    }

    expect(review).toContain('name | type | disposition');
    expect(review).toContain('PM2 port 8133; api-docs-hub remains local-only on Hetzner');
    expect(review).toContain('migrated');
    expect(review).toContain('retained');
    expect(review).toContain('removed');
    expect(review).toContain('INT-1633');
    expect(review).toContain('INT-1634');
    expect(review).toContain('INT-1635');
    expect(review).toContain('INT-1636');
    expect(review).toContain('INT-1637');
  });
});
