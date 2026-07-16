import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IntexEvalScenarioSchema, type IntexEvalScenario } from './scenarioSchema.js';

interface ParsedScenarioFile {
  filename: string;
  scenario: IntexEvalScenario;
}

function formatSchemaIssues(
  issues: readonly { path: (string | number)[]; message: string }[]
): string {
  return issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
}

async function parseScenarioFile(
  directoryPath: string,
  filename: string
): Promise<ParsedScenarioFile> {
  const content = await readFile(join(directoryPath, filename), 'utf8');
  let rawScenario: unknown;
  try {
    rawScenario = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in "${filename}"`, { cause: error });
  }

  const parsed = IntexEvalScenarioSchema.safeParse(rawScenario);
  if (!parsed.success) {
    throw new Error(`Invalid scenario "${filename}": ${formatSchemaIssues(parsed.error.issues)}`);
  }

  return { filename, scenario: parsed.data };
}

export async function loadScenarioCatalog(directoryPath: string): Promise<IntexEvalScenario[]> {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const filenames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.scenario.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const parsedFiles = await Promise.all(
    filenames.map((filename) => parseScenarioFile(directoryPath, filename))
  );

  const seenIds = new Set<string>();
  for (const parsedFile of parsedFiles) {
    if (seenIds.has(parsedFile.scenario.id)) {
      throw new Error(`Duplicate scenario id "${parsedFile.scenario.id}"`);
    }
    seenIds.add(parsedFile.scenario.id);
  }

  for (const parsedFile of parsedFiles) {
    const expectedFilename = `${parsedFile.scenario.id}.scenario.json`;
    if (parsedFile.filename !== expectedFilename) {
      throw new Error(`Scenario "${parsedFile.scenario.id}" must be named "${expectedFilename}"`);
    }
  }

  return parsedFiles.map((parsedFile) => parsedFile.scenario);
}
