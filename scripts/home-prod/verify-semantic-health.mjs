import { readFileSync } from 'node:fs';

function reject(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

const expectedServiceName = process.argv[2];
const requiredCheckName = process.argv[3];

let body;
try {
  body = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  reject('HEALTH_JSON_INVALID');
}

if (body === null || typeof body !== 'object' || Array.isArray(body)) {
  reject('HEALTH_JSON_INVALID');
}
if (body.status !== 'ok') reject('HEALTH_STATUS_INVALID');
if (typeof body.serviceName !== 'string' || body.serviceName.trim() === '') {
  reject('HEALTH_SERVICE_INVALID');
}
if (expectedServiceName !== undefined && body.serviceName !== expectedServiceName) {
  reject('HEALTH_SERVICE_MISMATCH');
}
if (!Array.isArray(body.checks)) reject('HEALTH_CHECKS_INVALID');

for (const check of body.checks) {
  if (
    check === null ||
    typeof check !== 'object' ||
    Array.isArray(check) ||
    typeof check.name !== 'string' ||
    check.name.trim() === '' ||
    check.status !== 'ok'
  ) {
    reject('HEALTH_CHECK_INVALID');
  }
}

if (
  requiredCheckName !== undefined &&
  !body.checks.some((check) => check.name === requiredCheckName)
) {
  reject('HEALTH_REQUIRED_CHECK_MISSING');
}
