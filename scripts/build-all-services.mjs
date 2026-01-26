#!/usr/bin/env node
import { execSync } from 'child_process';

const services = [
  'api-docs-hub',
  'research-agent',
  'mobile-notifications-service',
  'notion-service',
  'user-service',
  'whatsapp-service',
];

for (const service of services) {
  console.log(`Building ${service}...`);
  execSync(`node scripts/build-service.mjs ${service}`, { stdio: 'inherit' });
}

console.log('All services built successfully!');
