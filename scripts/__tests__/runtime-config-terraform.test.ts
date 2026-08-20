import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const terraformPath = resolve(repoRoot, 'terraform', 'environments', 'dev', 'main.tf');
const retainedGcpTerraformPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'retained-gcp.tf');
const iamTerraformPath = resolve(repoRoot, 'terraform', 'modules', 'iam', 'main.tf');
const iamVariablesPath = resolve(repoRoot, 'terraform', 'modules', 'iam', 'variables.tf');
const cloudBuildTerraformPath = resolve(repoRoot, 'terraform', 'modules', 'cloud-build', 'main.tf');
const cloudBuildVariablesPath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'cloud-build',
  'variables.tf'
);
const githubWifTerraformPath = resolve(repoRoot, 'terraform', 'modules', 'github-wif', 'main.tf');
const githubWifVariablesPath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'github-wif',
  'variables.tf'
);
const devTfvarsExamplePath = resolve(
  repoRoot,
  'terraform',
  'environments',
  'dev',
  'terraform.tfvars.example'
);
const secretPackageSourcesPath = resolve(
  repoRoot,
  'config',
  'environments',
  'secret-package-sources.json'
);
const cloudFunctionTerraformPath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'cloud-function',
  'main.tf'
);
const cloudFunctionVariablesPath = resolve(
  repoRoot,
  'terraform',
  'modules',
  'cloud-function',
  'variables.tf'
);
const hetznerBootstrapPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'bootstrap.tf');
const hetznerVariablesPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'variables.tf');
const hetznerOutputsPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'outputs.tf');
const hetznerAutoTfvarsPath = resolve(
  repoRoot,
  'terraform',
  'hetzner-prod',
  'prod.auto.tfvars.json'
);
const hetznerTfvarsExamplePath = resolve(
  repoRoot,
  'terraform',
  'hetzner-prod',
  'terraform.tfvars.example'
);
const deployFunctionPath = resolve(repoRoot, 'cloudbuild', 'scripts', 'deploy-function.sh');
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
const iamTerraform = readFileSync(iamTerraformPath, 'utf8');
const iamVariables = readFileSync(iamVariablesPath, 'utf8');
const cloudBuildTerraform = readFileSync(cloudBuildTerraformPath, 'utf8');
const cloudBuildVariables = readFileSync(cloudBuildVariablesPath, 'utf8');
const githubWifTerraform = readFileSync(githubWifTerraformPath, 'utf8');
const githubWifVariables = readFileSync(githubWifVariablesPath, 'utf8');
const devTfvarsExample = readFileSync(devTfvarsExamplePath, 'utf8');
const cloudFunctionTerraform = readFileSync(cloudFunctionTerraformPath, 'utf8');
const cloudFunctionVariables = readFileSync(cloudFunctionVariablesPath, 'utf8');
const hetznerBootstrap = readFileSync(hetznerBootstrapPath, 'utf8');
const hetznerVariables = readFileSync(hetznerVariablesPath, 'utf8');
const hetznerOutputs = readFileSync(hetznerOutputsPath, 'utf8');
const hetznerAutoTfvars = readFileSync(hetznerAutoTfvarsPath, 'utf8');
const hetznerTfvarsExample = readFileSync(hetznerTfvarsExamplePath, 'utf8');
const deployFunction = readFileSync(deployFunctionPath, 'utf8');
const claudeCodeDevTerraform = readFileSync(claudeCodeDevTerraformPath, 'utf8');

interface SecretPackageSourceEnvironment {
  legacyEnvNames: string[];
  legacyFiles: Record<string, string>;
}

interface SecretPackageSources {
  packages: Record<'dev' | 'prod', SecretPackageSourceEnvironment>;
}

const secretPackageSources = JSON.parse(
  readFileSync(secretPackageSourcesPath, 'utf8')
) as SecretPackageSources;

const physicalSecretIds = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_SECRET_PACKAGE_DEV',
  'INTEXURAOS_SECRET_PACKAGE_PROD',
  'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
] as const;

const legacyApplicationSecretIds = [
  'INTEXURAOS_CLOUDFLARE_API_TOKEN',
  'INTEXURAOS_DASHSCOPE_APP_API_KEY',
  'INTEXURAOS_ENCRYPTION_KEY',
  'INTEXURAOS_GITHUB_APP_PRIVATE_KEY',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET',
  'INTEXURAOS_GITHUB_WEBHOOK_SECRET',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
  'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN',
  'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
  'INTEXURAOS_KIMI_APP_API_KEY',
  'INTEXURAOS_LINEAR_API_KEY',
  'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
  'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
  'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
  'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN',
  'INTEXURAOS_MIMO_APP_API_KEY',
  'INTEXURAOS_MINIMAX_APP_API_KEY',
  'INTEXURAOS_OPENAI_APP_API_KEY',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_ORCHESTRATOR_SECRET',
  'INTEXURAOS_SENTRY_AUTOMATION_USER_ID',
  'INTEXURAOS_SENTRY_WEBHOOK_SECRET',
  'INTEXURAOS_SSL_PRIVATE_KEY',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
  'INTEXURAOS_WHATSAPP_APP_SECRET',
  'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
  'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
  'INTEXURAOS_WHATSAPP_WABA_ID',
] as const;

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

