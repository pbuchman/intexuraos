#!/usr/bin/env node

import { readFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [configPath, listenersPath, pm2Path, daemonPidValue] = process.argv.slice(2);
const daemonPid = Number(daemonPidValue);
const expectedUid = process.getuid?.();
if (!Number.isInteger(daemonPid) || daemonPid <= 0 || expectedUid === undefined) {
  fail('Dedicated PM2 daemon identity is unavailable');
}

function processIdentity(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const parent = /^PPid:\s+(\d+)$/mu.exec(status);
  const uid = /^Uid:\s+(\d+)\s+/mu.exec(status);
  if (parent === null || uid === null) fail(`Process identity is unavailable for pid ${pid}`);
  return { parentPid: Number(parent[1]), uid: Number(uid[1]) };
}

function isDescendantOf(pid, ancestorPid) {
  let cursor = pid;
  const visited = new Set();
  while (cursor > 0 && !visited.has(cursor)) {
    visited.add(cursor);
    const identity = processIdentity(cursor);
    if (identity.uid !== expectedUid) return false;
    if (cursor === ancestorPid) return true;
    cursor = identity.parentPid;
  }
  return false;
}

const daemon = processIdentity(daemonPid);
if (daemon.uid !== expectedUid) fail('Dedicated PM2 daemon runs under an unexpected uid');

const ports = new Set(
  JSON.parse(readFileSync(configPath, 'utf8')).apps.map((app) => Number(app.env.PORT))
);
const appPids = JSON.parse(readFileSync(pm2Path, 'utf8'))
  .map((app) => Number(app.pid))
  .filter((pid) => Number.isInteger(pid) && pid > 0);

for (const pid of appPids) {
  if (pid === daemonPid || !isDescendantOf(pid, daemonPid)) {
    fail(`PM2 app pid ${pid} is outside the dedicated daemon process tree`);
  }
}

for (const line of readFileSync(listenersPath, 'utf8').split('\n')) {
  if (line.trim() === '') continue;
  const fields = line.trim().split(/\s+/u);
  const portMatch = /:(\d+)$/u.exec(fields[3] ?? '');
  if (portMatch === null || !ports.has(Number(portMatch[1]))) continue;
  const listenerPids = [...line.matchAll(/pid=(\d+)/gu)].map((match) => Number(match[1]));
  if (
    listenerPids.length === 0 ||
    listenerPids.some((pid) => !appPids.some((appPid) => isDescendantOf(pid, appPid)))
  ) {
    fail(`Reserved port ${portMatch[1]} is owned outside the dedicated PM2 app tree`);
  }
}
