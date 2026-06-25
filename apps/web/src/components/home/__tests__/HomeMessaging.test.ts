/**
 * @vitest-environment node
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readHomeFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
}

describe('homepage showcase messaging', () => {
  it('positions IntexuraOS as a personal agentic operating system', () => {
    const hero = readHomeFile('HeroSection.tsx');

    expect(hero).toContain('personal agentic operating system');
    expect(hero).toContain('specialist agents');
    expect(hero).toContain('deterministic software boundaries');
  });

  it('keeps the hero product mock current and representative', () => {
    const showcase = readHomeFile('HeroShowcase.tsx');

    expect(showcase).toContain('ver. 3.7.0');
    expect(showcase).toContain('Research draft ready');
    expect(showcase).toContain('Calendar event created');
    expect(showcase).toContain('Bookmark summarized');
    expect(showcase).not.toContain('ver. 3.3.0');
    expect(showcase).not.toContain('Checklists');
  });

  it('adds an agentic patterns section to the homepage flow', () => {
    const sectionPath = resolve(__dirname, '..', 'AgentPatternsSection.tsx');
    const homePage = readFileSync(resolve(__dirname, '../../../pages/HomePage.tsx'), 'utf-8');

    expect(existsSync(sectionPath)).toBe(true);
    expect(homePage).toContain('AgentPatternsSection');
  });

  it('uses precise claims for code execution, research, and engineering proof', () => {
    const selfBuilding = readHomeFile('SelfBuildingSection.tsx');
    const council = readHomeFile('CouncilSection.tsx');
    const engineering = readHomeFile('EngineeringSection.tsx');

    expect(selfBuilding).toContain('independent verification');
    expect(selfBuilding).not.toContain('Cursor and Copilot send your code to the cloud');

    expect(council).toContain('multi-model research council');
    expect(council).not.toContain('You get the truth');

    expect(engineering).toContain('prompt versioning');
    expect(engineering).toContain('service ownership');
    expect(engineering).toContain('cross-LLM verification');
  });
});
