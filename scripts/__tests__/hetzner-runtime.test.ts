import { execFileSync, spawnSync } from 'node:child_process';
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
const prodEcosystemPath = resolve(repoRoot, 'ecosystem.config.prod.cjs');
const cutoverEdgePath = resolve(repoRoot, 'scripts/hetzner/cutover-gcp-edge.sh');
const pubsubPublishTestPath = resolve(repoRoot, 'scripts/pubsub-publish-test.mjs');
const installNginxPath = resolve(repoRoot, 'scripts/hetzner/install-nginx-and-cert.sh');
const provisionPath = resolve(repoRoot, 'scripts/hetzner/provision.sh');
const githubActionsDeployPath = resolve(repoRoot, 'scripts/hetzner/github-actions-deploy.sh');
const installPm2LogrotatePath = resolve(repoRoot, 'scripts/hetzner/install-pm2-logrotate.sh');
const runbookPath = resolve(repoRoot, 'docs/operations/hetzner-prod-runbook.md');
const pubsubDlqRunbookPath = resolve(repoRoot, 'docs/operations/pubsub-dlq-runbook.md');
const migrationPlanPath = resolve(repoRoot, 'docs/operations/hetzner-prod-migration-plan.md');
const selfReviewPath = resolve(repoRoot, 'docs/operations/hetzner-prod-self-review.md');
const deployWorkflowPath = resolve(repoRoot, '.github/workflows/deploy.yml');
const terraformDevMainPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');
const terraformIamMainPath = resolve(repoRoot, 'terraform/modules/iam/main.tf');
const terraformIamOutputsPath = resolve(repoRoot, 'terraform/modules/iam/outputs.tf');
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
const terraformPubsubModuleMainPath = resolve(repoRoot, 'terraform/modules/pubsub/main.tf');
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
const terraformHetznerRetiredAsyncCleanupPath = resolve(
  repoRoot,
  'terraform/hetzner-prod/retired-async-cleanup.tf'
);
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
const terraformMonitoringCodeTaskAlertsPath = resolve(
  repoRoot,
  'terraform/modules/monitoring/code-task-alerts.tf'
);
const terraformMonitoringMainPath = resolve(repoRoot, 'terraform/modules/monitoring/main.tf');
const terraformMonitoringOutputsPath = resolve(repoRoot, 'terraform/modules/monitoring/outputs.tf');
const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const pnpmWorkspacePath = resolve(repoRoot, 'pnpm-workspace.yaml');
const pubsubUiServerPath = resolve(repoRoot, 'tools/pubsub-ui/server.mjs');
const pubsubUiIndexPath = resolve(repoRoot, 'tools/pubsub-ui/index.html');
const pubsubUiReadmePath = resolve(repoRoot, 'tools/pubsub-ui/README.md');

