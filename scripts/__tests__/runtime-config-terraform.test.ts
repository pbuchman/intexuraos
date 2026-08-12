import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const terraformPath = resolve(repoRoot, 'terraform', 'environments', 'dev', 'main.tf');
const retainedGcpTerraformPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'retained-gcp.tf');
const runtimePolicyPath = resolve(repoRoot, 'config', 'environments', 'policy.json');
const claudeCodeDevTerraformPath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'claude-code-dev',
  'main.tf'
);
const claudeCodeDevReadmePath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'claude-code-dev',
  'README.md'
);

const terraform = readFileSync(terraformPath, 'utf8');
const retainedGcpTerraform = readFileSync(retainedGcpTerraformPath, 'utf8');

interface RuntimeConfigPolicy {
  secretManagerNames: string[];
}

const migratedSecretTombstones = [
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_SPA_CLIENT_ID',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
  'INTEXURAOS_FIREBASE_API_KEY',
  'INTEXURAOS_FIREBASE_AUTH_DOMAIN',
  'INTEXURAOS_FIREBASE_PROJECT_ID',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_GITHUB_APP_ID',
  'INTEXURAOS_GITHUB_INSTALLATION_ID',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI',
  'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL',
  'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
  'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
  'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
  'INTEXURAOS_REPOSITORY_URL',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_SENTRY_DSN_DEV',
  'INTEXURAOS_SENTRY_DSN_WEB',
] as const;

function readRuntimePolicy(): RuntimeConfigPolicy {
  return JSON.parse(readFileSync(runtimePolicyPath, 'utf8')) as RuntimeConfigPolicy;
}

function sectionBetween(start: string, end: string): string {
  const startIndex = terraform.indexOf(start);
  const endIndex = terraform.indexOf(end, startIndex);

  expect(startIndex, `missing Terraform section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing Terraform section end: ${end}`).toBeGreaterThan(startIndex);
  return terraform.slice(startIndex, endIndex);
}

