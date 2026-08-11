import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const terraformPath = resolve(repoRoot, 'terraform', 'environments', 'dev', 'main.tf');
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

interface RuntimeConfigPolicy {
  migrationRollbackSecretNames: string[];
  secretManagerNames: string[];
}

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
  it('keeps the Secret Manager module inventory exactly synchronized with policy', () => {
    const policy = readRuntimePolicy();
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nresource "google_secret_manager_secret" "cloudflare_dns_api_token"'
    );
    const moduleNames = [...secretManagerSection.matchAll(/^\s*"(INTEXURAOS_[A-Z0-9_]+)"\s*=/gmu)]
      .map((match) => match[1])
      .sort();

    expect(moduleNames).toEqual([...policy.secretManagerNames].sort());
    expect(moduleNames).not.toContain('INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN');
    expect(terraform).toContain('secret_id = "INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN"');
  });

  it('loads common and dev versioned configuration without removing rollback secrets', () => {
    const policy = readRuntimePolicy();
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nresource "google_secret_manager_secret" "cloudflare_dns_api_token"'
    );

    expect(terraform).toContain('versioned_runtime_config = {');
    expect(terraform).toContain(
      'common = jsondecode(file("${path.module}/../../../config/environments/common.json"))'
    );
    expect(terraform).toContain(
      'dev    = jsondecode(file("${path.module}/../../../config/environments/dev.json"))'
    );

    expect(policy.migrationRollbackSecretNames).toHaveLength(26);
    for (const secretName of policy.migrationRollbackSecretNames) {
      expect(secretManagerSection, secretName).toContain(`"${secretName}"`);
    }
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

  it('passes the dev Sentry DSN to transcription as plain env while retaining rollback IAM', () => {
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
    expect(terraform).toContain(
      'resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn_dev" {'
    );
    expect(terraform).toContain(
      'secret_id = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN_DEV"]'
    );
    expect(transcriptionModule).toContain(
      'google_secret_manager_secret_iam_member.transcription_sentry_dsn_dev,'
    );
  });
});
