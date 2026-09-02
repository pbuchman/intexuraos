// Usage: node scripts/agent-tools/fetch-intex-session.cjs <sessionId> [--events] [--events-only]
// Must run from monorepo root for firebase-admin module resolution.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const admin = require('firebase-admin');

const INTEX_AGENT_SESSIONS_COLLECTION = 'intex_agent_sessions';

const EVENT_TYPE_ORDER = {
  session_started: 0,
  user_message: 10,
  confirmation_requested: 20,
  confirmation_resolved: 20,
  tool_call_started: 20,
  tool_call_completed: 30,
  tool_call_failed: 30,
  agent_fallback: 39,
  unsupported_request: 40,
  clarification_requested: 40,
  assistant_message: 50,
  session_closed: 90,
};

const SENSITIVE_KEYS = new Set([
  'displayText',
  'message',
  'messageId',
  'phoneNumber',
  'phone_number',
  'prompt',
  'reply',
  'replyContext',
  'replyToMessageId',
  'replyToWamid',
  'sourceUrl',
  'summary',
  'text',
  'title',
  'toolArgs',
  'url',
  'userId',
  'waId',
  'wamid',
]);

const ALLOWED_PAYLOAD_STRING_KEYS = new Set([
  'buttonId',
  'confirmationId',
  'error',
  'reason',
  'resolution',
  'sourceType',
  'status',
  'toolName',
]);

async function main(argv = process.argv) {
  const sessionInput = argv[2];
  const wantEvents = argv.includes('--events') || argv.includes('--events-only');
  const eventsOnly = argv.includes('--events-only');

  if (!sessionInput) {
    console.error('Usage: node fetch-session.cjs <sessionId> [--events] [--events-only]');
    process.exit(1);
  }

  const sessionId = extractSessionId(sessionInput);
  if (!sessionId.startsWith('intex_session_')) {
    console.error('Expected session id starting with intex_session_: ' + sessionId);
    process.exit(1);
  }

  const credentialPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(os.homedir(), '.config/gcloud/sa-key.json');
  const serviceAccount = readServiceAccount(credentialPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.INTEXURAOS_GCP_PROJECT_ID || serviceAccount.project_id,
  });

  const db = admin.firestore();
  let session = null;

  if (!eventsOnly) {
    const snap = await db.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(sessionId).get();
    if (!snap.exists) {
      console.error('Session not found: ' + sessionId);
      process.exit(1);
    }

    session = withId(snap.id, snap.data());
    console.log(JSON.stringify(sanitizeSession(session), null, 2));
  } else {
    // Still read the parent session so event output can be filtered by the session owner.
    const snap = await db.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(sessionId).get();
    if (!snap.exists) {
      console.error('Session not found: ' + sessionId);
      process.exit(1);
    }
    session = withId(snap.id, snap.data());
  }

  if (wantEvents) {
    if (!eventsOnly) console.log('\n--- SESSION EVENTS ---\n');
    const eventSnap = await db
      .collection('intex_agent_session_events')
      .where('sessionId', '==', sessionId)
      .get();
    const events = eventSnap.docs
      .map((doc) => withId(doc.id, doc.data()))
      .filter((event) => event.userId === session.userId)
      .sort(compareEvents)
      .map(sanitizeEvent);

    console.log('Total events: ' + events.length);
    console.log(JSON.stringify(events, null, 2));
  }

  process.exit(0);
}

function extractSessionId(input) {
  const decoded = decodeURIComponent(String(input).trim());
  const queryMatch = /[?&]session=(intex_session_[A-Za-z0-9_-]+)/u.exec(decoded);
  if (queryMatch !== null && queryMatch[1] !== undefined) return queryMatch[1];
  const pathMatch = /\/sessions\/(intex_session_[A-Za-z0-9_-]+)/u.exec(decoded);
  if (pathMatch !== null && pathMatch[1] !== undefined) return pathMatch[1];
  return decoded;
}

function readServiceAccount(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error('Could not read service-account key at ' + filePath + ': ' + error.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Service-account key is not valid JSON: ' + error.message);
    process.exit(1);
  }

  if (parsed.type !== 'service_account') {
    console.error('Firestore access must use a service_account key.');
    process.exit(1);
  }

  return parsed;
}

function withId(id, data) {
  return { id, ...normalizeFirestoreValue(data) };
}

function sanitizeSession(session) {
  return sanitizeValue(session, []);
}

function sanitizeEvent(event) {
  return sanitizeValue(event, []);
}

function sanitizeValue(value, pathParts) {
  const key = pathParts[pathParts.length - 1] || '';

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (shouldRedactString(key, pathParts)) return redactString(value);
    return scrubSensitiveInline(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, pathParts.concat(String(index))));
  }
  if (typeof value === 'object') {
    const normalized = normalizeFirestoreValue(value);
    if (normalized !== value) return sanitizeValue(normalized, pathParts);

    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitizeValue(childValue, pathParts.concat(childKey));
    }
    return output;
  }
  return value;
}

function shouldRedactString(key, pathParts) {
  if (SENSITIVE_KEYS.has(key)) return true;
  if (pathParts.includes('toolArgs')) return true;
  if (pathParts.includes('result')) return true;
  if (pathParts.includes('payload') && !ALLOWED_PAYLOAD_STRING_KEYS.has(key)) return true;
  return false;
}

function redactString(value) {
  return {
    redacted: true,
    len: value.length,
    sha256_12: crypto.createHash('sha256').update(value).digest('hex').slice(0, 12),
  };
}

function scrubSensitiveInline(value) {
  return (
    value
      // Intentionally broad: session dumps are diagnostic, so false-positive masking is safer than leaking phone numbers.
      .replace(/\+?\d[\d ()-]{8,}\d/gu, '[redacted-phone]')
      .replace(/(ya29|xox[baprs]|sk-[A-Za-z0-9_-]{12,})[A-Za-z0-9._-]*/gu, '[redacted-token]')
  );
}

function normalizeFirestoreValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (
    typeof value === 'object' &&
    typeof value._seconds === 'number' &&
    typeof value._nanoseconds === 'number'
  ) {
    return new Date(value._seconds * 1000 + Math.floor(value._nanoseconds / 1000000)).toISOString();
  }
  return value;
}

function compareEvents(a, b) {
  const timeDiff = timestampMs(a.createdAt) - timestampMs(b.createdAt);
  if (timeDiff !== 0) return timeDiff;

  const typeDiff = eventOrder(a.type) - eventOrder(b.type);
  if (typeDiff !== 0) return typeDiff;

  return String(a.id).localeCompare(String(b.id));
}

function timestampMs(value) {
  const normalized = normalizeFirestoreValue(value);
  if (typeof normalized !== 'string') return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventOrder(type) {
  return EVENT_TYPE_ORDER[type] ?? 999;
}

module.exports = {
  __testables: {
    compareEvents,
    extractSessionId,
    normalizeFirestoreValue,
    redactString,
    sanitizeEvent,
    sanitizeSession,
    scrubSensitiveInline,
    shouldRedactString,
    timestampMs,
  },
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
