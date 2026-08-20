import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const renderAlloyConfigPath = resolve(repoRoot, 'scripts/observability/render-alloy-config.mjs');
const installAlloyPath = resolve(repoRoot, 'scripts/observability/install-grafana-alloy.sh');
const loadGrafanaCloudEnvPath = resolve(
  repoRoot,
  'scripts/observability/load-grafana-cloud-env.sh'
);
const provisionDashboardPath = resolve(
  repoRoot,
  'scripts/observability/provision-grafana-dashboard.mjs'
);
const dashboardPath = resolve(repoRoot, 'infra/grafana/dashboards/intexuraos-pm2-logs.json');

function readRequired(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Missing required file: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function renderConfig(args: string[]): string {
  return execFileSync('node', [renderAlloyConfigPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('Grafana Alloy PM2 log collection', () => {
  it('renders a prod Alloy config that tails PM2 logs and labels environment, host, service, and stream', () => {
    const config = renderConfig([
      '--environment',
      'prod',
      '--host',
      'hetzner-prod',
      '--pm2-log-glob',
      '/home/deploy/.pm2/logs/*.log',
    ]);

    expect(config).toContain('loki.source.file "pm2_logs"');
    expect(config).toContain('__path__         = "/home/deploy/.pm2/logs/*.log",');
    expect(config).toContain('__path_exclude__ = "/home/deploy/.pm2/logs/*.{gz,zip,bak,old}",');
    expect(config).toMatch(/project\s+=\s+"intexuraos",/);
    expect(config).toMatch(/environment\s+=\s+"prod",/);
    expect(config).toMatch(/host\s+=\s+"hetzner-prod",/);
    expect(config).toContain('loki.relabel "pm2_labels"');
    expect(config).toContain('target_label  = "service"');
    expect(config).toContain('target_label  = "stream"');
    expect(config).toContain('regex         = "^.*/(.+)-(out|error)(?:-[0-9]+)?\\\\.log$"');
    expect(config).toContain('loki.process "pm2_logs"');
    expect(config).toContain('stage.decolorize');
    expect(config).toContain('loki.write "grafana_cloud"');
    expect(config).toContain('url      = sys.env("INTEXURAOS_GRAFANA_CLOUD_LOKI_URL")');
    expect(config).toContain('username = sys.env("INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME")');
    expect(config).toContain('password = sys.env("INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN")');
    expect(config).not.toContain('glc_');
    expect(config).not.toContain('glsa_');
  });

  it('installs Alloy with a systemd environment drop-in and never writes dashboard tokens to collectors', () => {
    const installScript = readRequired(installAlloyPath);
    const loadEnvScript = readRequired(loadGrafanaCloudEnvPath);

    expect(installScript).toContain('https://apt.grafana.com');
    expect(installScript).toContain('apt-get install -y alloy');
    expect(installScript).toContain('/etc/systemd/system/alloy.service.d/intexuraos.conf');
    expect(installScript).toContain('EnvironmentFile=');
    expect(installScript).toContain('render-alloy-config.mjs');
    expect(installScript).toContain('systemctl enable alloy.service');
    expect(installScript).toContain('systemctl restart alloy.service');
    expect(installScript).toContain('configure_pm2_log_acl()');
    expect(installScript).toContain('apt-get install -y acl');
    expect(installScript).toContain('setfacl');
    expect(installScript).toContain('u:alloy');

    expect(loadEnvScript).toContain('GRAFANA_CLOUD_COLLECTOR_CONFIG=(');
    expect(loadEnvScript).toContain(
      'GRAFANA_CLOUD_COLLECTOR_TOKEN="INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN"'
    );
    expect(loadEnvScript).toContain('SECRET_PACKAGE_RENDER_DIR');
    expect(loadEnvScript).toContain('render-runtime-config.mjs');
    expect(loadEnvScript).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_URL');
    expect(loadEnvScript).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME');

    expect(loadEnvScript).not.toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
    expect(installScript).not.toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
  });
});

describe('Grafana dashboard provisioning', () => {
  it('defines a default PM2 logs dashboard with dev/prod variables and log panels', () => {
    const dashboard = JSON.parse(readRequired(dashboardPath)) as {
      uid?: string;
      title?: string;
      panels?: { title?: string; targets?: { expr?: string }[] }[];
      templating?: { list?: { name?: string; query?: string }[] };
    };

    expect(dashboard.uid).toBe('intexuraos-pm2-logs');
    expect(dashboard.title).toBe('IntexuraOS PM2 Logs');
    expect(dashboard.templating?.list?.map((variable) => variable.name)).toEqual([
      'datasource',
      'environment',
      'host',
      'service',
      'stream',
    ]);
    expect(dashboard.panels?.map((panel) => panel.title)).toEqual([
      'Live PM2 Logs',
      'Latest Errors',
      'Log Volume by Service',
      'Error Lines by Service',
      'Top Noisy Services',
      'Dev vs Prod Log Volume',
    ]);

    const allExpressions = dashboard.panels
      ?.flatMap((panel) => panel.targets ?? [])
      .map((target) => target.expr ?? '')
      .join('\n');
    expect(allExpressions).toContain('{project="intexuraos"');
    expect(allExpressions).toContain('environment=~"$environment"');
    expect(allExpressions).toContain('host=~"$host"');
    expect(allExpressions).toContain('service=~"$service"');
    expect(allExpressions).toContain('stream=~"$stream"');
    expect(allExpressions).toContain('(?i)(error|fail|exception|fatal|panic|uncaught)');
  });

  it('provisions dashboards through Grafana API without embedding tokens in files', () => {
    const script = readRequired(provisionDashboardPath);

    expect(script).toContain('/api/datasources');
    expect(script).toContain('/api/folders');
    expect(script).toContain('/api/dashboards/db');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_URL');
    expect(script).toContain('alert-state-history');
    expect(script).toContain('usage-insights');
    expect(script).toContain('Authorization');
    expect(script).not.toContain('glc_');
    expect(script).not.toContain('glsa_');
  });
});
