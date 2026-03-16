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

    it('converts inline code at start of line', () => {
      const blocks = markdownToNotionBlocks('`code` is here');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: unknown[] } };
      expect(paragraph.paragraph.rich_text[0]).toEqual({
        type: 'text',
        text: { content: 'code' },
        annotations: { code: true },
      });
    });

    it('handles standalone special characters', () => {
      const blocks = markdownToNotionBlocks('Use * for multiplication');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: { text: { content: string } }[] } };
      expect(paragraph.paragraph.rich_text.some((seg) => seg.text.content.includes('*'))).toBe(true);
    });

    it('handles lone special character at end of text', () => {
      const blocks = markdownToNotionBlocks('Hello *');
      expect(blocks).toHaveLength(1);
      const paragraph = blocks[0] as { paragraph: { rich_text: { type: string; text: { content: string } }[] } };
      expect(paragraph.paragraph.rich_text).toHaveLength(2);
      expect(paragraph.paragraph.rich_text[0]).toEqual({
        type: 'text',
        text: { content: 'Hello ' },
      });
      expect(paragraph.paragraph.rich_text[1]).toEqual({
        type: 'text',
        text: { content: '*' },
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

    it('converts tables without leading pipes', () => {
      const markdown = `Name | Age
--- | ---
Alice | 30`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('table');
    });

    it('normalizes rows with fewer columns', () => {
      const markdown = `| A | B | C |
| --- | --- | --- |
| 1 |
| 2 | 3 |`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);

      const table = blocks[0] as { table: { table_width: number; children: { table_row: { cells: unknown[] } }[] } };
      expect(table.table.table_width).toBe(3);
      expect(table.table.children[1]?.table_row.cells).toHaveLength(3);
      expect(table.table.children[2]?.table_row.cells).toHaveLength(3);
    });

    it('handles single column table', () => {
      const markdown = `| Header |
| --- |
| Value |`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('table');
    });

    it('handles table with only header (no data rows)', () => {
      const markdown = `| A | B |
| --- | --- |
next paragraph`;

      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('table');
      expect(blocks[1]?.type).toBe('paragraph');
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

    it('maps js alias to javascript', () => {
      const markdown = '```js\nlet x = 1;\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('javascript');
    });

    it('maps ts alias to typescript', () => {
      const markdown = '```ts\nlet x: number = 1;\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('typescript');
    });

    it('maps py alias to python', () => {
      const markdown = '```py\nx = 1\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('python');
    });

    it('maps sh alias to bash', () => {
      const markdown = '```sh\necho hello\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('bash');
    });

    it('maps shell alias to bash', () => {
      const markdown = '```shell\necho world\n```';
      const blocks = markdownToNotionBlocks(markdown);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('bash');
    });

    it('handles code block without closing fence', () => {
      const markdown = '```python\ndef foo():\n    pass';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      const code = blocks[0] as { code: { language: string; rich_text: { text: { content: string } }[] } };
      expect(code.code.language).toBe('python');
      expect(code.code.rich_text[0]?.text.content).toContain('def foo()');
    });

    it('handles code block with no language specified', () => {
      const markdown = '```\nplain code\n```';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      const code = blocks[0] as { code: { language: string } };
      expect(code.code.language).toBe('plain text');
    });
  });

  describe('image blocks', () => {
    it('parses image with alt text', () => {
      const blocks = markdownToNotionBlocks('![Alt text](https://example.com/image.png)');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url: 'https://example.com/image.png' },
          caption: [{ type: 'text', text: { content: 'Alt text' } }],
        },
      });
    });

    it('parses image without alt text', () => {
      const blocks = markdownToNotionBlocks('![](https://example.com/image.png)');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url: 'https://example.com/image.png' },
        },
      });
    });

    it('parses image surrounded by other content', () => {
      const markdown = 'Before\n![diagram](https://example.com/diagram.svg)\nAfter';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(3);
      expect(blocks[0]?.type).toBe('paragraph');
      expect(blocks[1]?.type).toBe('image');
      expect(blocks[2]?.type).toBe('paragraph');
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

    it('force splits long text without spaces', () => {
      const noSpaceText = 'X'.repeat(4000);
      const blocks = markdownToNotionBlocks(noSpaceText);
      expect(blocks.length).toBeGreaterThan(1);
      blocks.forEach((b) => {
        const para = b as { paragraph: { rich_text: { text: { content: string } }[] } };
        expect(para.paragraph.rich_text[0]?.text.content.length).toBeLessThanOrEqual(1900);
      });
    });

    it('splits at space when space is in latter half', () => {
      const textWithLateSpace = 'X'.repeat(1500) + ' ' + 'Y'.repeat(2500);
      const blocks = markdownToNotionBlocks(textWithLateSpace);
      expect(blocks.length).toBeGreaterThan(1);
      const firstPara = blocks[0] as { paragraph: { rich_text: { text: { content: string } }[] } };
      expect(firstPara.paragraph.rich_text[0]?.text.content).toContain('X');
    });

    it('handles line with pipe that is not a table', () => {
      const markdown = 'Use a | b for OR operation';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('paragraph');
    });

    it('handles multi-line pipe text that is not a table', () => {
      const markdown = 'First | line\nSecond line without proper separator';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('paragraph');
      expect(blocks[1]?.type).toBe('paragraph');
    });

    it('handles triple backticks that are not code blocks', () => {
      const markdown = '```\nunclosed';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(1);
    });

    it('treats invalid code fence as paragraph', () => {
      const markdown = '```invalid language here\nsome text';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('paragraph');
    });
  });
});
