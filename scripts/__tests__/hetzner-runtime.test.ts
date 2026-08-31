import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const nginxConfigPath = resolve(repoRoot, 'scripts/hetzner/nginx/intexuraos.conf');
const messageDigestPublicIngressPath = resolve(
  repoRoot,
  'scripts/hetzner/nginx/message-digests-public-active.conf'
);
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
const verifyMatrixCorpusRuntimePath = resolve(
  repoRoot,
  'scripts/hetzner/verify-matrix-corpus-runtime.sh'
);
const deploymentDocumentVerifierPath = resolve(
  repoRoot,
  'scripts/hetzner/verify-deployment-document.mjs'
);
const codeHealthVerifierPath = resolve(repoRoot, 'scripts/hetzner/verify-code-agent-health.mjs');
const semanticHealthVerifierPath = resolve(repoRoot, 'scripts/hetzner/verify-semantic-health.mjs');
const installPm2LogrotatePath = resolve(repoRoot, 'scripts/hetzner/install-pm2-logrotate.sh');
const runbookPath = resolve(repoRoot, 'docs/operations/hetzner-prod-runbook.md');
const webHostingPath = resolve(repoRoot, 'docs/architecture/web-app-hosting.md');
const lifecycleBackfillRunbookPath = resolve(
  repoRoot,
  'docs/operations/code-task-lifecycle-backfill.md'
);
const firestoreCollectionsPath = resolve(repoRoot, 'firestore-collections.json');
const firestoreIndexesPath = resolve(repoRoot, 'firestore.indexes.json');
const contextAttachmentsRunbookPath = resolve(
  repoRoot,
  'docs/runbooks/conversation-assistant-context-attachments.md'
);
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
const terraformHetznerRetainedGcpPath = resolve(repoRoot, 'terraform/hetzner-prod/retained-gcp.tf');
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
const retiredRoute = (resource: string): string => `/api/${resource}`;
const retiredDashed = (...parts: string[]): string => parts.join('-');
const retiredUnderscored = (...parts: string[]): string => parts.join('_');

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
  it('exposes only the required OIDC-protected production corpus evaluator prefixes', () => {
    const config = readRequired(nginxConfigPath);
    const verifier = readRequired(jwtVerifierPath);
    const matrixCorpusRunner = 'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    const testRunMutationPattern =
      '^/internal/evals/intex-agent/test-runs/[^/]+/(?:projection|artifact-delivery)$';
    const outboundMatrixPath = '/internal/evals/whatsapp/whatsapp/private/outbound-matrix-messages';
    const outboundMatrixPattern = `^${outboundMatrixPath}$`;

    expect(config).toContain('location ^~ /internal/evals/whatsapp/matrix-corpus/');
    expect(config).toContain('location ^~ /internal/evals/intex-agent/matrix-corpus/');
    expect(config).toContain('location ^~ /internal/evals/intex-agent/test-runs/');
    expect(config).toContain(`location = ${outboundMatrixPath} {`);
    expect(config).toContain('proxy_pass http://whatsapp_service/internal/matrix-corpus/;');
    expect(config).toContain('proxy_pass http://intex_agent/internal/matrix-corpus/;');
    expect(config).toContain('proxy_pass http://intex_agent/internal/test-runs/;');
    expect(config).toContain(
      'proxy_pass http://whatsapp_service/internal/whatsapp/private/outbound-matrix-messages;'
    );
    for (const prefix of ['whatsapp', 'intex-agent'] as const) {
      const start = config.indexOf(`location ^~ /internal/evals/${prefix}/matrix-corpus/ {`);
      const end = config.indexOf('\n    }', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(config.slice(start, end)).toContain('access_log off;');
    }
    const testRunsStart = config.indexOf('location ^~ /internal/evals/intex-agent/test-runs/ {');
    const testRunsEnd = config.indexOf('\n    }', testRunsStart);
    expect(testRunsStart).toBeGreaterThanOrEqual(0);
    expect(config.slice(testRunsStart, testRunsEnd)).toContain('access_log off;');
    const outboundStart = config.indexOf(`location = ${outboundMatrixPath} {`);
    const outboundEnd = config.indexOf('\n    }', outboundStart);
    const outboundBlock = config.slice(outboundStart, outboundEnd);
    expect(outboundStart).toBeGreaterThanOrEqual(0);
    expect(outboundBlock).toContain('access_log off;');
    expect(outboundBlock).toContain('access_by_lua_file /etc/nginx/lua/jwt-verify.lua;');
    expect(config).not.toContain('rewrite ^/internal/evals/');
    expect(verifier).toContain('^/internal/evals/(?:whatsapp|intex-agent)/matrix-corpus(?:/|$)');
    expect(verifier).toContain(`pattern = [[${testRunMutationPattern}]]`);
    expect(verifier).toContain(`pattern = [[${outboundMatrixPattern}]]`);
    expect(verifier).toContain('caller_role = "matrix_corpus_runner"');
    expect(verifier).toContain(matrixCorpusRunner);

    const testRunPatternStart = verifier.indexOf(`pattern = [[${testRunMutationPattern}]]`);
    const testRunPatternEnd = verifier.indexOf('\n  },', testRunPatternStart);
    const testRunPatternBlock = verifier.slice(testRunPatternStart, testRunPatternEnd);
    expect(testRunPatternBlock).toContain('allowed_methods = { PUT = true }');
    expect(testRunPatternBlock).not.toContain('GET = true');
    expect(
      Array.from(
        testRunPatternBlock.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/gu),
        (match) => match[1]
      )
    ).toEqual([matrixCorpusRunner]);

    const outboundPatternStart = verifier.indexOf(`pattern = [[${outboundMatrixPattern}]]`);
    const outboundPatternEnd = verifier.indexOf('\n  },', outboundPatternStart);
    const outboundPatternBlock = verifier.slice(outboundPatternStart, outboundPatternEnd);
    expect(outboundPatternBlock).toContain('allowed_methods = { POST = true }');
    expect(outboundPatternBlock).not.toContain('GET = true');
    expect(outboundPatternBlock).not.toContain('PUT = true');
    expect(
      Array.from(
        outboundPatternBlock.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/gu),
        (match) => match[1]
      )
    ).toEqual([matrixCorpusRunner]);

    const testRunMutationMatcher = new RegExp(testRunMutationPattern);
    expect(
      testRunMutationMatcher.test('/internal/evals/intex-agent/test-runs/eval-1/projection')
    ).toBe(true);
    expect(
      testRunMutationMatcher.test('/internal/evals/intex-agent/test-runs/eval-1/artifact-delivery')
    ).toBe(true);
    expect(
      testRunMutationMatcher.test('/internal/evals/intex-agent/test-runs/eval-1/cleanup')
    ).toBe(false);
    expect(
      testRunMutationMatcher.test('/internal/evals/intex-agent/test-runs/eval-1/projection/extra')
    ).toBe(false);
    const outboundMatrixMatcher = new RegExp(outboundMatrixPattern);
    expect(outboundMatrixMatcher.test(outboundMatrixPath)).toBe(true);
    expect(outboundMatrixMatcher.test(`${outboundMatrixPath}/extra`)).toBe(false);

    const allowFunction = verifier.slice(
      verifier.indexOf('local function is_service_account_allowed'),
      verifier.indexOf('local auth_header')
    );
    const patternLookupIndex = allowFunction.indexOf('ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS');
    const methodLookupIndex = allowFunction.indexOf('ngx.req.get_method()');
    const evaluatorFailClosedIndex = allowFunction.indexOf('string.len(EVALUATOR_ROUTE_PREFIX)');
    const evaluatorDenyIndex = allowFunction.indexOf('return false, nil', evaluatorFailClosedIndex);
    const routePrefixLookupIndex = allowFunction.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS');
    const globalLookupIndex = allowFunction.indexOf('GLOBAL_ALLOWED_SERVICE_ACCOUNTS[email]');
    expect(verifier).toContain('local EVALUATOR_ROUTE_PREFIX = "/internal/evals/"');
    expect(patternLookupIndex).toBeGreaterThanOrEqual(0);
    expect(methodLookupIndex).toBeGreaterThan(patternLookupIndex);
    expect(evaluatorFailClosedIndex).toBeGreaterThan(patternLookupIndex);
    expect(evaluatorDenyIndex).toBeGreaterThan(evaluatorFailClosedIndex);
    expect(routePrefixLookupIndex).toBeGreaterThan(evaluatorFailClosedIndex);
    expect(globalLookupIndex).toBeGreaterThan(routePrefixLookupIndex);
  });

  it('restores the Pub/Sub marker only for the verified Intex message push route', () => {
    const config = readRequired(nginxConfigPath);
    const verifier = readRequired(jwtVerifierPath);
    const pushPath = '/internal/intex-agent/messages';
    const pushPattern = `^${pushPath}$`;
    const pushServiceAccount =
      'intexuraos-intex-agent-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';

    expect(config).toContain('set $edge_pubsub_from "";');
    expect(config).toContain('proxy_set_header From $edge_pubsub_from;');
    expect(verifier).toContain(`pattern = [[${pushPattern}]]`);
    expect(verifier).toContain(
      'ngx.var.edge_pubsub_from = caller_role == "intex_message_ingest_pubsub" and "noreply@google.com" or ""'
    );

    const patternStart = verifier.indexOf(`pattern = [[${pushPattern}]]`);
    const patternEnd = verifier.indexOf('\n  },', patternStart);
    const patternBlock = verifier.slice(patternStart, patternEnd);
    expect(patternStart).toBeGreaterThanOrEqual(0);
    expect(patternBlock).toContain('caller_role = "intex_message_ingest_pubsub"');
    expect(patternBlock).toContain('allowed_methods = { POST = true }');
    expect(patternBlock).not.toContain('GET = true');
    expect(patternBlock).not.toContain('PUT = true');
    expect(
      Array.from(patternBlock.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/gu), (match) => match[1])
    ).toEqual([pushServiceAccount]);

    const pushMatcher = new RegExp(pushPattern);
    expect(pushMatcher.test(pushPath)).toBe(true);
    expect(pushMatcher.test(`${pushPath}/extra`)).toBe(false);
    expect(pushMatcher.test('/internal/intex-agent/messages-other')).toBe(false);
  });

  it('serves only the exact deployment attestation path as uncached JSON', () => {
    const config = readRequired(nginxConfigPath);
    const deploymentLocationStart = config.indexOf('location = /deployment.json {');
    const deploymentLocationEnd = config.indexOf('\n    }', deploymentLocationStart);
    const deploymentLocation = config.slice(deploymentLocationStart, deploymentLocationEnd);

    expect(deploymentLocationStart).toBeGreaterThanOrEqual(0);
    expect(deploymentLocation).toContain('root /var/www/intexuraos/web/current;');
    expect(deploymentLocation).toContain('default_type application/json;');
    expect(deploymentLocation).toContain('try_files /deployment.json =404;');
    expect(deploymentLocation).toContain('add_header Cache-Control "no-store" always;');
    expect(config).not.toContain('location /deployment.json');
    expect(deploymentLocationStart).toBeLessThan(config.lastIndexOf('location / {'));
  });

  it('defines public API routes that exactly match apps/web/service-manifest.json', () => {
    const config = readRequired(nginxConfigPath);
    const effectivePublicConfig = `${config}\n${readRequired(messageDigestPublicIngressPath)}`;
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
        expect(effectivePublicConfig, service.apiPath).toContain(`location ^~ ${service.apiPath}/`);
      } else {
        expect(effectivePublicConfig, service.apiPath).toContain(`location ${service.apiPath}/`);
      }
      expect(effectivePublicConfig, service.apiPath).toContain(`proxy_pass http://${upstream}/;`);
    }

    expect(config).toContain('location ~ ^/api/[a-z0-9-]+/internal(?:/|$)');
    expect(config).toContain('return 404;');
    expect(config).toContain('set $edge_internal_auth_token "";');
    expect(config).toContain('set $edge_pubsub_from "";');
    expect(config).toContain('proxy_set_header X-Internal-Auth $edge_internal_auth_token;');
    expect(config).toContain('proxy_set_header From $edge_pubsub_from;');
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
      ['/internal/message-digests/', 'message_digest_service'],
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
    expect(verifier).toContain(
      'ngx.var.edge_pubsub_from = caller_role == "intex_message_ingest_pubsub" and "noreply@google.com" or ""'
    );
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
      'pattern = [[^/internal/whatsapp/private/messages/[^/]+/media$]]'
    );
    expect(routeAllowlist).toContain('allowed_methods = { GET = true }');
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
    expect(hetznerMain).toContain('"/internal/whatsapp/private/messages/:messageId/media"');
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

  it('authorizes private WhatsApp erasure routes only for the private-sync caller', () => {
    const config = readRequired(nginxConfigPath);
    const verifier = readRequired(jwtVerifierPath);
    const hetznerMain = readRequired(terraformHetznerMainPath);
    const privateSyncServiceAccount =
      'intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    const matrixCorpusRunnerServiceAccount =
      'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    const erasureRoutePattern = '^/internal/whatsapp/private/accounts/[^/]+/erasure(?:/[^/]+)?$';

    expect(config).toContain('set $edge_internal_caller_role "";');
    expect(config).toContain('proxy_set_header X-Internal-Caller-Role $edge_internal_caller_role;');
    expect(verifier).toContain('ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS');
    expect(verifier).toContain(`pattern = [[${erasureRoutePattern}]]`);
    expect(verifier).toContain('caller_role = "whatsapp_private_sync"');
    expect(verifier).toContain('ngx.req.clear_header("X-Internal-Caller-Role")');
    expect(verifier).toContain('ngx.var.edge_internal_caller_role = caller_role or ""');

    const globalAllowlist = verifier.slice(
      verifier.indexOf('GLOBAL_ALLOWED_SERVICE_ACCOUNTS'),
      verifier.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS')
    );
    const patternAllowlist = verifier.slice(
      verifier.indexOf('ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS'),
      verifier.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS')
    );
    const globalServiceAccounts = Array.from(
      globalAllowlist.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/g),
      (match) => match[1]
    );
    const erasurePatternBlock = patternAllowlist.slice(
      patternAllowlist.indexOf(erasureRoutePattern),
      patternAllowlist.indexOf('\n  },', patternAllowlist.indexOf(erasureRoutePattern))
    );
    const erasureServiceAccounts = Array.from(
      erasurePatternBlock.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/g),
      (match) => match[1]
    );

    expect(globalServiceAccounts.length).toBeGreaterThan(0);
    expect(erasureServiceAccounts).toEqual([privateSyncServiceAccount]);
    expect(erasurePatternBlock).not.toContain(matrixCorpusRunnerServiceAccount);
    for (const serviceAccount of globalServiceAccounts) {
      expect(erasurePatternBlock).not.toContain(`["${serviceAccount}"]`);
    }

    const allowFunction = verifier.slice(
      verifier.indexOf('local function is_service_account_allowed'),
      verifier.indexOf('local auth_header')
    );
    const exactLookupIndex = allowFunction.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS[ngx.var.uri]');
    const patternLookupIndex = allowFunction.indexOf('ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS');
    const prefixLookupIndex = allowFunction.indexOf('ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS');
    const globalLookupIndex = allowFunction.indexOf('GLOBAL_ALLOWED_SERVICE_ACCOUNTS[email]');
    expect(patternLookupIndex).toBeGreaterThan(exactLookupIndex);
    expect(prefixLookupIndex).toBeGreaterThan(patternLookupIndex);
    expect(globalLookupIndex).toBeGreaterThan(prefixLookupIndex);

    const routeMatcher = new RegExp(erasureRoutePattern);
    expect(routeMatcher.test('/internal/whatsapp/private/accounts/source-1/erasure')).toBe(true);
    expect(
      routeMatcher.test('/internal/whatsapp/private/accounts/source-1/erasure/request-1')
    ).toBe(true);
    expect(routeMatcher.test('/internal/whatsapp/private/accounts/source-1')).toBe(false);
    expect(
      routeMatcher.test('/internal/whatsapp/private/accounts/source-1/erasure/request-1/extra')
    ).toBe(false);

    expect(hetznerMain).toContain('"/internal/whatsapp/private/accounts/:sourceAccountId/erasure"');
    expect(hetznerMain).toContain(
      '"/internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId"'
    );
  });

  it('authorizes the shared webhook-process push route only for the WhatsApp service caller', () => {
    const verifier = readRequired(jwtVerifierPath);
    const pubsubTerraform = readRequired(terraformHetznerPubsubPath);
    const whatsappServiceAccount =
      'intexuraos-whatsapp-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    const routeAllowlist = verifier.slice(
      verifier.indexOf('ROUTE_ALLOWED_SERVICE_ACCOUNTS'),
      verifier.indexOf('ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS')
    );
    const routeStart = routeAllowlist.indexOf('["/internal/whatsapp/pubsub/process-webhook"]');
    const routeEnd = routeAllowlist.indexOf('\n  },', routeStart);
    const processWebhookAllowlist = routeAllowlist.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(processWebhookAllowlist).toContain(`["${whatsappServiceAccount}"] = true`);
    const routeServiceAccounts = Array.from(
      processWebhookAllowlist.matchAll(/\["([^"]+@[^"\]]+)"\]\s*=\s*true/g),
      (match) => match[1]
    );
    expect(routeServiceAccounts).toEqual([whatsappServiceAccount]);

    const subscriptionStart = pubsubTerraform.indexOf('whatsapp_webhook_process = {');
    const subscriptionEnd = pubsubTerraform.indexOf(
      'whatsapp_transcription_completed = {',
      subscriptionStart
    );
    const subscription = pubsubTerraform.slice(subscriptionStart, subscriptionEnd);
    expect(subscription).toContain(
      'push_path             = "/internal/whatsapp/pubsub/process-webhook"'
    );
    expect(subscription).toContain('service_account_key   = "whatsapp_service"');
  });
});