function sectionBetween(start: string, end: string): string {
  const startIndex = terraform.indexOf(start);
  const endIndex = terraform.indexOf(end, startIndex);

  expect(startIndex, `missing Terraform section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing Terraform section end: ${end}`).toBeGreaterThan(startIndex);
  return terraform.slice(startIndex, endIndex);
}

function expectedPackageSources(environment: 'dev' | 'prod'): string[] {
  const source = secretPackageSources.packages[environment];
  return [...new Set([...source.legacyEnvNames, ...Object.values(source.legacyFiles)])].sort();
}

describe('versioned runtime configuration Terraform cutover', () => {
  it('pins GitHub WIF to immutable repository claims and the development ref', () => {
    const provider = githubWifTerraform.match(
      /resource "google_iam_workload_identity_pool_provider" "github" \{[\s\S]*?\n\}/u
    )?.[0];
    const cloudBuildBinding = githubWifTerraform.match(
      /resource "google_service_account_iam_member" "github_wif_cloudbuild" \{[\s\S]*?\n\}/u
    )?.[0];
    const rootModule = sectionBetween('module "github_wif" {', '\n}\n');

    expect(provider).toContain('"attribute.repository_owner_id" = "assertion.repository_owner_id"');
    expect(provider).toContain('"attribute.repository_id"       = "assertion.repository_id"');
    expect(provider).toContain(
      "assertion.repository_owner_id == '${var.github_repository_owner_id}'"
    );
    expect(provider).toContain("assertion.repository_id == '${var.github_repository_id}'");
    expect(provider).toContain("assertion.repository == '${var.github_owner}/${var.github_repo}'");
    expect(provider).toContain("assertion.ref == '${var.github_ref}'");

    expect(githubWifVariables).toMatch(
      /variable "github_repository_owner_id" \{[\s\S]*?var\.github_repository_owner_id == "368465"[\s\S]*?\}/u
    );
    expect(githubWifVariables).toMatch(
      /variable "github_repository_id" \{[\s\S]*?var\.github_repository_id == "1118959310"[\s\S]*?\}/u
    );
    expect(githubWifVariables).toMatch(
      /variable "github_ref" \{[\s\S]*?var\.github_ref == "refs\/heads\/development"[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /variable "github_repository_owner_id" \{[\s\S]*?default\s*=\s*"368465"[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /variable "github_repository_id" \{[\s\S]*?default\s*=\s*"1118959310"[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /variable "github_ref" \{[\s\S]*?default\s*=\s*"refs\/heads\/development"[\s\S]*?\}/u
    );
    expect(rootModule).toMatch(/github_repository_owner_id\s*=\s*var\.github_repository_owner_id/u);
    expect(rootModule).toMatch(/github_repository_id\s*=\s*var\.github_repository_id/u);
    expect(rootModule).toMatch(/github_ref\s*=\s*var\.github_ref/u);
    expect(devTfvarsExample).toMatch(/github_repository_owner_id\s*=\s*"368465"/u);
    expect(devTfvarsExample).toMatch(/github_repository_id\s*=\s*"1118959310"/u);
    expect(devTfvarsExample).toMatch(/github_ref\s*=\s*"refs\/heads\/development"/u);

    expect(cloudBuildBinding).toContain(
      'service_account_id = var.cloud_build_service_account_name'
    );
    expect(cloudBuildBinding).toContain('/attribute.repository_id/${var.github_repository_id}');
  });

  it('applies the same immutable claim boundary to the retained Cloud Build provider', () => {
    const provider = cloudBuildTerraform.match(
      /resource "google_iam_workload_identity_pool_provider" "github" \{[\s\S]*?\n\}/u
    )?.[0];
    const cloudBuildBinding = cloudBuildTerraform.match(
      /resource "google_service_account_iam_member" "github_actions_wif" \{[\s\S]*?\n\}/u
    )?.[0];
    const rootModule = sectionBetween('module "cloud_build" {', '\n}\n');

    expect(provider).toContain('"attribute.repository_owner_id" = "assertion.repository_owner_id"');
    expect(provider).toContain('"attribute.repository_id"       = "assertion.repository_id"');
    expect(provider).toContain(
      "assertion.repository_owner_id == '${var.github_repository_owner_id}'"
    );
    expect(provider).toContain("assertion.repository_id == '${var.github_repository_id}'");
    expect(provider).toContain("assertion.repository == '${var.github_owner}/${var.github_repo}'");
    expect(provider).toContain("assertion.ref == '${var.github_ref}'");
    expect(cloudBuildVariables).toMatch(
      /variable "github_repository_owner_id" \{[\s\S]*?var\.github_repository_owner_id == "368465"[\s\S]*?\}/u
    );
    expect(cloudBuildVariables).toMatch(
      /variable "github_repository_id" \{[\s\S]*?var\.github_repository_id == "1118959310"[\s\S]*?\}/u
    );
    expect(cloudBuildVariables).toMatch(
      /variable "github_ref" \{[\s\S]*?var\.github_ref == "refs\/heads\/development"[\s\S]*?\}/u
    );
    expect(rootModule).toMatch(/github_repository_owner_id\s*=\s*var\.github_repository_owner_id/u);
    expect(rootModule).toMatch(/github_repository_id\s*=\s*var\.github_repository_id/u);
    expect(rootModule).toMatch(/github_ref\s*=\s*var\.github_ref/u);
    expect(cloudBuildBinding).toContain(
      'service_account_id = google_service_account.cloud_build.name'
    );
    expect(cloudBuildBinding).toContain('/attribute.repository_id/${var.github_repository_id}');
  });

  it('uses separate least-privilege DEV and PROD package publisher identities', () => {
    expect(terraform).toContain(
      'secret_package_source_manifest = jsondecode(file("${path.module}/../../../config/environments/secret-package-sources.json"))'
    );
    expect(terraform).toMatch(
      /secret_package_dev_legacy_source_names\s*=\s*setunion\([\s\S]*?packages\.dev\.legacyEnvNames[\s\S]*?packages\.dev\.legacyFiles[\s\S]*?\)/u
    );
    expect(terraform).toMatch(
      /secret_package_prod_legacy_source_names\s*=\s*setunion\([\s\S]*?packages\.prod\.legacyEnvNames[\s\S]*?packages\.prod\.legacyFiles[\s\S]*?\)/u
    );
    expect(terraform).toMatch(
      /secret_package_native_source_names\s*=\s*toset\(\[[\s\S]*?INTEXURAOS_INTERNAL_AUTH_TOKEN[\s\S]*?INTEXURAOS_SPEECHMATICS_APP_API_KEY[\s\S]*?\]\)/u
    );
    expect(terraform).toMatch(
      /secret_package_dev_active_source_names\s*=\s*setunion\([\s\S]*?setintersection\([\s\S]*?secret_package_dev_legacy_source_names[\s\S]*?secret_package_native_source_names[\s\S]*?var\.legacy_secret_readers_enabled \? local\.secret_package_dev_legacy_source_names : toset\(\[\]\)[\s\S]*?\)/u
    );
    expect(terraform).toMatch(
      /secret_package_prod_active_source_names\s*=\s*setunion\([\s\S]*?setintersection\([\s\S]*?secret_package_prod_legacy_source_names[\s\S]*?secret_package_native_source_names[\s\S]*?var\.legacy_secret_readers_enabled \? local\.secret_package_prod_legacy_source_names : toset\(\[\]\)[\s\S]*?\)/u
    );
    expect(expectedPackageSources('dev')).toHaveLength(35);
    expect(expectedPackageSources('dev')).toEqual(
      expect.arrayContaining([
        'INTEXURAOS_INTERNAL_AUTH_TOKEN',
        'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
      ])
    );
    expect(expectedPackageSources('prod')).toHaveLength(28);
    expect(expectedPackageSources('prod')).toContain('INTEXURAOS_INTERNAL_AUTH_TOKEN');
    expect(expectedPackageSources('prod')).not.toContain('INTEXURAOS_SPEECHMATICS_APP_API_KEY');

    for (const [environment, packageName] of [
      ['dev', 'INTEXURAOS_SECRET_PACKAGE_DEV'],
      ['prod', 'INTEXURAOS_SECRET_PACKAGE_PROD'],
    ] as const) {
      const account = sectionBetween(
        `resource "google_service_account" "secret_package_${environment}_publisher" {`,
        '\n}\n'
      );
      const versionAdder = sectionBetween(
        `resource "google_secret_manager_secret_iam_member" "secret_package_${environment}_publisher_version_adder" {`,
        '\n}\n'
      );
      const targetAccessor = sectionBetween(
        `resource "google_secret_manager_secret_iam_member" "secret_package_${environment}_publisher_target_accessor" {`,
        '\n}\n'
      );
      const targetMetadataViewer = sectionBetween(
        `resource "google_secret_manager_secret_iam_member" "secret_package_${environment}_publisher_target_metadata_viewer" {`,
        '\n}\n'
      );
      const sourceAccessor = sectionBetween(
        `resource "google_secret_manager_secret_iam_member" "secret_package_${environment}_publisher_source_accessor" {`,
        '\n}\n'
      );
      const operatorImpersonation = sectionBetween(
        `resource "google_service_account_iam_member" "secret_migration_${environment}_publisher_token_creator" {`,
        '\n}\n'
      );

      expect(account).toContain(`account_id   = "ixos-secret-publisher-${environment}"`);
      expect(versionAdder).toContain(
        `secret_id = module.secret_manager.secret_ids["${packageName}"]`
      );
      expect(versionAdder).toContain('role      = "roles/secretmanager.secretVersionAdder"');
      expect(versionAdder).toContain(
        `member    = "serviceAccount:\${google_service_account.secret_package_${environment}_publisher.email}"`
      );
      expect(targetAccessor).toContain(
        `secret_id = module.secret_manager.secret_ids["${packageName}"]`
      );
      expect(targetAccessor).toContain('role      = "roles/secretmanager.secretAccessor"');
      expect(targetAccessor).toContain(
        `member    = "serviceAccount:\${google_service_account.secret_package_${environment}_publisher.email}"`
      );
      expect(targetAccessor).not.toContain(
        environment === 'dev' ? 'INTEXURAOS_SECRET_PACKAGE_PROD' : 'INTEXURAOS_SECRET_PACKAGE_DEV'
      );
      expect(targetMetadataViewer).toContain(
        `secret_id = module.secret_manager.secret_ids["${packageName}"]`
      );
      expect(targetMetadataViewer).toContain('role      = "roles/secretmanager.viewer"');
      expect(targetMetadataViewer).toContain(
        `member    = "serviceAccount:\${google_service_account.secret_package_${environment}_publisher.email}"`
      );
      expect(targetMetadataViewer).not.toContain(
        environment === 'dev' ? 'INTEXURAOS_SECRET_PACKAGE_PROD' : 'INTEXURAOS_SECRET_PACKAGE_DEV'
      );
      expect(sourceAccessor).toContain(
        `for_each = local.secret_package_${environment}_active_source_names`
      );
      expect(sourceAccessor).toContain('secret_id = module.secret_manager.secret_ids[each.value]');
      expect(sourceAccessor).toContain('role      = "roles/secretmanager.secretAccessor"');
      expect(sourceAccessor).toContain(
        `member    = "serviceAccount:\${google_service_account.secret_package_${environment}_publisher.email}"`
      );
      expect(operatorImpersonation).toContain(
        `service_account_id = google_service_account.secret_package_${environment}_publisher.name`
      );
      expect(operatorImpersonation).toContain(
        'role               = "roles/iam.serviceAccountTokenCreator"'
      );
      expect(operatorImpersonation).toContain(
        'member             = "serviceAccount:${module.claude_code_dev.service_account_email}"'
      );
    }

    const projectIamBlocks = [
      ...terraform.matchAll(/resource "google_project_iam_member" "[^"]+" \{[\s\S]*?\n\}/gu),
    ].map((match) => match[0]);
    expect(projectIamBlocks).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/google_service_account\.secret_package_(?:dev|prod)_publisher/u),
      ])
    );
    expect(terraform).not.toMatch(
      /resource "google_service_account_key" "[^"]*secret_package_(?:dev|prod)_publisher/u
    );
    expect(claudeCodeDevTerraform).not.toContain('"roles/secretmanager.admin"');
    expect(claudeCodeDevTerraform).not.toContain('"roles/iam.serviceAccountTokenCreator"');
  });

  it('grants the migration operator metadata-only access to IntexuraOS secret containers', () => {
    const metadataViewer = sectionBetween(
      'resource "google_project_iam_member" "claude_code_dev_secret_metadata_viewer" {',
      '\n}\n'
    );

    expect(metadataViewer).toContain('project = var.project_id');
    expect(metadataViewer).toContain('role    = "roles/secretmanager.viewer"');
    expect(metadataViewer).toContain(
      'member  = "serviceAccount:${module.claude_code_dev.service_account_email}"'
    );
    expect(metadataViewer).toContain('condition {');
    expect(metadataViewer).toContain('resource.type == \\"secretmanager.googleapis.com/Secret\\"');
    expect(metadataViewer).toContain(
      'resource.name.startsWith(\\"projects/${data.google_project.current.number}/secrets/INTEXURAOS_\\")'
    );
    expect(metadataViewer).not.toContain('roles/secretmanager.secretAccessor');
    expect(metadataViewer).not.toContain('roles/secretmanager.admin');
    const operatorProjectIamBlocks = [
      ...terraform.matchAll(/resource "google_project_iam_member" "[^"]+" \{[\s\S]*?\n\}/gu),
    ]
      .map((match) => match[0])
      .filter((block) => block.includes('module.claude_code_dev.service_account_email'));
    for (const block of operatorProjectIamBlocks) {
      expect(block).not.toMatch(/roles\/secretmanager\.(?:admin|secretAccessor)/u);
    }
  });

  it('declares the target inventory additively without Terraform-managed values', () => {
    const targetSection = sectionBetween(
      'target_secret_containers = {',
      '\n\n  legacy_secret_container_names = toset(['
    );
    const legacySection = sectionBetween(
      'legacy_secret_container_names = toset([',
      '\n  ])\n\n  legacy_secret_containers = {'
    );
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nmoved {\n  from = google_secret_manager_secret.cloudflare_dns_api_token'
    );

    const targetIds = [...targetSection.matchAll(/"(INTEXURAOS_[A-Z0-9_]+)"\s*=/gu)]
      .map((match) => match[1])
      .sort();
    const legacyIds = [...legacySection.matchAll(/"(INTEXURAOS_[A-Z0-9_]+)"/gu)]
      .map((match) => match[1])
      .sort();

    expect(targetIds).toEqual(physicalSecretIds);
    expect(legacyIds).toEqual(legacyApplicationSecretIds);
    expect(secretManagerSection).toContain('local.target_secret_containers');
    expect(secretManagerSection).toContain(
      'var.legacy_secret_containers_enabled ? local.legacy_secret_containers : {}'
    );
    expect(terraform).toMatch(
      /variable "legacy_secret_readers_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /variable "legacy_secret_containers_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /check "legacy_secret_reader_container_order" \{[\s\S]*?condition\s*=\s*!var\.legacy_secret_readers_enabled \|\| var\.legacy_secret_containers_enabled[\s\S]*?\}/u
    );
    expect(devTfvarsExample).toContain('legacy_secret_readers_enabled    = true');
    expect(devTfvarsExample).toContain('legacy_secret_containers_enabled = true');
    expect(terraform).not.toContain('legacy_secret_manager_enabled');
    expect(terraform).not.toContain('resource "google_secret_manager_secret_version"');
    expect(terraform).not.toMatch(/\bsecret_data\s*=/u);
    expect(terraform).toContain(
      'from = google_secret_manager_secret.cloudflare_dns_api_token\n  to   = google_secret_manager_secret.cloudflare_dns_api_token[0]'
    );
    expect(terraform).toContain(
      'resource "google_secret_manager_secret" "cloudflare_dns_api_token" {\n  count = var.legacy_secret_containers_enabled ? 1 : 0'
    );
  });

  it('loads versioned config after removing every rollback-only IaC reference', () => {
    const secretManagerSection = sectionBetween(
      'module "secret_manager" {',
      '\nmoved {\n  from = google_secret_manager_secret.cloudflare_dns_api_token'
    );

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

  it('adds package readers and makes all legacy runtime accessors cleanup-gated', () => {
    const provisionerBinding = sectionBetween(
      'resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_prod_package" {',
      '\n}\n'
    );
    const homeDevBinding = sectionBetween(
      'resource "google_secret_manager_secret_iam_member" "home_dev_secret_renderer_dev_package" {',
      '\n}\n'
    );
    const iamModule = sectionBetween(
      'module "iam" {',
      '\n}\n\n# -----------------------------------------------------------------------------\n# Claude Code Dev'
    );

    expect(provisionerBinding).toContain(
      'secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_PROD"]'
    );
    expect(provisionerBinding).toContain(
      'member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"'
    );
    expect(homeDevBinding).toContain(
      'secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_DEV"]'
    );
    expect(homeDevBinding).toContain('google_service_account.home_dev_secret_renderer.email');
    expect(terraform).toContain('account_id   = "ixos-home-secret-renderer-${var.environment}"');
    expect([
      ...terraform.matchAll(/google_service_account\.home_dev_secret_renderer/gu),
    ]).toHaveLength(3);
    expect(terraform).toContain(
      'for_each = var.legacy_secret_readers_enabled ? local.hetzner_runtime_secret_names : toset([])'
    );
    expect(iamModule).toContain(
      'legacy_secret_readers_enabled = var.legacy_secret_readers_enabled'
    );
    expect(iamModule).toContain('contains(local.legacy_cloud_run_secret_names, name)');
    expect(terraform).toContain('output "home_dev_secret_renderer_service_account_email" {');
    expect(terraform).toContain(
      'value       = google_service_account.home_dev_secret_renderer.email'
    );
    expect(iamTerraform).toContain(
      'for_each = var.legacy_secret_readers_enabled ? var.secret_ids : {}'
    );
    expect(iamVariables).toMatch(
      /variable "legacy_secret_readers_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(iamVariables).not.toContain('legacy_secret_manager_enabled');
  });

  it('gives the dedicated home orchestrator only repository pull access and narrow key bootstrap', () => {
    const orchestratorAccount = sectionBetween(
      'resource "google_service_account" "home_dev_orchestrator" {',
      '\n}\n'
    );
    const repositoryReader = sectionBetween(
      'resource "google_artifact_registry_repository_iam_member" "home_dev_orchestrator_reader" {',
      '\n}\n'
    );
    const keyAdmin = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_home_orchestrator_key_admin" {',
      '\n}\n'
    );

    expect(orchestratorAccount).toContain(
      'account_id   = "ixos-home-orchestrator-${var.environment}"'
    );
    expect(repositoryReader).toContain('project    = var.project_id');
    expect(repositoryReader).toContain('location   = var.region');
    expect(repositoryReader).toContain('repository = module.artifact_registry.repository_id');
    expect(repositoryReader).toContain('role       = "roles/artifactregistry.reader"');
    expect(repositoryReader).toContain(
      'member     = "serviceAccount:${google_service_account.home_dev_orchestrator.email}"'
    );
    expect(keyAdmin).toContain('google_service_account.home_dev_orchestrator.name');
    expect(keyAdmin).toContain('role               = "roles/iam.serviceAccountKeyAdmin"');
    expect(keyAdmin).toContain(
      'member             = "serviceAccount:${module.claude_code_dev.service_account_email}"'
    );
    expect(terraform).toContain('output "home_dev_orchestrator_service_account_email" {');
    expect(terraform).toContain('value       = google_service_account.home_dev_orchestrator.email');
    expect([...terraform.matchAll(/google_service_account\.home_dev_orchestrator/gu)]).toHaveLength(
      3
    );
    expect(terraform).not.toMatch(
      /google_project_iam_member[\s\S]{0,400}google_service_account\.home_dev_orchestrator/u
    );
    expect(terraform).not.toMatch(
      /google_secret_manager_secret_iam_member[\s\S]{0,400}google_service_account\.home_dev_orchestrator/u
    );
  });

  it('gives the dedicated home runtime the Hetzner runtime data-plane union without Secret Manager', () => {
    const runtimeAccount = sectionBetween(
      'resource "google_service_account" "home_dev_runtime" {',
      '\n}\n'
    );
    const projectRoles = sectionBetween(
      'resource "google_project_iam_member" "home_dev_runtime_project_roles" {',
      '\n}\n'
    );
    const bucketRoles = sectionBetween(
      'resource "google_storage_bucket_iam_member" "home_dev_runtime_bucket_object_admin" {',
      '\n}\n'
    );
    const keyAdmin = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_home_runtime_key_admin" {',
      '\n}\n'
    );

    expect(runtimeAccount).toContain('account_id   = "ixos-home-runtime-${var.environment}"');
    expect([...projectRoles.matchAll(/"(roles\/[A-Za-z.]+)"/gu)].map((match) => match[1])).toEqual([
      'roles/datastore.user',
      'roles/firebaseauth.admin',
      'roles/logging.logWriter',
      'roles/pubsub.publisher',
    ]);
    expect(projectRoles).toContain('google_service_account.home_dev_runtime.email');
    expect(bucketRoles).toContain('generated_images = module.generated_images_bucket.bucket_name');
    expect(bucketRoles).toContain('shared_content   = module.shared_content.bucket_name');
    expect(bucketRoles).toContain('whatsapp_media   = module.whatsapp_media_bucket.bucket_name');
    expect(bucketRoles).toContain('role   = "roles/storage.objectAdmin"');
    expect(bucketRoles).toContain('google_service_account.home_dev_runtime.email');
    expect(keyAdmin).toContain('google_service_account.home_dev_runtime.name');
    expect(keyAdmin).toContain('role               = "roles/iam.serviceAccountKeyAdmin"');
    expect(terraform).toContain('output "home_dev_runtime_service_account_email" {');
    expect(terraform).toContain('value       = google_service_account.home_dev_runtime.email');
    expect(terraform).not.toContain('home_dev_runtime_token_creator');
    expect(terraform).not.toMatch(
      /google_secret_manager_secret_iam_member[\s\S]{0,400}google_service_account\.home_dev_runtime/u
    );
  });

  it('grants key rotation only on the four migration service accounts', () => {
    const runtimeRotation = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_runtime_key_admin" {',
      '\n}\n'
    );
    const rendererRotation = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_renderer_key_admin" {',
      '\n}\n'
    );
    const orchestratorRotation = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_home_orchestrator_key_admin" {',
      '\n}\n'
    );
    const homeRuntimeRotation = sectionBetween(
      'resource "google_service_account_iam_member" "secret_migration_home_runtime_key_admin" {',
      '\n}\n'
    );

    for (const binding of [
      runtimeRotation,
      rendererRotation,
      orchestratorRotation,
      homeRuntimeRotation,
    ]) {
      expect(binding).toContain('role               = "roles/iam.serviceAccountKeyAdmin"');
      expect(binding).toContain(
        'member             = "serviceAccount:${module.claude_code_dev.service_account_email}"'
      );
    }
    expect(runtimeRotation).toContain('google_service_account.hetzner_runtime.name');
    expect(rendererRotation).toContain('google_service_account.home_dev_secret_renderer.name');
    expect(orchestratorRotation).toContain('google_service_account.home_dev_orchestrator.name');
    expect(homeRuntimeRotation).toContain('google_service_account.home_dev_runtime.name');
    expect(terraform).not.toMatch(
      /google_project_iam_member[\s\S]{0,400}roles\/iam\.serviceAccountKeyAdmin/u
    );
  });

  it('cleanup-gates Cloud Build secret access while preserving the managed connection', () => {
    expect(cloudBuildTerraform).toContain('cloud_build_secret_accessor');
    expect(cloudBuildTerraform).toContain(
      'from = google_project_iam_member.cloud_build_secret_accessor\n  to   = google_project_iam_member.cloud_build_secret_accessor[0]'
    );
    expect(cloudBuildTerraform).toContain('count = var.legacy_secret_readers_enabled ? 1 : 0');
    expect(cloudBuildVariables).toMatch(
      /variable "legacy_secret_readers_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(cloudBuildVariables).not.toContain('legacy_secret_manager_enabled');
    expect(cloudBuildTerraform).toContain('roles/secretmanager.secretAccessor');
    expect(cloudBuildTerraform).toContain('resource "google_cloudbuildv2_connection" "github" {');
    expect(cloudBuildTerraform).toContain('github_config {}');
    expect(cloudBuildTerraform).toContain('ignore_changes = [github_config]');
  });

  it('pins transcription native secrets to positive numeric versions in Terraform and deploys', () => {
    const transcriptionModule = sectionBetween(
      'module "function_transcription" {',
      '\n# Push subscription that delivers audio-stored events'
    );

    expect(cloudFunctionVariables).toMatch(
      /variable "secrets" \{[\s\S]*type\s*=\s*map\(object\(\{[\s\S]*secret_id\s*=\s*string[\s\S]*version\s*=\s*number[\s\S]*\}\)\)/u
    );
    expect(cloudFunctionVariables).toContain('floor(secret.version) == secret.version');
    expect(cloudFunctionVariables).toContain('secret.version > 0');
    expect(cloudFunctionTerraform).toContain(
      'secret     = secret_environment_variables.value.secret_id'
    );
    expect(cloudFunctionTerraform).toContain(
      'version    = tostring(secret_environment_variables.value.version)'
    );
    expect(cloudFunctionTerraform).not.toContain('version    = "latest"');
    expect(transcriptionModule).toContain('secrets = local.transcription_native_secrets');
    expect(terraform).toMatch(
      /INTEXURAOS_INTERNAL_AUTH_TOKEN\s*=\s*\{[\s\S]*?version\s*=\s*2[\s\S]*?\}/u
    );
    expect(terraform).toMatch(
      /INTEXURAOS_SPEECHMATICS_APP_API_KEY\s*=\s*\{[\s\S]*?version\s*=\s*1[\s\S]*?\}/u
    );
    expect(deployFunction).toContain('INTEXURAOS_INTERNAL_AUTH_TOKEN:2');
    expect(deployFunction).toContain('INTEXURAOS_SPEECHMATICS_APP_API_KEY:1');
    expect(deployFunction).not.toMatch(/(?:versions\/latest|:\s*latest\b)/u);
  });

  it('makes legacy runtime credential copy and secret inventory explicitly cleanup-gated', () => {
    const targetRetainedIds = [
      ...(retainedGcpTerraform
        .split('retained_gcp_target_secret_ids = toset([')[1]
        ?.split('])')[0]
        ?.matchAll(/"(INTEXURAOS_[A-Z0-9_]+)"/gu) ?? []),
    ]
      .map((match) => match[1])
      .sort();

    expect(targetRetainedIds).toEqual(physicalSecretIds);
    expect(retainedGcpTerraform).toContain(
      'var.legacy_secret_containers_enabled ? local.retained_gcp_legacy_secret_ids : toset([])'
    );
    expect(retainedGcpTerraform).toContain(
      'cloudflare_dns_api_token_name = var.legacy_secret_containers_enabled ? local.retained_gcp.cloudflare_dns_api_token_secret_id : null'
    );
    expect(hetznerOutputs).toContain(
      'value       = var.legacy_secret_containers_enabled ? local.retained_gcp.cloudflare_dns_api_token_secret_id : null'
    );
    expect(hetznerVariables).toMatch(
      /variable "legacy_secret_containers_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(hetznerAutoTfvars).toContain('"legacy_secret_containers_enabled": true');
    expect(hetznerTfvarsExample).toContain('legacy_secret_containers_enabled       = true');
    expect(
      [retainedGcpTerraform, hetznerVariables, hetznerOutputs, hetznerAutoTfvars].join('\n')
    ).not.toContain('legacy_secret_manager_enabled');
    expect(hetznerBootstrap).toContain('provisioner_sa_key_path');
    const primaryBootstrap = hetznerBootstrap.split(
      'resource "terraform_data" "legacy_runtime_sa_bootstrap" {'
    )[0];
    expect(primaryBootstrap).not.toContain('runtime_sa_key_path');
    expect(primaryBootstrap).toContain('terraform_data.legacy_runtime_sa_bootstrap');
    expect(hetznerBootstrap).toContain(
      'count = var.hetzner_bootstrap_enabled && var.legacy_runtime_sa_bootstrap_enabled ? 1 : 0'
    );
    const legacyBootstrap = hetznerBootstrap.split(
      'resource "terraform_data" "legacy_runtime_sa_bootstrap" {'
    )[1];
    expect(legacyBootstrap).toContain('depends_on = [hcloud_server.prod]');
    expect(legacyBootstrap).not.toContain('depends_on = [terraform_data.bootstrap_prod]');
    expect(hetznerVariables).toMatch(
      /variable "legacy_runtime_sa_bootstrap_enabled" \{[\s\S]*?default\s*=\s*true[\s\S]*?\}/u
    );
    expect(hetznerAutoTfvars).toContain('"legacy_runtime_sa_bootstrap_enabled": true');
    expect(hetznerTfvarsExample).toContain('legacy_runtime_sa_bootstrap_enabled');
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

  it('does not grant home-dev orchestrator direct access to a single GitHub App secret', () => {
    expect(terraform).not.toContain(
      'resource "google_secret_manager_secret_iam_member" "home_orchestrator_github_app_private_key" {'
    );
    expect(terraform).not.toContain('data "google_service_account" "home_orchestrator" {');
  });

  it('imports and restricts the existing Firebase browser key without exposing key material', () => {
    const apiKeyResource = sectionBetween(
      'resource "google_apikeys_key" "firebase_browser" {',
      '\nimport {\n'
    );
    const apiKeyImport = sectionBetween(
      'import {\n  to = google_apikeys_key.firebase_browser',
      '\n}\n'
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

  it('declares a parallel restricted Firebase browser replacement for additive rotation', () => {
    const replacement = sectionBetween(
      'resource "google_apikeys_key" "firebase_browser_replacement" {',
      '\n# -----------------------------------------------------------------------------\n# Artifact Registry'
    );

    expect(replacement).toContain('name         = "intexuraos-firebase-browser-2026"');
    expect(replacement).toContain('project      = var.project_id');
    expect(replacement).toContain('prevent_destroy = true');

    const allowedReferrers = replacement.match(/allowed_referrers\s*=\s*\[([^\]]+)\]/su)?.[1];
    expect([...(allowedReferrers ?? '').matchAll(/"([^"]+)"/gu)].map((match) => match[1])).toEqual([
      'https://intexuraos.cloud/*',
      'https://dev.intexuraos.cloud/*',
      'http://localhost:3000/*',
    ]);
    expect([...replacement.matchAll(/service\s*=\s*"([^"]+)"/gu)].map((match) => match[1])).toEqual(
      [
        'firestore.googleapis.com',
        'identitytoolkit.googleapis.com',
        'securetoken.googleapis.com',
        'firebaseinstallations.googleapis.com',
      ]
    );
    expect(replacement).not.toContain('generativelanguage.googleapis.com');
    expect(terraform).not.toMatch(
      /output\s+"[^"]+"\s*\{[^}]*google_apikeys_key\.firebase_browser_replacement\.key_string/su
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
