#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const dashboardPath = resolve(repoRoot, 'infra/grafana/dashboards/intexuraos-pm2-logs.json');
const grafanaUrl = process.env.INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL;
const grafanaToken = process.env.INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN;
const lokiPushUrl = process.env.INTEXURAOS_GRAFANA_CLOUD_LOKI_URL;
const folderUid = process.env.INTEXURAOS_GRAFANA_FOLDER_UID ?? 'intexuraos';
const folderTitle = process.env.INTEXURAOS_GRAFANA_FOLDER_TITLE ?? 'IntexuraOS';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!grafanaUrl) {
  fail('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL is required');
}
if (!grafanaToken) {
  fail('INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN is required');
}

function apiUrl(path) {
  return `${grafanaUrl.replace(/\/$/, '')}${path}`;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${grafanaToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function ensureFolder() {
  const response = await fetch(apiUrl(`/api/folders/${folderUid}`), {
    headers: {
      Authorization: `Bearer ${grafanaToken}`,
    },
  });

  if (response.status === 200) {
    return response.json();
  }
  if (response.status !== 404) {
    const body = await response.text();
    throw new Error(`GET /api/folders/${folderUid} failed: ${response.status} ${body}`);
  }

  return apiFetch('/api/folders', {
    method: 'POST',
    body: JSON.stringify({
      uid: folderUid,
      title: folderTitle,
    }),
  });
}

async function findLokiDatasourceUid() {
  const datasources = await apiFetch('/api/datasources');
  const lokiDatasources = datasources.filter(
    (datasource) => datasource.type === 'loki' && datasource.uid
  );
  const hostedLokiBaseUrl = normalizeLokiBaseUrl(lokiPushUrl);
  const loki =
    lokiDatasources.find(
      (datasource) =>
        hostedLokiBaseUrl !== '' && normalizeDatasourceUrl(datasource.url) === hostedLokiBaseUrl
    ) ?? lokiDatasources.find((datasource) => isHostedLogsDatasource(datasource));

  if (!loki) {
    fail('No hosted Loki logs datasource found in Grafana Cloud stack');
  }

  return loki.uid;
}

function normalizeLokiBaseUrl(value) {
  return normalizeDatasourceUrl(value).replace(/\/loki\/api\/v1\/push$/, '');
}

function normalizeDatasourceUrl(value) {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  return value.replace(/\/$/, '');
}

function isHostedLogsDatasource(datasource) {
  const name = String(datasource.name ?? '').toLowerCase();
  const uid = String(datasource.uid ?? '').toLowerCase();
  const isGrafanaInternalLoki =
    name.includes('alert-state-history') ||
    uid.includes('alert-state-history') ||
    name.includes('usage-insights') ||
    uid.includes('usage-insights');

  return !isGrafanaInternalLoki && (name.endsWith('-logs') || uid.endsWith('-logs'));
}

function loadDashboard(lokiDatasourceUid) {
  const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8'));
  return JSON.parse(
    JSON.stringify(dashboard).replaceAll('__LOKI_DATASOURCE_UID__', lokiDatasourceUid)
  );
}

const folder = await ensureFolder();
const lokiDatasourceUid = await findLokiDatasourceUid();
const dashboard = loadDashboard(lokiDatasourceUid);
const result = await apiFetch('/api/dashboards/db', {
  method: 'POST',
  body: JSON.stringify({
    dashboard,
    folderUid,
    overwrite: true,
    message: 'Provision IntexuraOS PM2 logs dashboard',
  }),
});

const dashboardUrl = result.url ? apiUrl(result.url) : apiUrl(`/d/${dashboard.uid}`);
console.log(`Provisioned ${dashboard.title} in ${folder.title}: ${dashboardUrl}`);