describe('Hetzner web asset deployment', () => {
  it('validates the exact deployment document, canonical timestamp, and cache headers', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-deployment-document-'));
    const headersPath = resolve(directory, 'headers.txt');
    const sha = 'a'.repeat(40);
    const runId = '12345';
    const secretPackageVersion = '17';
    const verify = (document: unknown, headers: string): ReturnType<typeof spawnSync> => {
      writeFileSync(headersPath, headers, 'utf8');
      return spawnSync(
        'node',
        [deploymentDocumentVerifierPath, sha, runId, secretPackageVersion, headersPath],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          input: typeof document === 'string' ? document : JSON.stringify(document),
        }
      );
    };
    const validDocument = {
      commitSha: sha,
      workflowRunId: runId,
      deployedAt: '2026-07-21T05:00:00Z',
      secretPackageVersion,
    };
    const validHeaders =
      'HTTP/2 200\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n';

    try {
      expect(verify(validDocument, validHeaders).status).toBe(0);
      for (const [document, headers] of [
        [{ ...validDocument, extra: true }, validHeaders],
        [{ ...validDocument, commitSha: 'b'.repeat(40) }, validHeaders],
        [{ ...validDocument, workflowRunId: '54321' }, validHeaders],
        [{ ...validDocument, secretPackageVersion: '18' }, validHeaders],
        [{ ...validDocument, secretPackageVersion: 'latest' }, validHeaders],
        [{ ...validDocument, deployedAt: '0' }, validHeaders],
        [{ ...validDocument, deployedAt: '2026-02-30T05:00:00Z' }, validHeaders],
        ['{not-json', validHeaders],
        [[], validHeaders],
        [validDocument, 'HTTP/2 200\r\nContent-Type: text/html\r\nCache-Control: no-store\r\n'],
        [validDocument, 'HTTP/2 200\r\nContent-Type: application/json\r\n'],
      ] as const) {
        expect(verify(document, headers).status).not.toBe(0);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('validates code-agent semantic health with the checked-in dependency-free verifier', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-code-health-'));
    const headersPath = resolve(directory, 'headers.txt');
    const validBody = {
      status: 'ok',
      serviceName: 'code-agent',
      version: '3.8.0',
      timestamp: '2026-07-28T12:00:00.000Z',
      checks: [{ name: 'firestore', status: 'ok', latencyMs: 4, details: null }],
    };
    const validHeaders =
      'HTTP/2 200\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-cache, no-store\r\n\r\n';
    const verify = (
      status: string,
      body: unknown,
      headers = validHeaders
    ): ReturnType<typeof spawnSync> => {
      writeFileSync(headersPath, headers, 'utf8');
      return spawnSync('node', [codeHealthVerifierPath, status, headersPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        input: typeof body === 'string' ? body : JSON.stringify(body),
      });
    };

    try {
      expect(verify('200', validBody).status).toBe(0);
      expect(verify('503', validBody).status).not.toBe(0);
      expect(verify('200', { ...validBody, status: 'degraded' }).status).not.toBe(0);
      expect(verify('200', { ...validBody, checks: [] }).status).not.toBe(0);
      expect(
        verify('200', validBody, 'HTTP/2 200\r\nContent-Type: application/json\r\n\r\n').status
      ).not.toBe(0);

      const verifier = readRequired(codeHealthVerifierPath);
      expect(verifier).not.toContain('@intexuraos/');
      expect(verifier).not.toContain('tsx');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects HTTP-success health bodies whose service or dependency status is down', () => {
    const verify = (
      body: unknown,
      expectedService?: string,
      requiredCheck?: string
    ): SpawnSyncReturns<string> =>
      spawnSync(
        'node',
        [
          semanticHealthVerifierPath,
          ...(expectedService === undefined ? [] : [expectedService]),
          ...(requiredCheck === undefined ? [] : [requiredCheck]),
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          input: typeof body === 'string' ? body : JSON.stringify(body),
        }
      );
    const validBody = {
      status: 'ok',
      serviceName: 'whatsapp-service',
      checks: [{ name: 'firestore', status: 'ok', latencyMs: 4 }],
    };

    expect(verify(validBody).status).toBe(0);
    expect(verify(validBody, 'whatsapp-service', 'firestore').status).toBe(0);
    expect(verify(validBody, 'intex-agent', 'firestore').status).not.toBe(0);
    expect(verify({ ...validBody, checks: [] }, 'whatsapp-service', 'firestore').status).not.toBe(
      0
    );
    expect(verify({ ...validBody, status: 'down' }).status).not.toBe(0);
    expect(
      verify({ ...validBody, checks: [{ name: 'firestore', status: 'down', latencyMs: 3000 }] })
        .status
    ).not.toBe(0);
    expect(verify({ ...validBody, checks: [] }).status).toBe(0);
    expect(verify('{not-json').status).not.toBe(0);
  });

  it('refuses to attest a dirty checkout before the first remote mutation', () => {
    const script = readRequired(githubActionsDeployPath);
    const metadataFlow = script.slice(
      script.indexOf('resolve_release() {'),
      script.indexOf('\n}\n\nprepare_release_tree()')
    );
    const mainFlow = script.slice(script.indexOf('main() {'));

    expect(metadataFlow).toContain('git status --porcelain=v1 --untracked-files=all');
    expect(metadataFlow).toContain('Deployment checkout is not clean');
    expect(script).toContain('git archive "${COMMIT_SHA_VALUE}"');
    expect(script).toContain('SYNC_SOURCE_DIR');
    expect(script).toContain('"${SYNC_SOURCE_DIR%/}/"');
    expect(mainFlow.indexOf('resolve_release')).toBeLessThan(mainFlow.indexOf('setup_ssh'));
    expect(mainFlow.indexOf('prepare_release_tree')).toBeLessThan(mainFlow.indexOf('setup_ssh'));
    expect(mainFlow.indexOf('sync_release')).toBeLessThan(mainFlow.indexOf('deploy_release'));
  });

  it('propagates failures from every command in remote deployment pipelines', () => {
    const script = readRequired(githubActionsDeployPath);
    const remoteFlow = script.slice(
      script.indexOf('run_remote_at() {'),
      script.indexOf('\n}\n\nsync_release()')
    );

    expect(remoteFlow).toContain('bash -o pipefail -c');
    expect(remoteFlow).toContain('ssh "${SSH_ARGS[@]}"');
    expect(remoteFlow).not.toContain('${ssh_command} "${REMOTE_USER}@${HETZNER_PROD_HOST}"');
  });

  it('pins retained Cloud Build targets to the workflow commit and verifies provenance', () => {
    const workflow = readRequired(deployWorkflowPath);

    expect(workflow).toContain('--sha="${GITHUB_SHA}"');
    expect(workflow).not.toContain('--branch="${GITHUB_REF_NAME:-development}"');
    expect(workflow).toContain('sourceProvenance.resolvedGitSource.revision');
    expect(workflow).toContain('sourceProvenance.resolvedRepoSource.commitSha');
    expect(workflow).toContain('RESOLVED_COMMIT_SHA');
    expect(workflow).toContain('[[ "$RESOLVED_COMMIT_SHA" != "$GITHUB_SHA" ]]');
    expect(workflow).toContain('Cloud Build provenance SHA mismatch');
  });

  it('publishes and verifies exact-SHA deployment attestation only after readiness', () => {
    const script = readRequired(githubActionsDeployPath);
    const deployFlow = script.slice(
      script.indexOf('deploy_release() {'),
      script.indexOf('\n}\n\npublish_deployment_metadata()')
    );
    const attestationFlow = script.slice(
      script.indexOf('publish_deployment_metadata() {'),
      script.indexOf('\n}\n\nverify_remote_runtime()')
    );

    expect(script).toContain('COMMIT_SHA_VALUE');
    expect(script).toContain('Checkout does not match GITHUB_SHA');
    expect(script).toContain('GITHUB_RUN_ID');
    expect(script).toContain('WORKFLOW_RUN_ID_VALUE="manual"');
    expect(script).toContain('publish_deployment_metadata');
    expect(attestationFlow).toContain('commitSha:process.argv[1]');
    expect(attestationFlow).toContain('workflowRunId:process.argv[3]');
    expect(attestationFlow).toContain('deployedAt:new Date().toISOString()');
    expect(attestationFlow).toContain('/var/www/intexuraos/web/current/deployment.json');
    expect(deployFlow.indexOf('publish_deployment_metadata')).toBeLessThan(
      deployFlow.indexOf('verify_remote_runtime')
    );
    expect(script).toContain('"https://${PUBLIC_DOMAIN}/deployment.json"');
  });

  it('publishes one complete release without a compatibility phase', () => {
    const script = readRequired(githubActionsDeployPath);
    const deployFlow = script.slice(
      script.indexOf('deploy_release() {'),
      script.indexOf('\n}\n\npublish_deployment_metadata()')
    );

    expect(deployFlow).toContain('scripts/hetzner/load-secrets.sh');
    expect(deployFlow).toContain('scripts/hetzner/deploy-web.sh');
    expect(deployFlow).toContain('scripts/hetzner/reload-pm2.sh');
    expect(deployFlow).toContain('INTEXURAOS_COMMIT_SHA=${commit_sha_quoted}');
    expect(deployFlow.indexOf('load-secrets.sh')).toBeLessThan(deployFlow.indexOf('reload-pm2.sh'));
    expect(script).not.toMatch(/compatib|dual.read|previous.release/iu);
  });

  it('requires direct process and public endpoint health before completion', () => {
    const script = readRequired(githubActionsDeployPath);
    const mainFlow = script.slice(script.indexOf('main() {'));

    expect(script).toContain("execFileSync('pm2', ['jlist']");
    expect(script).toContain("app.pm2_env?.status !== 'online'");
    expect(script).toContain('"https://${PUBLIC_DOMAIN}/api/code/health"');
    expect(script).toContain('--resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"');
    expect(mainFlow.indexOf('deploy_release')).toBeLessThan(
      mainFlow.indexOf('verify_public_runtime')
    );
  });

  it('passes the validated release SHA into PM2 reload and rejects missing release input', () => {
    const deploy = readRequired(githubActionsDeployPath);
    const reload = readRequired(reloadPm2Path);
    const bootstrap = readRequired(terraformHetznerBootstrapPath);
    const runbook = readRequired(runbookPath);
    const migrationPlan = readRequired(migrationPlanPath);

    expect(deploy).toContain('INTEXURAOS_COMMIT_SHA=${commit_sha_quoted}');
    expect(reload).toContain('INTEXURAOS_COMMIT_SHA');
    expect(reload).toContain('^[0-9a-f]{40}$');
    expect(bootstrap).toContain('INTEXURAOS_COMMIT_SHA=$commit_sha_quoted');
    expect(runbook).toContain(
      "RELEASE_SHA='<40-character lowercase Git SHA deployed to /opt/intexuraos>'"
    );
    expect(runbook).toContain('INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}"');
    expect(migrationPlan).toContain(
      "RELEASE_SHA='<40-character lowercase Git SHA deployed to /opt/intexuraos>'"
    );
    expect(migrationPlan).toContain('INTEXURAOS_COMMIT_SHA="${RELEASE_SHA}"');
  });

  it('fails closed when a manual web deploy omits or supplies a non-exact release SHA', () => {
    const run = (commitSha: string | undefined): ReturnType<typeof spawnSync> =>
      spawnSync('bash', [deployWebPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          INTEXURAOS_ENVIRONMENT: 'prod',
          COMMIT_MESSAGE: commitSha === undefined ? undefined : 'manual release',
          COMMIT_SHA: commitSha,
        },
      });

    const missing = run(undefined);
    const invalid = run('ABCDEF1234567890abcdef1234567890abcdef12');

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('COMMIT_SHA is required');
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('COMMIT_SHA must be a 40-character lowercase hexadecimal SHA');
  });

  it('documents exact-SHA deployment evidence and the manual checkout fallback', () => {
    const runbook = readRequired(runbookPath);
    const contextRunbook = readRequired(contextAttachmentsRunbookPath);

    expect(runbook).toContain('sourceProvenance.resolvedGitSource.revision');
    expect(runbook).toContain('sourceProvenance.resolvedRepoSource.commitSha');
    expect(runbook).toContain('GET /deployment.json');
    expect(runbook).toContain('workflowRunId');
    expect(runbook).toContain('manual');
    expect(runbook).toContain('/api/whatsapp/health');
    expect(contextRunbook).toContain('sourceProvenance.resolvedGitSource.revision');
    expect(contextRunbook).toContain('sourceProvenance.resolvedRepoSource.commitSha');
    expect(contextRunbook).toContain('/deployment.json');
    expect(contextRunbook).toContain('/api/whatsapp/health');
  });

  it('documents the executable reversible lifecycle backfill and off-host journal checkpoint', () => {
    const runbook = readRequired(lifecycleBackfillRunbookPath);
    const hetznerRunbook = readRequired(runbookPath);
    const knownTaskIds = [
      'task_488aa3c6-1413-47ea-a1c7-9593e5aca5a2',
      'task_6713e082-4806-41a0-b0f2-763db07404f1',
      'task_95ecfbc5-233d-4a1f-b7ad-e6a0223f6fd4',
      'task_e8d7ab84-33fb-4746-8c77-4a1b95823f0c',
      'task_a5d59442-06c5-47f4-8f2a-d03489e655ce',
      'task_166001f8-3d65-4397-932d-9c930363e338',
    ];

    expect(hetznerRunbook).toContain('code-task-lifecycle-backfill.md');
    expect(runbook).toContain('--dry-run');
    expect(runbook).toContain('--apply');
    expect(runbook).toContain('--phase=tasks');
    expect(runbook).toContain('--phase=summaries');
    expect(runbook).toContain('--limit=200');
    expect(runbook).toContain('--expected-release-sha=');
    expect(runbook).toContain('rollback:lifecycle-time');
    expect(runbook).toContain('pnpm -s --filter @intexuraos/code-agent backfill:lifecycle-time');
    expect(runbook).toContain('pnpm -s --filter @intexuraos/code-agent resume:lifecycle-time');
    expect(runbook).toContain('pnpm -s --filter @intexuraos/code-agent rollback:lifecycle-time');
    expect(runbook).not.toMatch(/(?:backfill|resume|rollback):lifecycle-time -- \\\n/u);
    expect(runbook).toContain('chmod 700');
    expect(runbook).toContain('chmod 600');
    expect(runbook).toMatch(/\bscp\b/u);
    expect(runbook).toMatch(/(?:sha256sum|shasum -a 256)/u);
    expect(runbook).toContain('STOP');
    for (const taskId of knownTaskIds) expect(runbook).toContain(taskId);
  });

  it('registers the no-index maintenance lock collection without Terraform or PITR changes', () => {
    const registry = JSON.parse(readRequired(firestoreCollectionsPath)) as {
      collections: Record<string, { owner?: string }>;
    };
    const indexes = readRequired(firestoreIndexesPath);

    expect(registry.collections['code_task_lifecycle_maintenance_locks']).toMatchObject({
      owner: 'code-agent',
    });
    expect(indexes).not.toContain('code_task_lifecycle_maintenance_locks');
  });

  it('deploys Hetzner production only through an exact manual release', () => {
    const workflow = readRequired(deployWorkflowPath);
    const script = readRequired(githubActionsDeployPath);

    expect(workflow).toContain('name: Deploy');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('branches: [development]');
    expect(workflow).toContain('hetzner-prod');
    expect(workflow).toContain('deploy-hetzner-prod:');
    expect(workflow).not.toContain("github.event_name == 'push'");
    expect(workflow).toContain('HETZNER_DEPLOY_SSH_PRIVATE_KEY');
    expect(workflow).toContain('HETZNER_PROD_HOST');
    expect(workflow).toContain('SECRET_PACKAGE_VERSION: ${{ vars.PROD_SECRET_PACKAGE_VERSION }}');
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
    expect(script).toContain('scripts/hetzner/load-secrets.sh --version ${package_version_quoted}');
    expect(script).not.toContain('--stage-only');
    expect(script).not.toContain('--activate');
    expect(script).not.toContain('--rollback');
    expect(script).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
    );
    expect(script).toContain('CI=true pnpm install --frozen-lockfile');
    expect(script).not.toContain(`pnpm --filter @intexuraos/infra-o${'tel'}`);
    expect(script).toContain('resolve_release');
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
    expect(script).toContain('verify_remote_runtime');
    expect(script).toContain('verify_public_runtime');
    expect(script).toContain('delete_obsolete_releases');
    expect(script.indexOf('scripts/observability/install-grafana-alloy.sh')).toBeGreaterThan(
      script.indexOf('scripts/hetzner/load-secrets.sh')
    );
    expect(script.indexOf('CI=true pnpm install --frozen-lockfile')).toBeLessThan(
      script.indexOf('scripts/hetzner/load-secrets.sh')
    );
    expect(script).toContain('--resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"');
    expect(script).not.toContain('terraform apply');
    expect(script).not.toContain('gcloud run deploy');
    expect(script).not.toContain('gcloud builds triggers run');
  });

  it('has one destructive boundary and fix-forward-only deployment semantics', () => {
    const script = readRequired(githubActionsDeployPath);

    expect(script).toContain('This is intentionally destructive');
    expect(script).toContain('pm2 delete all');
    expect(script).toContain('systemctl stop alloy.service');
    expect(script).not.toMatch(/compensat|previous.release|restore.previous/iu);
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
    expect(script).toContain('${app.name}|http://127.0.0.1:${port}/health');
    expect(script).toContain('wait_for_pm2_online()');
    expect(script).toContain('wait_for_http_health()');
    expect(script).toContain('verify-semantic-health.mjs');
    expect(script).toContain('sync_pm2_systemd_service()');
    expect(script).toContain('pm2 jlist');
    expect(script).toContain("local IFS=' '");
    expect(script).toContain('healthy_passes=$((healthy_passes + 1))');
    expect(script).toContain('healthy_passes=0');
    expect(script).toContain('curl --fail --silent --show-error --max-time 5');
    expect(script).toContain(
      '| node scripts/hetzner/verify-semantic-health.mjs "${expected_service}"'
    );
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
    ) as { apps: { env?: { PORT?: string } }[] };
    const ports = renderedConfig.apps.map((app) => Number(app.env?.PORT));
    expect(ports).toHaveLength(19);
    expect(ports.every((port) => Number.isInteger(port) && port > 0 && port <= 65535)).toBe(true);
    expect(new Set(ports).size).toBe(19);
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

  it('builds the SPA into an inactive release and atomically switches the nginx web root', () => {
    const script = readRequired(deployWebPath);
    const provision = readRequired(provisionPath);
    const bootstrap = readRequired(terraformHetznerBootstrapPath);
    const runbook = readRequired(runbookPath);
    const webHosting = readRequired(webHostingPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('WEB_BUILD_ENV_KEYS=(');
    expect(script).toContain('clear_intexuraos_env');
    expect(script).toContain('unset "${key}"');
    expect(script).toContain('prepare_sanitized_web_env_file');
    expect(script).toContain('.env.production.local');
    expect(script).toContain('read_env_value "${key}"');
    expect(script).toContain('export_build_metadata');
    expect(script).toContain('COMMIT_SHA');
    expect(script).toContain('COMMIT_MESSAGE');
    expect(script).toContain('COMMIT_SHA is required');
    expect(script).toContain('COMMIT_SHA must be a 40-character lowercase hexadecimal SHA');
    expect(script).toContain('COMMIT_MESSAGE is required');
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
    expect(script).toContain(
      'WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-/var/www/intexuraos/web/releases}"'
    );
    expect(script).toContain(
      'WEB_CURRENT_LINK="${WEB_CURRENT_LINK:-/var/www/intexuraos/web/current}"'
    );
    expect(script).toContain('mktemp -d "${WEB_RELEASES_ROOT}/.${COMMIT_SHA}.XXXXXX"');
    expect(script).toContain('rsync -a --delete apps/web/dist/ "${staging_dir}/"');
    expect(script).toContain('mv -T "${staging_dir}" "${WEB_ROOT}"');
    expect(script).toContain('mktemp "${WEB_CURRENT_LINK}.next.XXXXXX"');
    expect(script).toContain('ln -s "${WEB_ROOT}" "${next_link}"');
    expect(script).toContain('mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"');
    expect(script).toContain('ACTIVATE_WEB="false"');
    expect(script).toContain('apps/web/dist/index.html');
    expect(provision).toContain(
      'WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-$(dirname "${WEB_ROOT}")/releases}"'
    );
    expect(provision).toContain('"$(dirname "${WEB_ROOT}")"');
    expect(provision).toContain('"${WEB_ROOT}"');
    expect(provision).toContain('"${WEB_RELEASES_ROOT}"');
    expect(bootstrap).toContain(
      '/var/www/intexuraos/web /var/www/intexuraos/web/dist /var/www/intexuraos/web/releases'
    );
    expect(readRequired(nginxConfigPath)).not.toContain('root /var/www/intexuraos/web/dist;');
    expect(provision).toContain('rsync');
    expect(runbook).toContain('scripts/hetzner/deploy-web.sh');
    expect(runbook).toContain('/var/www/intexuraos/web/current');
    expect(runbook).toContain('/var/www/intexuraos/web/releases/<commit-sha>');
    expect(runbook).not.toContain('The SPA itself is served from `/var/www/intexuraos/web/dist`.');
    expect(webHosting).toContain('/var/www/intexuraos/web/current');
    expect(webHosting).toContain('/var/www/intexuraos/web/releases/<commit-sha>');
    expect(webHosting).not.toContain(
      'publishes the output to the Hetzner nginx web root:\n\n- `/var/www/intexuraos/web/dist`'
    );
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

  it('exposes only the two maintenance proof endpoints on a loopback-only nginx listener', () => {
    const config = readRequired(nginxConfigPath);
    const listenerStart = config.indexOf('listen 127.0.0.1:18080;');
    const listenerEnd = config.indexOf('\nserver {', listenerStart + 1);
    const block = config.slice(listenerStart, listenerEnd === -1 ? config.length : listenerEnd);

    expect(listenerStart).toBeGreaterThanOrEqual(0);
    expect(block).not.toContain('0.0.0.0:18080');
    expect(block).not.toContain('[::]:18080');
    expect(block).toContain('location = /deployment.json {');
    expect(block).toContain('default_type application/json;');
    expect(block).toContain('add_header Cache-Control "no-store" always;');
    expect(block).toContain('location = /api/code/health {');
    expect(block).toContain('proxy_pass http://code_agent/health;');
    expect(block).toContain('location / {');
    expect(block).toContain('return 404;');
    expect(block).not.toContain('location ^~');
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
    expect(deploy.indexOf('scripts/hetzner/install-pm2-logrotate.sh')).toBeLessThan(
      deploy.indexOf('scripts/observability/install-grafana-alloy.sh')
    );
    expect(deploy.indexOf('CI=true pnpm install --frozen-lockfile')).toBeLessThan(
      deploy.indexOf('scripts/hetzner/load-secrets.sh')
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

describe('Merge-conflict reconciliation cadence', () => {
  it('runs the retained scheduler every five minutes', () => {
    const hetznerScheduler = readRequired(terraformHetznerSchedulerPath);
    const mergeConflictReconcileScheduler =
      hetznerScheduler
        .split('merge_conflict_reconcile = {')[1]
        ?.split('\n    merge_queue_tick = {')[0] ?? '';

    expect(mergeConflictReconcileScheduler).toContain('schedule             = "*/5 * * * *"');
  });
});

describe('Message Digest retained GCP control plane', () => {
  it('owns the run topic and identity in dev before Hetzner owns its consumer and scheduler', () => {
    const devTerraform = readRequired(terraformDevMainPath);
    const iamMain = readRequired(terraformIamMainPath);
    const iamOutputs = readRequired(terraformIamOutputsPath);
    const hetznerMain = readRequired(terraformHetznerMainPath);
    const hetznerPubsub = readRequired(terraformHetznerPubsubPath);
    const hetznerScheduler = readRequired(terraformHetznerSchedulerPath);
    const hetznerRetainedGcp = readRequired(terraformHetznerRetainedGcpPath);
    const hetznerOutputs = readRequired(terraformHetznerOutputsPath);
    const verifier = readRequired(jwtVerifierPath);

    expect(devTerraform).toMatch(
      /resource "google_service_account" "message_digest_service" \{[\s\S]*?account_id\s+=\s+"intexuraos-message-digest-\$\{var\.environment\}"/
    );
    expect(iamMain).not.toContain('resource "google_service_account" "message_digest_service"');
    expect(iamOutputs).not.toContain('message_digest_service');

    expect(devTerraform).toMatch(
      /resource "google_pubsub_topic" "message_digest_runs" \{[\s\S]*?name\s+=\s+"intexuraos-message-digest-runs-\$\{var\.environment\}"/
    );
    expect(devTerraform).toMatch(
      /resource "google_pubsub_topic_iam_member" "message_digest_publishes_runs" \{[\s\S]*?topic\s+=\s+google_pubsub_topic\.message_digest_runs\.name[\s\S]*?role\s+=\s+"roles\/pubsub\.publisher"[\s\S]*?google_service_account\.message_digest_service\.email/
    );
    const whatsappSend =
      devTerraform.split('module "pubsub_whatsapp_send" {')[1]?.split('\n}')[0] ?? '';
    expect(whatsappSend).not.toContain('message_digest_service');
    expect(devTerraform).toMatch(
      /resource "google_pubsub_topic_iam_member" "message_digest_publishes_whatsapp" \{[\s\S]*?topic\s+=\s+"intexuraos-whatsapp-send-\$\{var\.environment\}"[\s\S]*?role\s+=\s+"roles\/pubsub\.publisher"[\s\S]*?google_service_account\.message_digest_service\.email/
    );

    expect(hetznerMain).toContain(
      'message_digest_service = "intexuraos-message-digest-${var.source_environment}"'
    );
    expect(hetznerMain).toMatch(
      /message_digest_runs\s+=\s+"intexuraos-message-digest-runs-\$\{var\.source_environment\}"/
    );
    expect(hetznerMain).toContain('"/internal/message-digests/pubsub/run"');
    expect(hetznerMain).toContain('"/internal/message-digests/scheduler/tick"');
    expect(hetznerMain).not.toContain('"/internal/notifications/digest/run-yesterday"');

    const messageDigestPush =
      hetznerPubsub.split('message_digest_runs = {')[1]?.split('\n    whatsapp_send = {')[0] ?? '';
    expect(messageDigestPush).toContain(
      'subscription_name     = "intexuraos-message-digest-runs-prod-hetzner"'
    );
    expect(messageDigestPush).toContain(
      'topic_name            = local.pubsub_topics.message_digest_runs'
    );
    expect(messageDigestPush).toContain(
      'push_path             = "/internal/message-digests/pubsub/run"'
    );
    expect(messageDigestPush).toContain('service_account_key   = "message_digest_service"');
    expect(messageDigestPush).toContain('ack_deadline_seconds  = 600');

    const messageDigestScheduler =
      hetznerScheduler
        .split('message_digest_tick = {')[1]
        ?.split('\n    linear_sync_hourly = {')[0] ?? '';
    expect(messageDigestScheduler).toContain(
      'job_name             = "intexuraos-message-digest-tick-prod-hetzner"'
    );
    expect(messageDigestScheduler).toContain('schedule             = "*/5 * * * *"');
    expect(messageDigestScheduler).toContain(
      'path                 = "/internal/message-digests/scheduler/tick"'
    );
    expect(messageDigestScheduler).toContain('body                 = base64encode("{}")');
    expect(messageDigestScheduler).toContain(
      'headers              = { "Content-Type" = "application/json" }'
    );
    expect(hetznerScheduler).not.toContain('mobile_notifications_digest_yesterday');
    expect(hetznerScheduler).not.toContain('mobile-notifications-digest-yesterday');
    expect(hetznerScheduler).not.toContain('/internal/notifications/digest/run-yesterday');

    expect(hetznerRetainedGcp).toMatch(
      /message_digest_runs\s+=\s+"intexuraos-message-digest-runs-\$\{local\.retained_gcp_environment\}"/
    );
    expect(hetznerRetainedGcp).toMatch(
      /message_digest_service\s+=\s+"intexuraos-message-digest-\$\{local\.retained_gcp_environment\}@\$\{var\.project_id\}\.iam\.gserviceaccount\.com"/
    );
    expect(hetznerOutputs).not.toContain(
      '"mobile-notifications-digest-yesterday-${var.source_environment}"'
    );

    expect(verifier).toContain('^/internal/message-digests/pubsub/run$');
    expect(verifier).toContain(
      'intexuraos-message-digest-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(verifier).toContain('caller_role = "message_digest_run_pubsub"');
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

    expect(script).not.toContain('mobile-notifications-digest-yesterday');
    expect(script).not.toContain('/internal/notifications/digest/run-yesterday');
    const hetznerScheduler = readRequired(terraformHetznerSchedulerPath);
    const hetznerRetiredAsyncCleanup = readRequired(terraformHetznerRetiredAsyncCleanupPath);
    const hetznerVariables = readRequired(terraformHetznerVariablesPath);
    const provision = readRequired(provisionPath);
    const hetznerOutputs = readRequired(terraformHetznerOutputsPath);
    const prodAutoTfvars = JSON.parse(readRequired(terraformHetznerProdAutoTfvarsPath)) as {
      activate_hetzner_async_consumers?: boolean;
    };
    const retiredSchedulerJobs: [string, string[]][] = [
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
    const retiredPubsubSubscriptions: [string, string[]][] = [
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
  it('keeps Matrix corpus secrets only inside the immutable package', () => {
    const terraform = readRequired(terraformDevMainPath);
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: { prod: { envNames: string[] } } };
    const names = manifest.packages.prod.envNames.filter((name) =>
      name.startsWith('INTEXURAOS_MATRIX_CORPUS_')
    );

    expect(names).toEqual([
      'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
      'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
      'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
    ]);
    for (const name of names) expect(terraform, name).not.toContain(name);
  });

  it('uses versioned dev Sentry config after removing the rollback secret', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);
    const retainedGcpTerraform = readRequired(terraformHetznerRetainedGcpPath);
    const hetznerRuntimeSecretsSection =
      terraform.split('hetzner_runtime_secret_names = toset([')[1]?.split('])')[0] ?? '';
    const cloudRunExcludedSecretsSection =
      terraform.split('cloud_run_secret_manager_excluded_names = toset([')[1]?.split('])')[0] ?? '';
    const transcriptionModuleStart = terraform.indexOf('module "function_transcription" {');
    const transcriptionModuleEnd = terraform.indexOf(
      '\n# Push subscription that delivers audio-stored events',
      transcriptionModuleStart
    );
    const transcriptionModuleSection = terraform.slice(
      transcriptionModuleStart,
      transcriptionModuleEnd
    );

    expect(terraform).not.toMatch(
      /"INTEXURAOS_SENTRY_DSN_DEV"\s*=\s*"Sentry Data Source Name for retained dev transcription error tracking"/u
    );
    expect(cloudRunExcludedSecretsSection).not.toContain('"INTEXURAOS_SENTRY_DSN_DEV",');
    expect(hetznerRuntimeSecretsSection).not.toContain('"INTEXURAOS_SENTRY_DSN_DEV",');
    expect(script).not.toContain('INTEXURAOS_SENTRY_DSN_DEV');
    expect(retainedGcpTerraform).not.toContain('"INTEXURAOS_SENTRY_DSN_DEV",');
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn" {'
    );
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn_dev" {'
    );
    expect(transcriptionModuleStart).toBeGreaterThanOrEqual(0);
    expect(transcriptionModuleEnd).toBeGreaterThan(transcriptionModuleStart);
    expect(transcriptionModuleSection).toContain(
      'INTEXURAOS_SENTRY_DSN                           = local.versioned_runtime_config.dev["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(transcriptionModuleSection).not.toContain(
      'INTEXURAOS_SENTRY_DSN               = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(transcriptionModuleSection).not.toContain(
      'google_secret_manager_secret_iam_member.transcription_sentry_dsn,'
    );
    expect(transcriptionModuleSection).not.toContain(
      'google_secret_manager_secret_iam_member.transcription_sentry_dsn_dev,'
    );
    expect(
      terraform.match(/module\.secret_manager\.secret_ids\["INTEXURAOS_SENTRY_DSN_DEV"\]/gu)
    ).toBeNull();
  });

  it('merges the immutable PROD package environment without per-secret reads', () => {
    const script = readRequired(loadSecretsPath);
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: { prod: { envNames: string[] } } };

    expect(manifest.packages.prod.envNames).toContain(
      'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY'
    );
    expect(manifest.packages.prod.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(script).toContain('"${PACKAGE_RELEASE_DIR}/environment.env"');
    expect(script).toContain('cat "${PACKAGE_RELEASE_DIR}/environment.env"');
    expect(script).toContain('} > "${STAGING_DIR}/.env.prod"');
    expect(script).toContain('Merged production environment contains duplicate names');
    expect(script).not.toContain('gcloud secrets versions access');
    expect(script).not.toContain('--secret');
  });

  it('merges production Matrix corpus config with only the real corpus secrets', () => {
    const script = readRequired(loadSecretsPath);
    const commonConfig = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/common.json'))
    ) as Record<string, string>;
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: { prod: { envNames: string[] } } };
    const productionMatrixCorpusSecrets = [
      'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
      'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
      'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
    ];
    const versionedMatrixConfig = [
      'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
      'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
      'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
      'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
      'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
      'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
      'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    ];

    for (const secretName of productionMatrixCorpusSecrets) {
      expect(manifest.packages.prod.envNames, secretName).toContain(secretName);
      expect(script, secretName).not.toContain(secretName);
    }
    for (const configName of versionedMatrixConfig) {
      expect(commonConfig[configName], configName).toBeDefined();
      expect(manifest.packages.prod.envNames, configName).not.toContain(configName);
      expect(script, configName).not.toContain(configName);
    }
  });

  it('declares Grafana Cloud observability secrets without Terraform-managed values', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: Record<'dev' | 'prod', { envNames: string[] }> };
    const grafanaCloudSecrets = [
      'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
    ];
    const versionedObservabilityConfig = [
      'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
    ];
    const versionedCollectorConfig = [
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
    ];
    const commonConfig = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/common.json'))
    ) as Record<string, string>;

    expect(manifest.packages.dev.envNames).toEqual(expect.arrayContaining(grafanaCloudSecrets));
    expect(manifest.packages.prod.envNames).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN');
    expect(manifest.packages.prod.envNames).not.toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
    expect(script).not.toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN');
    for (const configName of versionedCollectorConfig) {
      expect(commonConfig[configName], configName).toBeDefined();
      expect(script, configName).not.toContain(configName);
    }
    for (const configName of versionedObservabilityConfig) {
      expect(manifest.packages.prod.envNames, configName).not.toContain(configName);
    }

    expect(script).not.toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
    expect(terraform).not.toContain('google_secret_manager_secret_version" "grafana');
    expect(terraform).not.toContain('glc_');
    expect(terraform).not.toContain('glsa_');
  });

  it('fails fast unless INTEXURAOS_ENVIRONMENT=prod and writes protected env material', () => {
    const script = readRequired(loadSecretsPath);

    expect(script).toContain('INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod');
    expect(script).toContain('SECRET_PACKAGE_VERSION must be an exact positive numeric version');
    expect(script).toContain('scripts/secret-package.mjs');
    expect(script).toContain('--environment prod');
    expect(script).toContain('PROVISIONER_SA_KEY_FILE');
    expect(script).toContain('RUNTIME_SA_KEY_FILE');
    expect(script).toContain('CLOUDFLARE_CREDENTIALS_FILE');
    expect(script).toContain('TLS_PRIVATE_KEY_FILE');
    expect(script).toContain('runtime-gcp-service-account.json');
    expect(script).toContain('cloudflare-dns-api-token');
    expect(script).toContain('tls-private-key.pem');
    expect(script).toContain('SECRET_PROJECTION_ROOT');
    expect(script).toContain('delete_local_rollback_state');
    expect(script).toContain('install -m 600');
    expect(script).toContain(
      '"${STAGING_DIR}/internal-auth-token" "${INTERNAL_AUTH_TOKEN_FILE}" 640'
    );
    expect(script).toContain('internal-auth-token');
    expect(script).not.toMatch(/echo\s+\$[A-Z_]*SECRET/);
    expect(script).not.toMatch(/set -x/);
    expect(script).not.toContain('gcloud secrets versions access');
    expect(script).not.toContain('HETZNER_RUNTIME_SECRETS');
    expect(script).not.toContain('--secret');
  });

  it('does not provision or inventory the removed Legacy Sentry worker token', () => {
    const terraform = readRequired(terraformDevMainPath);
    const retainedGcp = readRequired(terraformHetznerRetainedGcpPath);

    expect(terraform).not.toContain('INTEXURAOS_SENTRY_AUTH_TOKEN');
    expect(retainedGcp).not.toContain('INTEXURAOS_SENTRY_AUTH_TOKEN');
  });

  it('writes the code-agent task callback base URL as non-secret runtime config', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);

    expect(script).toContain('INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL="${PUBLIC_ORIGIN}/api/code"');
    expect(terraform).toMatch(
      /INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL\s*=\s*"\$\{local\.public_origin\}\/api\/code"/u
    );
    expect(script).toContain('INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY="pbuchman/intexuraos"');
    expect(script).toContain('INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH="development"');
    expect(terraform).toMatch(
      /INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY\s*=\s*"pbuchman\/intexuraos"/u
    );
    expect(terraform).toMatch(/INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH\s*=\s*"development"/u);
  });

  it('writes private Matrix outbound adapter config for Hetzner prod', () => {
    const script = readRequired(loadSecretsPath);
    const terraform = readRequired(terraformDevMainPath);
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: { prod: { envNames: string[] } } };
    const prodConfig = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/prod.json'))
    ) as Record<string, string>;
    const setupDoc = readRequired(
      resolve(repoRoot, 'docs/setup/16-private-whatsapp-matrix-sync.md')
    );

    expect(script).not.toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL');
    expect(prodConfig['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL']).toMatch(/^https:\/\//u);
    expect(script).not.toContain(
      'write_env_line "${output_path}" "INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL" "http://localhost:8099"'
    );
    expect(terraform).not.toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL  = "http://localhost:8099"'
    );
    expect(script).not.toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN');
    expect(manifest.packages.prod.envNames).toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'
    );
    expect(manifest.packages.prod.envNames).not.toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL');
    expect(setupDoc).toContain(
      'Keep `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` environment-specific.'
    );
    expect(setupDoc).toContain(
      'Hetzner production renders `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` from the'
    );
    expect(setupDoc).toContain('production overlay in versioned configuration');
    expect(setupDoc).toContain(
      `The tracked production value is the production-owned\n\`${prodConfig['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL']}\` route.`
    );
    expect(setupDoc).toMatch(/Do not point\s+production at `localhost`/u);
  });

  it('keeps certbot DNS credentials separate from the Cloudflare Browser Rendering API token', () => {
    const script = readRequired(installNginxPath);
    const provisionScript = readRequired(provisionPath);
    const terraform = readRequired(terraformDevMainPath);
    const manifest = JSON.parse(
      readRequired(resolve(repoRoot, 'config/environments/secret-packages.json'))
    ) as { packages: { prod: { files: string[] } } };

    expect(manifest.packages.prod.files).toContain('cloudflareDnsApiTokenBase64');
    expect(manifest.packages.prod.files).toContain('tlsPrivateKeyPemBase64');
    expect(script).toContain('CLOUDFLARE_CREDENTIALS_FILE');
    expect(script).toContain('TLS_PRIVATE_KEY_FILE');
    expect(script).toContain('validate_cloudflare_credentials');
    expect(script).toContain('validate_tls_private_key');
    expect(script).not.toContain('gcloud secrets');
    expect(script).not.toContain('versions/latest');
    expect(script).toContain('if [[ "${SKIP_CERTBOT}" -ne 1 ]]');
    expect(script).toContain('terraform/certs/intexuraos.cloud/fullchain.pem');
    expect(script).toContain('install_existing_certificate()');
    expect(script).toContain('install -m 644');
    expect(script).toContain('install -m 600');
    expect(script).toContain('libnginx-mod-http-lua');
    expect(provisionScript).toContain('libnginx-mod-http-lua');
    expect(script).not.toContain('INTEXURAOS_CLOUDFLARE_API_TOKEN');
    expect(script).not.toContain('INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN');
    expect(script).not.toContain('INTEXURAOS_SSL_PRIVATE_KEY');
    expect(terraform).toContain('"INTEXURAOS_SECRET_PACKAGE_PROD"');
    expect(terraform).toContain('google_service_account" "hetzner_provisioner"');
    expect(terraform).toContain('google_service_account" "hetzner_runtime"');
    expect(terraform).toContain('hetzner_runtime_project_roles');
    expect(terraform).toContain('roles/datastore.user');
    expect(terraform).toContain('roles/pubsub.publisher');
    expect(terraform).toContain('roles/firebaseauth.admin');
    expect(terraform).toContain('roles/logging.logWriter');
    expect(terraform).toContain('hetzner_runtime_bucket_object_admin');
    expect(terraform).toContain('hetzner_runtime_token_creator');
    expect(terraform).toContain('hetzner_provisioner_prod_package');
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

  it('grants the Hetzner provisioner the standard roles required for Terraform deployment', () => {
    const terraform = readRequired(terraformDevMainPath);
    const resourceStart = terraform.indexOf(
      'resource "google_storage_bucket_iam_member" "hetzner_provisioner_terraform_state" {'
    );
    const resourceEnd = terraform.indexOf('\n}\n', resourceStart) + 3;
    const resource = terraform.slice(resourceStart, resourceEnd);

    expect(resourceStart).toBeGreaterThanOrEqual(0);
    expect(resource).toContain('bucket = "${var.project_id}-terraform-state"');
    expect(resource).toContain('role   = "roles/storage.objectAdmin"');
    expect(resource).toContain(
      'member = "serviceAccount:${google_service_account.hetzner_provisioner.email}"'
    );
    expect(resource).not.toContain('roles/storage.admin');

    const projectRolesStart = terraform.indexOf(
      'resource "google_project_iam_member" "hetzner_provisioner_deployment_roles" {'
    );
    const projectRolesEnd = terraform.indexOf('\n}\n', projectRolesStart) + 3;
    const projectRoles = terraform.slice(projectRolesStart, projectRolesEnd);

    expect(projectRolesStart).toBeGreaterThanOrEqual(0);
    for (const role of [
      'roles/cloudscheduler.admin',
      'roles/iam.serviceAccountViewer',
      'roles/pubsub.admin',
      'roles/serviceusage.serviceUsageConsumer',
      'roles/serviceusage.serviceUsageViewer',
    ]) {
      expect(projectRoles).toContain(`"${role}"`);
    }
    expect(projectRoles).not.toContain('roles/editor');
    expect(projectRoles).not.toContain('roles/owner');
    expect(projectRoles).not.toContain('roles/iam.serviceAccountAdmin');
    expect(projectRoles).not.toContain('roles/iam.serviceAccountCreator');
    expect(projectRoles).not.toContain('roles/iam.serviceAccountDeleter');
    expect(projectRoles).not.toContain('roles/iam.serviceAccountUser');
    expect(projectRoles).toContain('project = var.project_id');
    expect(projectRoles).toContain(
      'member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"'
    );

    const messageDigestUserStart = terraform.indexOf(
      'resource "google_service_account_iam_member" "hetzner_provisioner_message_digest_user" {'
    );
    const messageDigestUserEnd = terraform.indexOf('\n}\n', messageDigestUserStart) + 3;
    const messageDigestUser = terraform.slice(messageDigestUserStart, messageDigestUserEnd);

    expect(messageDigestUserStart).toBeGreaterThanOrEqual(0);
    expect(messageDigestUser).toContain(
      'service_account_id = google_service_account.message_digest_service.name'
    );
    expect(messageDigestUser).toContain('role               = "roles/iam.serviceAccountUser"');
    expect(messageDigestUser).toContain(
      'member             = "serviceAccount:${google_service_account.hetzner_provisioner.email}"'
    );
    expect(messageDigestUser).not.toContain('condition {');

    const schedulerUserStart = terraform.indexOf(
      'resource "google_service_account_iam_member" "hetzner_provisioner_scheduler_user" {'
    );
    const schedulerUserEnd = terraform.indexOf('\n}\n', schedulerUserStart) + 3;
    const schedulerUser = terraform.slice(schedulerUserStart, schedulerUserEnd);

    expect(schedulerUserStart).toBeGreaterThanOrEqual(0);
    expect(schedulerUser).toContain(
      'service_account_id = google_service_account.cloud_scheduler.name'
    );
    expect(schedulerUser).toContain('role               = "roles/iam.serviceAccountUser"');
    expect(schedulerUser).toContain(
      'member             = "serviceAccount:${google_service_account.hetzner_provisioner.email}"'
    );
    expect(schedulerUser).not.toContain('condition {');
    expect(terraform).not.toContain('roles/iam.serviceAccountDeleter');
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
    const provision = readRequired(provisionPath);
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
    expect(hetznerBootstrap).not.toContain('runtime_sa_key_path');
    expect(hetznerBootstrap).toContain('rsync -az --delete');
    expect(hetznerBootstrap).toContain(
      'scripts/hetzner/provision.sh --version ${var.prod_secret_package_version} --skip-certbot'
    );
    expect(provision).toContain('pnpm install --frozen-lockfile');
    expect(provision.indexOf('install_workspace_dependencies')).toBeLessThan(
      provision.indexOf('load-secrets.sh')
    );
    expect(hetznerBootstrap).not.toContain(`infra-o${'tel'}`);
    expect(hetznerBootstrap).toContain("git -C '${local.repo_root}' rev-parse --verify HEAD");
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
    expect(hetznerVariables).not.toContain('runtime_sa_key_path');
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

describe('Hetzner Matrix corpus runtime verification', () => {
  it('verifies the effective PM2 app configuration instead of sourcing the secret file', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-corpus-runtime-'));
    const renderedConfigPath = resolve(directory, 'ecosystem.json');
    const curlPath = resolve(directory, 'curl');
    const runtimeEnv = {
      INTEXURAOS_INTERNAL_AUTH_TOKEN: 'test-internal-token',
      INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
      INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'user-test-1',
      INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
      INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'hetzner-prod',
    };

    try {
      writeFileSync(
        renderedConfigPath,
        JSON.stringify({
          apps: [
            { name: 'whatsapp-service', env: runtimeEnv },
            { name: 'intex-agent', env: runtimeEnv },
          ],
        })
      );
      writeFileSync(
        curlPath,
        [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          'output=""',
          'url=""',
          'while [[ $# -gt 0 ]]; do',
          '  case "$1" in',
          '    --output) output="$2"; shift 2 ;;',
          '    http://*) url="$1"; shift ;;',
          '    *) shift ;;',
          '  esac',
          'done',
          'if [[ "$url" == *"/readiness" ]]; then',
          '  printf \'%s\' \'{"success":true,"data":{"status":"ready"},"diagnostics":{}}\' > "$output"',
          'else',
          '  printf \'%s\' \'{"success":true,"data":{"kind":"admission_ready","current":{}},"diagnostics":{}}\' > "$output"',
          'fi',
          '',
        ].join('\n'),
        { mode: 0o755 }
      );

      const verify = (configPath: string): SpawnSyncReturns<string> =>
        spawnSync('bash', [verifyMatrixCorpusRuntimePath], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH ?? ''}`,
            INTEXURAOS_ENVIRONMENT: 'prod',
            RENDERED_CONFIG: configPath,
            ENV_FILE: resolve(directory, 'missing.env.prod'),
          },
        });

      const accepted = verify(renderedConfigPath);
      expect(accepted.status, accepted.stderr).toBe(0);

      writeFileSync(
        renderedConfigPath,
        JSON.stringify({
          apps: [
            { name: 'whatsapp-service', env: runtimeEnv },
            {
              name: 'intex-agent',
              env: { ...runtimeEnv, INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'home-dev' },
            },
          ],
        })
      );
      expect(verify(renderedConfigPath).status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