const REMOVED_AGENT_SERVICES = new Set(['todos', 'chat', 'cron'].map((name) => `${name}-agent`));
const retiredRoute = (resource: string) => `/api/${resource}`;
const retiredDashed = (...parts: string[]) => parts.join('-');
const retiredUnderscored = (...parts: string[]) => parts.join('_');

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

    for (const service of manifest.services.filter(
      (entry) => !REMOVED_AGENT_SERVICES.has(entry.name)
    )) {
      const upstream = upstreamName(service.name);
      if (service.name === 'code-agent') {
        expect(config, service.apiPath).toContain(`location ^~ ${service.apiPath}/`);
      } else {
        expect(config, service.apiPath).toContain(`location ${service.apiPath}/`);
      }
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
    expect(config).not.toContain(retiredRoute(retiredDashed('cron', 'agent')));
    expect(config).not.toContain('/api/todos');
    expect(config).not.toContain('/api/chat');
    expect(config).not.toContain(retiredUnderscored('todos', 'agent'));
    expect(config).not.toContain(retiredUnderscored('chat', 'agent'));
    expect(config).not.toContain(retiredUnderscored('cron', 'agent'));
    expect(config).not.toContain('/api/hellscript/');
    expect(config).not.toContain('data_insights_agent');
  });

  it('routes canonical code-agent internal callbacks before the public internal deny rule', () => {
    const config = readRequired(nginxConfigPath);

    expect(config).toContain('location ^~ /api/code/ { proxy_pass http://code_agent/; }');
    expect(config.indexOf('location ^~ /api/code/')).toBeLessThan(
      config.indexOf('location ~ ^/api/[a-z0-9-]+/internal(?:/|$)')
    );
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
      ['/internal/llm/', 'research_agent'],
      ['/internal/calendar/', 'calendar_agent'],
      ['/internal/bookmarks/', 'bookmarks_agent'],
      ['/internal/bookmarks', 'bookmarks_agent'],
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
      ['/internal/intex-agent/', 'intex_agent'],
      ['/internal/linear/sync-all', 'linear_agent'],
      ['/internal/linear/prune-issues', 'linear_agent'],
      ['/internal/notifications/', 'mobile_notifications_service'],
      ['/internal/drain-queue', 'code_agent'],
      ['/internal/users/', 'user_service'],
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
    const hetznerMain = readRequired(terraformHetznerMainPath);
    const runbook = readRequired(runbookPath);

    expect(config).toContain('access_by_lua_file /etc/nginx/lua/jwt-verify.lua;');
    expect(config).toContain('client_max_body_size 25m;');
    expect(verifier).toContain('EXPECTED_AUD = "https://intexuraos.cloud"');
    expect(verifier).toContain('GLOBAL_ALLOWED_SERVICE_ACCOUNTS');
    expect(verifier).toContain('ROUTE_ALLOWED_SERVICE_ACCOUNTS');
    expect(verifier).toContain('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS');
    expect(verifier).toContain('ngx.var.uri');
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
      'intexuraos-todos-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).not.toContain(
      'intexuraos-mobile-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).toContain(
      'ixos-transcription-fn-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    const retiredCommandServiceAccount = `intexuraos-${retiredDashed(
      'commands',
      'agents'
    )}-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`;
    const retiredActionServiceAccount = `intexuraos-${retiredDashed(
      'actions'
    )}-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`;
    expect(verifier).not.toContain(retiredCommandServiceAccount);
    expect(verifier).not.toContain(retiredActionServiceAccount);
    expect(verifier).toContain('claims.email');
    expect(verifier).toContain('ngx.HTTP_FORBIDDEN');
    expect(verifier).toContain('ngx.req.clear_header("Authorization")');
    expect(verifier).toContain('ngx.req.clear_header("X-Internal-Auth")');
    expect(verifier).toContain('ngx.req.clear_header("Cookie")');
    expect(verifier).toContain('ngx.req.clear_header("From")');
    expect(verifier).toContain('ngx.var.edge_internal_auth_token = internal_auth_token');
    expect(verifier).not.toContain('ngx.req.set_header("X-Internal-Auth"');
    expect(verifier).toContain('/etc/intexuraos/internal-auth-token');

    const globalAllowlist = verifier.slice(
      verifier.indexOf('GLOBAL_ALLOWED_SERVICE_ACCOUNTS'),
      verifier.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS')
    );
    const routeAllowlist = verifier.slice(
      verifier.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS'),
      verifier.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS')
    );
    const routePrefixAllowlist = verifier.slice(
      verifier.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS')
    );
    expect(globalAllowlist).not.toContain(
      'intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(routeAllowlist).toContain('["/internal/whatsapp/private/events"]');
    expect(routeAllowlist).toContain('["/internal/whatsapp/private/media"]');
    expect(routeAllowlist).toContain('["/internal/whatsapp/private/media/backfill"]');
    expect(routeAllowlist).toContain(
      'intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(routePrefixAllowlist).toContain('["/internal/users/"]');
    expect(routePrefixAllowlist).toContain(
      'ixos-transcription-fn-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(hetznerMain).toContain('"/internal/whatsapp/private/events"');
    expect(hetznerMain).toContain('"/internal/whatsapp/private/media"');
    expect(hetznerMain).toContain('"/internal/whatsapp/private/media/backfill"');
    expect(hetznerMain).toContain('"/internal/users/"');
    expect(runbook).toContain('POST https://intexuraos.cloud/internal/whatsapp/private/events');
    expect(runbook).toContain('POST https://intexuraos.cloud/internal/whatsapp/private/media');
    expect(runbook).toContain(
      'POST https://intexuraos.cloud/internal/whatsapp/private/media/backfill'
    );

    const allowFunction = verifier.slice(
      verifier.indexOf('local function is_service_account_allowed'),
      verifier.indexOf('local auth_header')
    );
    const routeLookupIndex = allowFunction.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS[ngx.var.uri]');
    const routePrefixLookupIndex = allowFunction.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS');
    const globalLookupIndex = allowFunction.indexOf('GLOBAL_ALLOWED_SERVICE_ACCOUNTS[email]');
    expect(routeLookupIndex).toBeGreaterThanOrEqual(0);
    expect(routePrefixLookupIndex).toBeGreaterThan(routeLookupIndex);
    expect(globalLookupIndex).toBeGreaterThan(routePrefixLookupIndex);
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
    expect(script).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
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
    expect(script).toContain('verify_non_404_route');
    expect(script).toContain('"/api/code/internal/logs"');
    expect(script).toContain('Code-agent callback route returned 404');
    expect(script.indexOf('scripts/observability/install-grafana-alloy.sh')).toBeGreaterThan(
      script.indexOf('scripts/hetzner/load-secrets.sh')
    );
    expect(script.indexOf('scripts/observability/install-grafana-alloy.sh')).toBeLessThan(
      script.indexOf('CI=true pnpm install --frozen-lockfile')
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
    expect(script).toContain('PM2_HEALTH_URLS="${PM2_HEALTH_URLS:-}"');
    expect(script).toContain(
      'PM2_HEALTH_CONSECUTIVE_SUCCESSES="${PM2_HEALTH_CONSECUTIVE_SUCCESSES:-3}"'
    );
    expect(script).toContain('derive_health_urls()');
    expect(script).toContain('config.apps');
    expect(script).toContain('app.env?.PORT');
    expect(script).toContain('http://127.0.0.1:${port}/health');
    expect(script).toContain('wait_for_pm2_online()');
    expect(script).toContain('wait_for_http_health()');
    expect(script).toContain('sync_pm2_systemd_service()');
    expect(script).toContain('pm2 jlist');
    expect(script).toContain("local IFS=' '");
    expect(script).toContain('healthy_passes=$((healthy_passes + 1))');
    expect(script).toContain('healthy_passes=0');
    expect(script).toContain('curl --fail --silent --show-error --max-time 5');
    expect(script).toContain('failed to reach online state');
    expect(script).toContain('PM2 health checks did not remain ready');
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
    expect(runbook).toContain('PM2_HEALTH_CONSECUTIVE_SUCCESSES=3');
    expect(runbook).not.toContain('for port in');
    expect(plan).toContain('scripts/hetzner/reload-pm2.sh');

    const renderedConfig = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          'const config = require(process.argv[1]); process.stdout.write(JSON.stringify(config));',
          prodEcosystemPath,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, INTEXURAOS_ENVIRONMENT: 'prod' },
        }
      )
    ) as { apps: Array<{ env?: { PORT?: string } }> };
    const ports = renderedConfig.apps.map((app) => Number(app.env?.PORT));
    expect(ports).toHaveLength(18);
    expect(ports.every((port) => Number.isInteger(port) && port > 0 && port <= 65535)).toBe(true);
    expect(new Set(ports).size).toBe(18);
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

  it('installs and verifies Lua modules required by the nginx JWT verifier before reload', () => {
    const jwtVerifier = readRequired(jwtVerifierPath);
    const installNginx = readRequired(installNginxPath);
    const provision = readRequired(provisionPath);
    const deployNginx = readRequired(resolve(repoRoot, 'scripts/hetzner/deploy-nginx.sh'));

    expect(jwtVerifier).toContain('require("cjson.safe")');
    expect(jwtVerifier).toContain('require("resty.openidc")');
    expect(installNginx).toContain('lua-cjson');
    expect(provision).toContain('lua-cjson');
    expect(deployNginx).toContain('verify_lua_jwt_dependencies()');
    expect(deployNginx).toContain('lua5.1 <<');
    expect(deployNginx).toContain('pcall(require, "cjson.safe")');
    expect(deployNginx).toContain('package.loaders[2]("resty.openidc")');
    expect(deployNginx).not.toContain('require("cjson.safe"); require("resty.openidc")');

    const deployFlow = deployNginx.slice(deployNginx.indexOf('main() {'));
    expect(deployFlow.indexOf('verify_lua_jwt_dependencies')).toBeGreaterThan(
      deployFlow.indexOf('ln -sfn "${SITE_TARGET}" "${SITE_ENABLED}"')
    );
    expect(deployFlow.indexOf('nginx -t')).toBeGreaterThan(
      deployFlow.indexOf('verify_lua_jwt_dependencies')
    );
    expect(deployFlow.indexOf('reload_nginx')).toBeGreaterThan(deployFlow.indexOf('nginx -t'));
  });

  it('installs Grafana Alloy during provisioning and deploy for durable PM2 log collection', () => {
    const provision = readRequired(provisionPath);
    const deploy = readRequired(githubActionsDeployPath);

    expect(provision).toContain('install_grafana_alloy_collector()');
    expect(provision).toContain(
      'INTEXURAOS_ENVIRONMENT=prod "${SCRIPT_DIR}/../observability/install-grafana-alloy.sh"'
    );
    expect(provision).toContain('Grafana Alloy PM2 log collector');
    expect(deploy).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
    );
    expect(deploy).toContain('scripts/observability/install-grafana-alloy.sh');

    const provisionFlow = provision.slice(provision.indexOf('main() {'));
    expect(provisionFlow.indexOf('install_grafana_alloy_collector')).toBeGreaterThan(
      provisionFlow.indexOf('load-secrets.sh')
    );
  });

  it('installs validated bounded PM2 log rotation during provisioning and deploy', () => {
    const nonProd = spawnSync('bash', [installPm2LogrotatePath, '--render'], {
      encoding: 'utf8',
      env: { ...process.env, INTEXURAOS_ENVIRONMENT: 'dev', PM2_BIN: '/usr/bin/pm2' },
    });
    expect(nonProd.status).not.toBe(0);
    expect(nonProd.stderr).toContain('INTEXURAOS_ENVIRONMENT must be prod');

    const rendered = execFileSync('bash', [installPm2LogrotatePath, '--render'], {
      encoding: 'utf8',
      env: { ...process.env, INTEXURAOS_ENVIRONMENT: 'prod', PM2_BIN: '/usr/bin/pm2' },
    });
    for (const directive of [
      '/home/deploy/.pm2/logs/*.log',
      'daily',
      'maxsize 100M',
      'rotate 14',
      'compress',
      'delaycompress',
      'missingok',
      'notifempty',
      'su deploy deploy',
      'create 0640 deploy deploy',
      'sharedscripts',
      'reloadLogs',
    ]) {
      expect(rendered).toContain(directive);
    }

    const installer = readRequired(installPm2LogrotatePath);
    const provision = readRequired(provisionPath);
    const deploy = readRequired(githubActionsDeployPath);
    const runbook = readRequired(runbookPath);
    expect(installer).toContain('logrotate --debug "${TEMP_CONFIG}"');
    expect(installer).toContain(
      'install -o root -g root -m 0644 "${TEMP_CONFIG}" "${LOGROTATE_CONFIG_PATH}"'
    );
    expect(installer).toContain('trap cleanup EXIT');
    expect(provision).toContain('logrotate');
    expect(provision).toContain('install_pm2_logrotate()');
    expect(provision).toContain(
      'INTEXURAOS_ENVIRONMENT=prod "${SCRIPT_DIR}/install-pm2-logrotate.sh"'
    );
    expect(deploy).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
    );
    expect(deploy.indexOf('scripts/hetzner/install-pm2-logrotate.sh')).toBeGreaterThan(
      deploy.indexOf('scripts/observability/install-grafana-alloy.sh')
    );
    expect(deploy.indexOf('scripts/hetzner/install-pm2-logrotate.sh')).toBeLessThan(
      deploy.indexOf('CI=true pnpm install --frozen-lockfile')
    );
    expect(runbook).toContain('/etc/logrotate.d/intexuraos-pm2');
    expect(runbook).toContain('three consecutive');
  });
});

describe('Code-task automation monitoring', () => {
  it('grants code-agent permission to write Cloud Monitoring custom metrics when prod metrics are enabled', () => {
    const prodEcosystem = readRequired(resolve(repoRoot, 'ecosystem.config.prod.cjs'));
    const iamMain = readRequired(terraformIamMainPath);

    expect(prodEcosystem).toContain(
      "INTEXURAOS_ENABLE_METRICS: envValue('INTEXURAOS_ENABLE_METRICS') ?? 'true'"
    );
    expect(iamMain).toMatch(
      /resource "google_project_iam_member" "code_agent_monitoring_metric_writer" \{[\s\S]*?project = var\.project_id[\s\S]*?role\s+=\s+"roles\/monitoring\.metricWriter"[\s\S]*?member\s+=\s+"serviceAccount:\$\{google_service_account\.code_agent\.email\}"[\s\S]*?\}/
    );
  });

  it('alerts specifically when Hetzner PR-triage Pub/Sub push delivery fails', () => {
    const alerts = readRequired(terraformMonitoringCodeTaskAlertsPath);
    const outputs = readRequired(terraformMonitoringOutputsPath);

    expect(alerts).toContain('code_pr_triage_hetzner_push_5xx');
    expect(alerts).toContain('code_pr_triage_hetzner_backlog');
    expect(alerts).toContain('intexuraos-pr-triage-prod-hetzner');
    expect(alerts).toContain('pubsub.googleapis.com/subscription/push_request_count');
    expect(alerts).toContain('metric.labels.response_class="remote_server_5xx"');
    expect(alerts).toContain('pubsub.googleapis.com/subscription/num_undelivered_messages');
    expect(outputs).toContain('code_pr_triage_hetzner_push_5xx');
    expect(outputs).toContain('code_pr_triage_hetzner_backlog');
  });
});

describe('Retired service Terraform IAM', () => {
  it('removes IAM resources and outputs for obsolete agents', () => {
    const iamMain = readRequired(terraformIamMainPath);
    const iamOutputs = readRequired(terraformIamOutputsPath);
    const devMain = readRequired(terraformDevMainPath);

    for (const removed of ['todos', 'chat', 'cron'].map((name) =>
      retiredUnderscored(name, 'agent')
    )) {
      expect(iamMain).not.toContain(`"${removed}"`);
      expect(iamMain).not.toContain(`google_service_account.${removed}`);
      expect(iamMain).not.toContain(`"${removed}_`);
      expect(iamOutputs).not.toContain(removed);
      expect(devMain).not.toContain(`${removed} = {`);
      expect(devMain).not.toContain(`module.iam.service_accounts["${removed}"]`);
    }
  });
});