describe('versioned runtime configuration Terraform cutover', () => {
  it('removes migrated containers while retaining the exact secret-only inventory', () => {
    const policy = readRuntimePolicy();
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nresource "google_secret_manager_secret" "cloudflare_dns_api_token"'
    );
    const moduleNames = [...secretManagerSection.matchAll(/^\s*"(INTEXURAOS_[A-Z0-9_]+)"\s*=/gmu)]
      .map((match) => match[1])
      .sort();

    expect(migratedSecretTombstones).toHaveLength(27);
    expect(policy.secretManagerNames).toHaveLength(36);
    expect(moduleNames).toEqual([...policy.secretManagerNames].sort());
    expect(moduleNames).toHaveLength(36);
    expect(moduleNames).not.toContain('INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN');
    expect(terraform).toContain('secret_id = "INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN"');
  });

  it('loads versioned config after removing every rollback-only IaC reference', () => {
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nresource "google_secret_manager_secret" "cloudflare_dns_api_token"'
    );
    const hetznerRuntimeSecretsSection = sectionBetween(
      'hetzner_runtime_secret_names = toset([',
      '])'
    );
    const cloudRunExcludedSecretsSection = sectionBetween(
      'cloud_run_secret_manager_excluded_names = toset([',
      '])'
    );
    const retainedGcpSecretsSection =
      retainedGcpTerraform.split('retained_gcp_secret_ids = toset([')[1]?.split('])')[0] ?? '';

    expect(terraform).toContain('versioned_runtime_config = {');
    expect(terraform).toContain(
      'common = jsondecode(file("${path.module}/../../../config/environments/common.json"))'
    );
    expect(terraform).toContain(
      'dev    = jsondecode(file("${path.module}/../../../config/environments/dev.json"))'
    );

    expect(migratedSecretTombstones).toHaveLength(27);
    for (const secretName of migratedSecretTombstones) {
      expect(secretManagerSection, secretName).not.toContain(`"${secretName}"`);
      expect(hetznerRuntimeSecretsSection, secretName).not.toContain(`"${secretName}"`);
      expect(cloudRunExcludedSecretsSection, secretName).not.toContain(`"${secretName}"`);
      expect(retainedGcpSecretsSection, secretName).not.toContain(`"${secretName}"`);
      expect(terraform, secretName).not.toContain(
        `module.secret_manager.secret_ids["${secretName}"]`
      );
    }

    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_version" "firebase_api_key" {'
    );
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_version" "firebase_auth_domain" {'
    );
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_version" "firebase_project_id" {'
    );
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn_dev" {'
    );
  });

  it('enables API Keys and Secret Manager DATA_READ audit logging', () => {
    expect(terraform).toContain('"apikeys.googleapis.com",');
    expect(terraform).toContain(
      'resource "google_project_iam_audit_config" "secret_manager_data_read" {'
    );
    const auditConfig = sectionBetween(
      'resource "google_project_iam_audit_config" "secret_manager_data_read" {',
      '\n}\n'
    );

    expect(auditConfig).toContain('service = "secretmanager.googleapis.com"');
    expect(auditConfig).toContain('audit_log_config {');
    expect(auditConfig).toContain('log_type = "DATA_READ"');
  });

  it('imports and restricts the existing Firebase browser key without exposing key material', () => {
    const apiKeyResource = sectionBetween(
      'resource "google_apikeys_key" "firebase_browser" {',
      '\nimport {\n'
    );
    const apiKeyImport = sectionBetween(
      'import {\n  to = google_apikeys_key.firebase_browser',
      '\n}\n\n# -----------------------------------------------------------------------------\n# Artifact Registry'
    );

    expect(apiKeyResource).toContain('name         = "d8251549-1bde-49c0-82a7-b0525a2fe688"');
    expect(apiKeyResource).toContain('project      = var.project_id');
    expect(apiKeyResource).toContain('display_name = "Browser key (auto created by Firebase)"');
    expect(apiKeyResource).toContain('prevent_destroy = true');

    const allowedReferrers = apiKeyResource.match(/allowed_referrers\s*=\s*\[([^\]]+)\]/su)?.[1];
    expect(allowedReferrers).toBeDefined();
    expect([...(allowedReferrers ?? '').matchAll(/"([^"]+)"/gu)].map((match) => match[1])).toEqual([
      'https://intexuraos.cloud/*',
      'https://dev.intexuraos.cloud/*',
      'http://localhost:3000/*',
    ]);

    expect(
      [...apiKeyResource.matchAll(/service\s*=\s*"([^"]+)"/gu)].map((match) => match[1])
    ).toEqual([
      'firestore.googleapis.com',
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'firebaseinstallations.googleapis.com',
    ]);
    expect(apiKeyResource).not.toMatch(/\b(?:key_string|uid)\b/u);

    expect(apiKeyImport).toContain(
      'id = "projects/intexuraos-dev-pbuchman/locations/global/keys/d8251549-1bde-49c0-82a7-b0525a2fe688"'
    );
    expect(terraform).not.toMatch(
      /output\s+"[^"]+"\s*\{[^}]*google_apikeys_key\.firebase_browser\.(?:key_string|uid)/su
    );
  });

  it('grants the Terraform operator durable API Keys update permission', () => {
    const operatorTerraform = readFileSync(claudeCodeDevTerraformPath, 'utf8');
    const operatorReadme = readFileSync(claudeCodeDevReadmePath, 'utf8');

    expect([...operatorTerraform.matchAll(/"roles\/serviceusage\.apiKeysAdmin"/gu)]).toHaveLength(
      1
    );
    expect(operatorTerraform).not.toContain('"roles/owner"');
    expect(operatorReadme).toMatch(
      /\| `roles\/serviceusage\.apiKeysAdmin`\s+\| API key restriction management\s+\|/u
    );
  });

  it('passes the dev Sentry DSN as plain env after removing rollback IAM', () => {
    const transcriptionModule = sectionBetween(
      'module "function_transcription" {',
      '\n# Push subscription that delivers audio-stored events'
    );

    expect(transcriptionModule).toContain(
      'INTEXURAOS_SENTRY_DSN                           = local.versioned_runtime_config.dev["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(transcriptionModule).not.toContain(
      'INTEXURAOS_SENTRY_DSN               = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn_dev" {'
    );
    expect(terraform).not.toContain(
      'secret_id = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(transcriptionModule).not.toContain(
      'google_secret_manager_secret_iam_member.transcription_sentry_dsn_dev,'
    );
  });
});
