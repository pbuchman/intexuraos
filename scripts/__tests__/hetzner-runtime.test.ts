import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const nginxConfigPath = resolve(repoRoot, 'scripts/hetzner/nginx/intexuraos.conf');
const jwtVerifierPath = resolve(repoRoot, 'scripts/hetzner/nginx/jwt-verify.lua');
const loadSecretsPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const deployWebPath = resolve(repoRoot, 'scripts/hetzner/deploy-web.sh');
const cutoverEdgePath = resolve(repoRoot, 'scripts/hetzner/cutover-gcp-edge.sh');
const installNginxPath = resolve(repoRoot, 'scripts/hetzner/install-nginx-and-cert.sh');
const provisionPath = resolve(repoRoot, 'scripts/hetzner/provision.sh');
const runbookPath = resolve(repoRoot, 'docs/operations/hetzner-prod-runbook.md');
const terraformMainPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');
const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');

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
    expect(publicApiSection).not.toContain('proxy_set_header Authorization "";');
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

    expect(storageSection).toContain(
      'proxy_pass https://storage.googleapis.com/intexuraos-shared-content-dev/;'
    );
    expect(storageSection).toContain(
      'proxy_pass https://storage.googleapis.com/intexuraos-images-dev/images/;'
    );
    expect(storageSection.match(/proxy_set_header Authorization "";/g)).toHaveLength(2);
    expect(storageSection.match(/proxy_set_header Cookie "";/g)).toHaveLength(2);
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
    expect(verifier).toContain('ngx.req.set_header("X-Internal-Auth"');
    expect(verifier).toContain('/etc/intexuraos/internal-auth-token');
  });
});

describe('Hetzner web asset deployment', () => {
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
    expect(script).toContain('export_web_safe_secrets');
    expect(script).toContain('read_env_value "${key}"');
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
});

describe('Hetzner async edge cutover', () => {
  it('moves retained GCP Pub/Sub and Scheduler OIDC audiences to the nginx edge', () => {
    const script = readRequired(cutoverEdgePath);
    const runbook = readRequired(runbookPath);
    const terraform = readRequired(terraformMainPath);

    expect(script).toContain('PUBSUB_ROUTES=(');
    expect(script).toContain('SCHEDULER_ROUTES=(');
    expect(script).toContain('gcloud pubsub subscriptions update');
    expect(script).toContain('gcloud scheduler jobs update http');
    expect(script).toContain('--push-auth-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('--oidc-token-audience="${PUBLIC_ORIGIN}"');
    expect(script).toContain('/internal/linear/sync-all');
    expect(script).toContain('/internal/drain-queue');
    expect(script).toContain('/internal/execution-memory/process');
    expect(terraform).toContain('variable "hetzner_edge_origin"');
    expect(terraform).toContain('local.hetzner_edge_origin == null');
    expect(terraform).toContain('local.async_edge_audience == null');
    expect(runbook).toContain(
      "terraform apply -var='hetzner_edge_origin=https://intexuraos.cloud'"
    );
  });
});

describe('Hetzner secret loader', () => {
  it('fails fast unless INTEXURAOS_ENVIRONMENT=prod and writes protected env material', () => {
    const script = readRequired(loadSecretsPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('gcloud secrets versions access');
    expect(script).toContain('HETZNER_RUNTIME_SECRETS=(');
    expect(script).toContain('printf \'%s\\n\' "${HETZNER_RUNTIME_SECRETS[@]}"');
    expect(script).toContain('install -m 600');
    expect(script).toContain('-o "${DEPLOY_USER}" -g "${DEPLOY_USER}"');
    expect(script).toContain('install -d -m 755 "$(dirname "${OUTPUT_FILE}")"');
    expect(script).toContain('install -d -m 755 "$(dirname "${INTERNAL_AUTH_TOKEN_FILE}")"');
    expect(script).toContain('install -m 640 -o root -g "${NGINX_TOKEN_GROUP}"');
    expect(script).toContain('internal-auth-token');
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
    const terraform = readRequired(terraformMainPath);

    expect(script).toContain('INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN');
    expect(script).toContain('CLOUDFLARE_DNS_API_TOKEN_SECRET');
    expect(script).toContain('gcloud secrets versions access latest');
    expect(script).toContain('if [[ "${SKIP_CERTBOT}" -ne 1 ]]');
    expect(script).not.toContain('read_env_value "INTEXURAOS_CLOUDFLARE_API_TOKEN"');
    expect(terraform).not.toContain('"INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN" =');
    expect(terraform).toContain('google_secret_manager_secret" "cloudflare_dns_api_token"');
    expect(terraform).toContain('google_service_account" "hetzner_provisioner"');
    expect(terraform).toContain('hetzner_provisioner_cloudflare_dns');
  });
});
