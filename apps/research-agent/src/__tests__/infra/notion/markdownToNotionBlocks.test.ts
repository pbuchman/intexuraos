import { describe, expect, it } from 'vitest';
import { markdownToNotionBlocks } from '../../../infra/notion/markdownToNotionBlocks.js';

describe('markdownToNotionBlocks', () => {
  describe('headings', () => {
    it('converts h1 headings', () => {
      const blocks = markdownToNotionBlocks('# Hello World');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: 'Hello World' } }] },
      });
    });

    it('converts h2 headings', () => {
      const blocks = markdownToNotionBlocks('## Section Title');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Section Title' } }] },
      });
    });

    it('converts h3 headings', () => {
      const blocks = markdownToNotionBlocks('### Subsection');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: 'Subsection' } }] },
      });
    });
  });

  describe('paragraphs', () => {
    it('converts plain text to paragraphs', () => {
      const blocks = markdownToNotionBlocks('This is a paragraph.');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: 'This is a paragraph.' } }] },
      });
    });

    it('skips empty lines', () => {
      const blocks = markdownToNotionBlocks('Line 1\n\nLine 2');
      expect(blocks).toHaveLength(2);
    });
  });

  describe('inline formatting', () => {
    it('converts bold text with **', () => {
      const blocks = markdownToNotionBlocks('This is **bold** text');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: unknown[] } };
      expect(paragraph.paragraph.rich_text).toHaveLength(3);
      expect(paragraph.paragraph.rich_text[1]).toEqual({
        type: 'text',
        text: { content: 'bold' },
        annotations: { bold: true },
      });
    });

    it('converts italic text with *', () => {
      const blocks = markdownToNotionBlocks('This is *italic* text');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: unknown[] } };
      expect(paragraph.paragraph.rich_text[1]).toEqual({
        type: 'text',
        text: { content: 'italic' },
        annotations: { italic: true },
      });
    });

    it('converts inline code with backticks', () => {
      const blocks = markdownToNotionBlocks('Use `npm install`');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: unknown[] } };
      expect(paragraph.paragraph.rich_text[1]).toEqual({
        type: 'text',
        text: { content: 'npm install' },
        annotations: { code: true },
      });
    });

    it('converts links', () => {
      const blocks = markdownToNotionBlocks('Check [Google](https://google.com)');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: unknown[] } };
      expect(paragraph.paragraph.rich_text[1]).toEqual({
        type: 'text',
        text: { content: 'Google', link: { url: 'https://google.com' } },
      });
    });
  });

  describe('lists', () => {
    it('converts bulleted lists with -', () => {
      const blocks = markdownToNotionBlocks('- Item 1\n- Item 2');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'Item 1' } }] },
      });
    });

    it('converts bulleted lists with *', () => {
      const blocks = markdownToNotionBlocks('* Item A\n* Item B');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('bulleted_list_item');
    });

    it('converts numbered lists', () => {
      const blocks = markdownToNotionBlocks('1. First\n2. Second');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: 'First' } }] },
      });
    });
  });

  describe('tables', () => {
    it('converts markdown tables', () => {
      const markdown = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('table');

      const table = blocks[0] as { table: { table_width: number; children: unknown[] } };
      expect(table.table.table_width).toBe(2);
      expect(table.table.children).toHaveLength(3);
    });
  });

  describe('code blocks', () => {
    it('converts fenced code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: 'const x = 1;' } }],
          language: 'javascript',
        },
      });
    });

    it('defaults to plain text for unknown languages', () => {
      const markdown = '```unknownlang\ncode here\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('plain text');
    });
  });

  describe('mixed content', () => {
    it('handles complex markdown with multiple elements', () => {
      const markdown = `# Title

This is a paragraph with **bold** and *italic*.

## Section

- List item 1
- List item 2

| Col1 | Col2 |
| --- | --- |
| A | B |`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks.length).toBeGreaterThan(5);

      const types = blocks.map((b) => b.type);
      expect(types).toContain('heading_1');
      expect(types).toContain('heading_2');
      expect(types).toContain('paragraph');
      expect(types).toContain('bulleted_list_item');
      expect(types).toContain('table');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const blocks = markdownToNotionBlocks('');
      expect(blocks).toHaveLength(0);
    });

    it('handles whitespace-only input', () => {
      const blocks = markdownToNotionBlocks('   \n   \n   ');
      expect(blocks).toHaveLength(0);
    });

    it('splits long text into multiple paragraphs', () => {
      const longText = 'A'.repeat(4000);
      const blocks = markdownToNotionBlocks(longText);
      expect(blocks.length).toBeGreaterThan(1);
    });
  });
});
