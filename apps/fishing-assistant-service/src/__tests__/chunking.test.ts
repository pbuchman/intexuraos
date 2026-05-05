import { describe, expect, it, vi } from 'vitest';
import { chunkPage } from '../domain/chunking/chunkPage.js';
import { classifyPage } from '../domain/chunking/classifyPage.js';
import { inferTitle } from '../domain/chunking/inferTitle.js';
import { normalizePageText } from '../domain/chunking/normalizePageText.js';
import { FISHING_CONTENT_TYPES } from '../domain/chunking/types.js';

describe('Fishing Assistant page chunking', () => {
  const recipeText = `Zanęta delikatna

Ta zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni.

Baza strukturalna i objętościowa z sygnałem żerowym.

 -300 g otrębów pszennych (napowietrzenie, pylenie, sygnał w toni)
• 150 g kukurydzy mielonej lub płatków kukurydzianych

Fermentacja i sygnał chemiczny:

* 50 ml wody z kiszenia ziarna
-1/2 łyżeczki drożdży aktywnych

Oleje i atraktory naturalne:

-kilka kropli fermentowanego czosnku lub 1 ząbek startego na papkę`;

  it('normalizes pasted page text without losing Polish characters, bullets, quantities, or units', () => {
    const normalized = normalizePageText(recipeText.replaceAll('\n', '\r\n'));

    expect(normalized).toContain('Zanęta delikatna');
    expect(normalized).toContain('- 300 g otrębów pszennych');
    expect(normalized).toContain('- 150 g kukurydzy mielonej');
    expect(normalized).toContain('- 1/2 łyżeczki drożdży aktywnych');
    expect(normalized).toContain('łyżeczki');
    expect(normalized).not.toContain('\r');
    expect(normalized).not.toMatch(/\n{3,}/);
  });

  it('infers the title from the first header-like line before using a title generator', async () => {
    const generator = vi.fn(async () => 'Generated title');

    const title = await inferTitle(recipeText, { generateTitle: generator });

    expect(title).toBe('Zanęta delikatna');
    expect(generator).not.toHaveBeenCalled();
  });

  it('falls back to an injected title generator when the pasted page has no header', async () => {
    const generator = vi.fn(async (content: string) => {
      expect(content).toContain('Ryby żerują ostrożnie');
      return 'Wiosenne żerowanie ryb';
    });

    const title = await inferTitle('Ryby żerują ostrożnie. Warto podać mało towaru.', {
      generateTitle: generator,
    });

    expect(title).toBe('Wiosenne żerowanie ryb');
    expect(generator).toHaveBeenCalledOnce();
  });

  it('uses an untitled fallback when no header or title generator exists', async () => {
    const title = await inferTitle('Ryby żerują ostrożnie. Warto podać mało towaru.');

    expect(title).toBe('Untitled fishing page');
  });

  it('rejects empty, bullet, and overlong lines as title headers', async () => {
    const title = await inferTitle(`\n- 300 g pieczywa\n${'długi tytuł '.repeat(20)}`, {
      generateTitle: async () => '',
    });

    expect(title).toBe('Untitled fishing page');
  });

  it('classifies broad fishing content types deterministically', () => {
    expect(FISHING_CONTENT_TYPES).toEqual([
      'recipe',
      'guide',
      'species',
      'theory',
      'additive',
      'qna',
      'other',
    ]);
    expect(classifyPage('Przepis: 300 g pieczywa, 50 ml melasy', 'Zanęta płociowa')).toBe('recipe');
    expect(classifyPage('Klej bentonit i atraktor czosnkowy do zanęty', 'Dodatki')).toBe('additive');
    expect(classifyPage('Leszcz żeruje przy dnie, płoć w toni', 'Gatunki ryb')).toBe('species');
    expect(classifyPage('Dlaczego ryby reagują na ciśnienie i temperaturę?', 'Teoria')).toBe('theory');
    expect(classifyPage('Jak nęcić wiosną? Odpowiedź: drobno i mało.', 'Pytania')).toBe('qna');
    expect(classifyPage('Najpierw gruntowanie, potem podanie małej porcji', 'Poradnik')).toBe('guide');
    expect(classifyPage('Luźne notatki z rozmowy', 'Notatka')).toBe('other');
  });

  it('splits chunks on headings and prepends folder, page, and heading context to searchable text', async () => {
    const result = await chunkPage({
      rawText: recipeText,
      folderPath: ['Kurs', 'Zanęty'],
    });

    expect(result.title).toBe('Zanęta delikatna');
    expect(result.normalizedText).toContain('- 300 g otrębów pszennych');
    expect(result.contentType).toBe('recipe');
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    expect(result.chunks.map((chunk) => chunk.heading)).toEqual([
      'Baza strukturalna i objętościowa z sygnałem żerowym.',
      'Fermentacja i sygnał chemiczny:',
      'Oleje i atraktory naturalne:',
    ]);
    expect(result.chunks[0]?.searchableText).toContain('Folder: Kurs > Zanęty');
    expect(result.chunks[0]?.searchableText).toContain('Page: Zanęta delikatna');
    expect(result.chunks[0]?.searchableText).toContain(
      'Heading: Baza strukturalna i objętościowa z sygnałem żerowym.'
    );
  });

  it('creates size-bounded chunks with sentence overlap for long sections', async () => {
    const paragraph = 'Wiosną ryby pobierają pokarm ostrożnie i dobrze reagują na drobną zanętę. ';
    const longText = `Wiosenne nęcenie

Taktyka:

${paragraph.repeat(80)}`;

    const result = await chunkPage({ rawText: longText, folderPath: ['Taktyka'] });

    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1600);
      expect(chunk.searchableText).toContain('Folder: Taktyka');
      expect(chunk.searchableText).toContain('Page: Wiosenne nęcenie');
      expect(chunk.heading).toBe('Taktyka:');
    }
    expect(result.chunks[1]?.text.startsWith('Wiosną ryby pobierają pokarm ostrożnie')).toBe(true);
  });

  it('chunks unheaded generated-title pages and uses the intro text as fallback content', async () => {
    const result = await chunkPage({
      rawText: 'Ryby żerują ostrożnie. Warto podać mało towaru.',
      titleInference: {
        generateTitle: async () => 'Ostrożne żerowanie',
      },
    });

    expect(result.title).toBe('Ostrożne żerowanie');
    expect(result.chunks).toEqual([
      expect.objectContaining({
        heading: null,
        text: 'Ryby żerują ostrożnie. Warto podać mało towaru.',
      }),
    ]);
  });

  it('uses newline, space, and hard boundaries when no sentence boundary is available', async () => {
    const newlineText = `Podział po nowych liniach

Sekcja:

${'zaneta '.repeat(150)}
${'glina '.repeat(160)}`;
    const spaceText = `Podział po spacjach

Sekcja:

${'wiosna '.repeat(300)}`;
    const hardText = `Podział twardy

Sekcja:

${'a'.repeat(1900)}`;

    const newlineResult = await chunkPage({ rawText: newlineText });
    const spaceResult = await chunkPage({ rawText: spaceText });
    const hardResult = await chunkPage({ rawText: hardText });

    expect(newlineResult.chunks.length).toBeGreaterThan(1);
    expect(spaceResult.chunks.length).toBeGreaterThan(1);
    expect(hardResult.chunks.length).toBeGreaterThan(1);
    expect(Math.max(...hardResult.chunks.map((chunk) => chunk.text.length))).toBeLessThanOrEqual(1600);
  });
});
