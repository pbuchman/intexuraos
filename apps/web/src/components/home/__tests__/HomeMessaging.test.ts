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

    expect(showcase).toContain('ver. 3.8.0');
    expect(showcase).toContain('Research draft ready');
    expect(showcase).toContain('Calendar event created');
    expect(showcase).toContain('Bookmark summarized');
    expect(showcase).not.toContain('ver. 3.3.0');
    expect(showcase).not.toContain('Checklists');
  });

  it('adds an agentic patterns section to the homepage flow', () => {
    const sectionPath = resolve(__dirname, '..', 'AgentPatternsSection.tsx');
    const section = readFileSync(sectionPath, 'utf-8');
    const homePage = readFileSync(resolve(__dirname, '../../../pages/HomePage.tsx'), 'utf-8');

    expect(existsSync(sectionPath)).toBe(true);
    expect(homePage).toContain('AgentPatternsSection');
    expect(section).toContain('Direct-tool action agent');
    expect(section).toContain('Citation-validated RAG');
    expect(section).toContain('Autonomous code execution');
    expect(section).toContain('safe specialists');
    expect(section).toContain('Agentic Patterns In Production');
  });

  it('uses precise claims for code execution, research, and engineering proof', () => {
    const voice = readHomeFile('VoiceSection.tsx');
    const selfBuilding = readHomeFile('SelfBuildingSection.tsx');
    const council = readHomeFile('CouncilSection.tsx');
    const engineering = readHomeFile('EngineeringSection.tsx');
    const about = readHomeFile('AboutSection.tsx');

    expect(voice).toContain('Direct-Tool Intelligence');
    expect(voice).toContain('Safe action out');
    expect(voice).toContain('Unsupported requests get a clear response');
    expect(voice).not.toContain('Text-First Intelligence');

    expect(selfBuilding).toContain('independent verification');
    expect(selfBuilding).not.toContain('Cursor and Copilot send your code to the cloud');

    expect(council).toContain('multi-model research council');
    expect(council).toContain('OPENROUTER');
    expect(council).toContain('OpenRouter-routed models');
    expect(council).not.toContain("name: 'GOOGLE'");
    expect(council).not.toContain('You get the truth');

    expect(engineering).toContain('prompt versioning');
    expect(engineering).toContain('service ownership');
    expect(engineering).toContain('cross-LLM verification');

    expect(about).toContain('agents as infrastructure, not demos');
    expect(about).toContain('safe specialist agents');
    expect(about).not.toContain('refuses to accept');
  });
});
