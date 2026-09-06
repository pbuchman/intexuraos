#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTIONS = {
  sessions: 'intex_agent_sessions',
  events: 'intex_agent_session_events',
  promptPreferences: 'intex_agent_prompt_preferences',
  promptPreferenceVersions: 'intex_agent_prompt_preference_versions',
};

const TEST_USER_PATTERN = /^test-intex-agent-[a-z0-9._-]{1,96}$/u;
const RUN_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;

export function parseArgs(argv) {
  const parsed = {
    userId: '',
    runId: '',
    execute: false,
    dryRun: true,
    credentialsPath:
      process.env.GOOGLE_APPLICATION_CREDENTIALS ??
      resolve(homedir(), '.config/gcloud/sa-key.json'),
    projectId: process.env.INTEXURAOS_GCP_PROJECT_ID ?? 'intexuraos-dev-pbuchman',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--user-id' && next !== undefined) {
      parsed.userId = next;
      index += 1;
    } else if (arg === '--run-id' && next !== undefined) {
      parsed.runId = next;
      index += 1;
    } else if (arg === '--credentials' && next !== undefined) {
      parsed.credentialsPath = next;
      index += 1;
    } else if (arg === '--project-id' && next !== undefined) {
      parsed.projectId = next;
      index += 1;
    } else if (arg === '--execute') {
      parsed.execute = true;
      parsed.dryRun = false;
    } else if (arg === '--dry-run') {
      parsed.execute = false;
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${String(arg)}`);
    }
  }

  return parsed;
}

export function validateCleanupRequest(input) {
  const normalizedRunId = input.runId.trim().toLowerCase();
  if (!RUN_ID_PATTERN.test(normalizedRunId)) {
    throw new Error(
      'runId must be lowercase and contain only letters, numbers, dot, underscore, or dash'
    );
  }
  if (!TEST_USER_PATTERN.test(input.userId)) {
    throw new Error('user id is outside the allowed test-intex-agent namespace');
  }
  if (input.userId !== `test-intex-agent-${normalizedRunId}`) {
    throw new Error('user id must equal test-intex-agent-<runId>');
  }
  return { ...input, runId: normalizedRunId };
}

export function readServiceAccountInfo(credentialsPath) {
  if (!existsSync(credentialsPath)) {
    throw new Error(`Service account credentials file does not exist: ${credentialsPath}`);
  }
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  if (parsed.type !== 'service_account') {
    throw new Error('Firestore cleanup requires a service_account credential file');
  }
  return parsed;
}

const defaultOutput = {
  writeLine(line) {
    console.log(line);
  },
};

export async function runCleanup(rawInput, output = defaultOutput) {
  const input = validateCleanupRequest(rawInput);
  const serviceAccount = readServiceAccountInfo(input.credentialsPath);
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert(serviceAccount),
      projectId: input.projectId,
    });
  const firestore = getFirestore(app);

  const targets = await collectTargets(firestore, input.userId);
  const total = Object.values(targets).reduce((sum, docs) => sum + docs.length, 0);

  output.writeLine(
    JSON.stringify(
      {
        userId: input.userId,
        runId: input.runId,
        projectId: input.projectId,
        mode: input.execute ? 'execute' : 'dry-run',
        counts: Object.fromEntries(
          Object.entries(targets).map(([key, docs]) => [key, docs.length])
        ),
        total,
      },
      null,
      2
    )
  );

  if (!input.execute) {
    output.writeLine('Dry run only. Re-run with --execute to delete matching test documents.');
    return { deleted: 0, total };
  }

  for (const docs of Object.values(targets)) {
    await Promise.all(docs.map(async (doc) => await doc.ref.delete()));
  }
  output.writeLine(`Deleted ${String(total)} matching test documents.`);
  return { deleted: total, total };
}

async function collectTargets(firestore, userId) {
  const [sessions, events, versions, promptPreference] = await Promise.all([
    firestore.collection(COLLECTIONS.sessions).where('userId', '==', userId).get(),
    firestore.collection(COLLECTIONS.events).where('userId', '==', userId).get(),
    firestore.collection(COLLECTIONS.promptPreferenceVersions).where('userId', '==', userId).get(),
    firestore.collection(COLLECTIONS.promptPreferences).doc(userId).get(),
  ]);

  return {
    sessions: sessions.docs,
    events: events.docs,
    promptPreferences: promptPreference.exists ? [promptPreference] : [],
    promptPreferenceVersions: versions.docs,
  };
}

async function main() {
  try {
    await runCleanup(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