describe('Pub/Sub dev tooling', () => {
  it('does not expose removed checklist-processing topic helpers', () => {
    const retiredTopicAlias = retiredDashed('todos', 'processing');
    for (const filePath of [
      pubsubUiServerPath,
      pubsubUiIndexPath,
      pubsubUiReadmePath,
      pubsubPublishTestPath,
    ]) {
      expect(readRequired(filePath), filePath).not.toContain(retiredTopicAlias);
    }
  });
});

describe('Pub/Sub dead-letter reliability', () => {
  it('grants the Pub/Sub service agent both dead-letter roles with 31-day retention', () => {
    const pushModule = readRequired(terraformPubsubPushModuleMainPath);
    const pullModule = readRequired(terraformPubsubModuleMainPath);
    const devTerraform = readRequired(terraformDevMainPath);

    expect(pushModule).toMatch(
      /resource "google_pubsub_subscription_iam_member" "dlq_subscriber" \{[\s\S]*?count\s+=\s+var\.enable_push_subscription \? 1 : 0[\s\S]*?subscription\s+=\s+google_pubsub_subscription\.push\[0\]\.name[\s\S]*?role\s+=\s+"roles\/pubsub\.subscriber"/
    );
    expect(pullModule).toMatch(
      /resource "google_pubsub_subscription_iam_member" "dlq_subscriber" \{[\s\S]*?subscription\s+=\s+google_pubsub_subscription\.main\.name[\s\S]*?role\s+=\s+"roles\/pubsub\.subscriber"/
    );
    for (const terraform of [pushModule, pullModule]) {
      expect(terraform).toContain('message_retention_duration = "2678400s"');
    }
    expect(devTerraform).toMatch(
      /resource "google_pubsub_subscription_iam_member" "pubsub_subscribes_audio_stored_push" \{[\s\S]*?subscription\s+=\s+google_pubsub_subscription\.audio_stored_push\.name[\s\S]*?role\s+=\s+"roles\/pubsub\.subscriber"/
    );
    expect(devTerraform).toMatch(
      /resource "google_pubsub_subscription" "transcription_dlq_inspect" \{[\s\S]*?message_retention_duration\s+=\s+"2678400s"/
    );
  });

  it('alerts on every DLQ naming form and documents safe selected replay', () => {
    const monitoring = readRequired(terraformMonitoringMainPath);
    const dlqRunbook = readRequired(pubsubDlqRunbookPath);

    expect(monitoring.match(/resource\.labels\.subscription_id=has_substring/g)).toHaveLength(3);
    expect(monitoring).not.toMatch(/resource\.label\.subscription_id=has_substring/);
    expect(monitoring).toContain('pubsub.googleapis.com/subscription/dead_letter_message_count');
    expect(monitoring).toContain('metric.labels.response_code!="success"');
    expect(monitoring).not.toContain('metric.label.response_code!="success"');
    expect(monitoring).toContain('docs/operations/pubsub-dlq-runbook.md');
    expect(dlqRunbook).toContain('31 days');
    expect(dlqRunbook).toContain('payload hash');
    expect(dlqRunbook).toContain('Do not bulk replay');
    expect(dlqRunbook).toContain('ACK');
    expect(dlqRunbook).toContain('correlation');
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
    const hetznerRetiredAsyncCleanup = readRequired(terraformHetznerRetiredAsyncCleanupPath);
    const hetznerVariables = readRequired(terraformHetznerVariablesPath);
    const hetznerOutputs = readRequired(terraformHetznerOutputsPath);
    const prodAutoTfvars = JSON.parse(readRequired(terraformHetznerProdAutoTfvarsPath)) as {
      activate_hetzner_async_consumers?: boolean;
    };
    const retiredSchedulerJobs: Array<[string, string[]]> = [
      [
        retiredDashed('intexuraos', 'retry', 'pending', 'actions', 'prod', 'hetzner'),
        ['internal', 'actions', 'retry-pending'],
      ],
      [
        retiredDashed('intexuraos', 'cron', 'agent', 'tick', 'prod', 'hetzner'),
        ['internal', 'cron', 'tick'],
      ],
      [
        retiredDashed('intexuraos', 'retry', 'pending', 'commands', 'prod', 'hetzner'),
        ['internal', 'retry-pending'],
      ],
    ];
    const retiredPubsubSubscriptions: Array<[string, string[]]> = [
      [
        retiredDashed('intexuraos', 'todos', 'processing', 'prod', 'hetzner'),
        ['internal', 'todos', 'pubsub', retiredDashed('todos', 'processing')],
      ],
      [
        retiredDashed('intexuraos', 'commands', 'ingest', 'prod', 'hetzner'),
        ['internal', 'commands'],
      ],
      [
        retiredDashed('intexuraos', 'actions', 'queue', 'prod', 'hetzner'),
        ['internal', 'actions', 'process'],
      ],
      [
        retiredDashed('intexuraos', 'approval', 'reply', 'prod', 'hetzner'),
        ['internal', 'actions', retiredDashed('approval', 'reply')],
      ],
    ];

    expect(script).toContain('PUBSUB_ROUTES=(');
    expect(script).toContain('SCHEDULER_ROUTES=(');
    expect(script).toContain('validate_public_origin');
    expect(script).toContain('PUBLIC_ORIGIN must be an https:// origin without a path');
    expect(script).toContain('PUBLIC_ORIGIN must be exactly https://intexuraos.cloud');
    expect(script).toContain('gcloud pubsub subscriptions update');
    expect(script).toContain('gcloud scheduler jobs update http');
    expect(script).toContain('--update-headers=Content-Type=application/json');
    expect(script).toContain('args+=(--message-body="${message_body}")');
    const cutoverDryRun = execFileSync('bash', [cutoverEdgePath], { encoding: 'utf8' });
    expect(cutoverDryRun).toContain(
      'intexuraos-code-tasks-zombie-sweep-dev --project=intexuraos-dev-pbuchman'
    );
    expect(cutoverDryRun).toContain(
      '--update-headers=Content-Type=application/json --message-body=\\{\\}'
    );
    expect(script).toContain('--push-auth-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('--oidc-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('/internal/linear/sync-all');
    expect(script).toContain('/internal/drain-queue');
    expect(script).toContain('/internal/execution-memory/process');
    const retiredTopicAlias = retiredDashed('todos', 'processing');
    const retiredTopicName = retiredDashed('intexuraos', 'todos', 'processing');
    const retiredCronJob = retiredDashed('intexuraos', 'cron', 'agent', 'tick');
    const retiredTodosPushPath = `/internal/todos/pubsub/${retiredTopicAlias}`;
    expect(script).not.toContain(retiredTopicName);
    expect(script).not.toContain(retiredTodosPushPath);
    expect(script).not.toContain(retiredCronJob);
    expect(script).not.toContain('/internal/cron/tick');
    expect(devTerraform).not.toContain('variable "hetzner_edge_origin"');
    expect(devTerraform).not.toContain('local.hetzner_edge_origin');
    expect(devTerraform).not.toContain('local.async_edge_audience');
    expect(prTriageTerraform).not.toContain('local.hetzner_edge_origin');
    expect(hetznerMain).toContain('activate_hetzner_async_consumers');
    expect(hetznerMain).toContain('"/internal/whatsapp/private/events"');
    expect(hetznerMain).not.toContain(retiredUnderscored('todos', 'agent'));
    expect(hetznerMain).not.toContain(retiredUnderscored('todos', 'processing'));
    expect(hetznerMain).not.toContain(`"${retiredTodosPushPath}"`);
    expect(hetznerMain).not.toContain('"/internal/cron/tick"');
    expect(hetznerPubsub).toContain('google_pubsub_subscription" "hetzner_push"');
    expect(hetznerPubsub).toContain('resource "google_pubsub_topic" "hetzner_push_dlq"');
    expect(hetznerPubsub).toMatch(/name\s+=\s+"\$\{each\.value\.subscription_name\}-dlq"/);
    expect(hetznerPubsub).toContain(
      'resource "google_pubsub_subscription" "hetzner_push_dlq_inspect"'
    );
    expect(hetznerPubsub).toMatch(/name\s+=\s+"\$\{each\.value\.subscription_name\}-dlq-sub"/);
    expect(hetznerPubsub).toContain('message_retention_duration = "2678400s"');
    expect(hetznerPubsub).toContain(
      'resource "google_pubsub_topic_iam_member" "hetzner_push_dlq_publisher"'
    );
    expect(hetznerPubsub).toContain(
      'resource "google_pubsub_subscription_iam_member" "hetzner_push_dlq_subscriber"'
    );
    expect(hetznerPubsub).toContain('role         = "roles/pubsub.subscriber"');
    expect(hetznerPubsub).toContain(
      'dead_letter_topic     = google_pubsub_topic.hetzner_push_dlq[each.key].id'
    );
    expect(hetznerPubsub).not.toContain('data.google_pubsub_topic.hetzner_push_dlq');
    expect(hetznerPubsub).not.toContain(retiredUnderscored('todos', 'processing'));
    expect(hetznerPubsub).not.toContain(retiredTodosPushPath);
    expect(hetznerPubsub).toContain(
      'filter  = var.activate_hetzner_async_consumers ? null : local.pubsub_staging_filter'
    );
    expect(hetznerScheduler).toContain('paused      = !var.activate_hetzner_async_consumers');
    expect(hetznerScheduler).not.toContain(retiredUnderscored('cron', 'agent', 'tick'));
    expect(hetznerScheduler).not.toContain('/internal/cron/tick');
    const zombieSweepJob =
      hetznerScheduler
        .split('code_tasks_zombie_sweep = {')[1]
        ?.split('\n    archive_stale_groups = {')[0] ?? '';
    expect(zombieSweepJob).toContain('path                 = "/internal/code/detect-zombies"');
    expect(zombieSweepJob).toContain('body                 = base64encode("{}")');
    expect(zombieSweepJob).toContain(
      'headers              = { "Content-Type" = "application/json" }'
    );
    expect(hetznerVariables).toContain('variable "enable_retired_async_consumer_cleanup"');
    expect(hetznerVariables).toContain('default     = false');
    expect(hetznerRetiredAsyncCleanup).toContain(
      'resource "terraform_data" "retired_async_consumer_cleanup"'
    );
    expect(hetznerRetiredAsyncCleanup).toContain(
      'count = var.enable_retired_async_consumer_cleanup ? 1 : 0'
    );
    expect(hetznerRetiredAsyncCleanup).toContain('Refusing to delete scheduler job');
    expect(hetznerRetiredAsyncCleanup).toContain('Refusing to delete Pub/Sub subscription');
    for (const [jobName, pathParts] of retiredSchedulerJobs) {
      const path = `/${pathParts.join('/')}`;
      expect(hetznerRetiredAsyncCleanup, jobName).toContain(jobName);
      expect(hetznerRetiredAsyncCleanup, path).toContain(path);
      expect(hetznerScheduler, jobName).not.toContain(jobName);
    }
    for (const [subscriptionName, pathParts] of retiredPubsubSubscriptions) {
      const path = `/${pathParts.join('/')}`;
      expect(hetznerRetiredAsyncCleanup, subscriptionName).toContain(subscriptionName);
      expect(hetznerRetiredAsyncCleanup, path).toContain(path);
      expect(hetznerPubsub, subscriptionName).not.toContain(subscriptionName);
    }
    expect(hetznerOutputs).toContain(
      'filter        = subscription.filter == "" ? null : subscription.filter'
    );
    expect(hetznerOutputs).not.toContain(retiredTopicName);
    expect(hetznerOutputs).not.toContain(retiredCronJob);
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
      'pubsub_intex_message_ingest',
      'pubsub_research_process',
      'pubsub_llm_analytics',
      'pubsub_llm_call',
      'pubsub_whatsapp_send',
      'pubsub_bookmark_enrich',
      'pubsub_bookmark_summarize',
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
    expect(devTerraform).not.toContain('module "pubsub_todos_processing"');
    expect(devTerraform).not.toContain(
      `/internal/todos/pubsub/${retiredDashed('todos', 'processing')}`
    );
    expect(devTerraform).not.toContain(
      `module.iam.service_accounts["${retiredUnderscored('todos', 'agent')}"]`
    );
    expect(devTerraform).toContain('resource "google_pubsub_subscription" "audio_stored_push"');
    expect(devTerraform).not.toContain(
      'resource "google_pubsub_subscription" "audio_stored_push" {\n  count'
    );
    expect(devTerraform).toContain('resource "google_pubsub_topic" "transcription_completed"');
    expect(devTerraform).toContain('resource "google_pubsub_topic" "transcription_completed_dlq"');
    expect(devTerraform).toContain(
      'name    = "intexuraos-transcription-completed-${var.environment}-dlq"'
    );
    expect(devTerraform).not.toContain(
      ['internal', 'whatsapp', 'pubsub', 'transcription-completed'].join('/')
    );

    for (const schedulerResource of [
      'mobile_notifications_digest_yesterday',
      'linear_sync_hourly',
      'linear_issues_prune_hourly',
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
  it('declares Grafana Cloud observability secrets without Terraform-managed values', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);
    const hetznerRuntimeSecretsSection =
      terraform.split('hetzner_runtime_secret_names = toset([')[1]?.split('])')[0] ?? '';
    const cloudRunExcludedSecretsSection =
      terraform.split('cloud_run_secret_manager_excluded_names = toset([')[1]?.split('])')[0] ?? '';
    const grafanaCloudSecrets = [
      'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN',
      'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
    ];
    const hetznerCollectorSecrets = [
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
    ];

    for (const secretName of grafanaCloudSecrets) {
      expect(terraform, secretName).toMatch(new RegExp(`"${secretName}"\\s*=`));
    }

    for (const secretName of hetznerCollectorSecrets) {
      expect(hetznerRuntimeSecretsSection, secretName).toContain(`"${secretName}",`);
      expect(script, secretName).toContain(secretName);
    }

    for (const secretName of grafanaCloudSecrets) {
      expect(cloudRunExcludedSecretsSection, secretName).toContain(`"${secretName}",`);
    }

    expect(hetznerRuntimeSecretsSection).not.toContain('"INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN",');
    expect(hetznerRuntimeSecretsSection).not.toContain('"INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL",');
    expect(script).not.toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
    expect(terraform).not.toContain('google_secret_manager_secret_version" "grafana');
    expect(terraform).not.toContain('glc_');
    expect(terraform).not.toContain('glsa_');
  });

  it('fails fast unless INTEXURAOS_ENVIRONMENT=prod and writes protected env material', () => {
    const script = readRequired(loadSecretsPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('gcloud secrets versions access');
    expect(script).toContain('HETZNER_RUNTIME_SECRETS=(');
    expect(script).toContain('INTEXURAOS_SENTRY_WEBHOOK_SECRET');
    expect(script).toContain('INTEXURAOS_SENTRY_AUTOMATION_USER_ID');
    expect(script).toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN');
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

  it('writes the code-agent task callback base URL as non-secret runtime config', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);

    expect(script).toContain(
      'write_env_line "${output_path}" "INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL" "${PUBLIC_ORIGIN}/api/code"'
    );
    expect(terraform).toContain(
      'INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL  = "${local.public_origin}/api/code"'
    );
    expect(script).toContain(
      'write_env_line "${output_path}" "INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY" "pbuchman/intexuraos"'
    );
    expect(script).toContain(
      'write_env_line "${output_path}" "INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH" "development"'
    );
    expect(terraform).toContain('INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY  = "pbuchman/intexuraos"');
    expect(terraform).toContain('INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH = "development"');
  });

  it('writes private Matrix outbound adapter config for Hetzner prod', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);
    const setupDoc = readRequired(
      resolve(repoRoot, 'docs/setup/16-private-whatsapp-matrix-sync.md')
    );

    expect(script).toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL');
    expect(script).not.toContain(
      'write_env_line "${output_path}" "INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL" "http://localhost:8099"'
    );
    expect(terraform).not.toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL  = "http://localhost:8099"'
    );
    expect(terraform).toContain('"INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL",');
    expect(terraform).toContain(
      '"INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL"        = "Base URL for the external WhatsApp private Matrix outbound adapter"'
    );
    expect(script).toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN');
    expect(terraform).toContain('"INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN",');
    expect(setupDoc).toContain('Store `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` in Secret Manager');
    expect(setupDoc).toContain('Do not point this value at `localhost`');
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
      'intexuraos-research-process-prod-hetzner',
      'intexuraos-llm-call-prod-hetzner',
    ]) {
      expect(hetznerImports).toContain(importId);
    }

    expect(hetznerImports).not.toContain('126413082');
    expect(hetznerImports).not.toContain('todos_processing');
    expect(hetznerImports).not.toContain(
      retiredDashed('intexuraos', 'todos', 'processing', 'prod', 'hetzner')
    );
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
