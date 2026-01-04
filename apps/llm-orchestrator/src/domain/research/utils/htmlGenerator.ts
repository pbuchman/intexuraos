/**
 * Generate branded HTML from research markdown content.
 */
import { marked, Renderer } from 'marked';

export interface LlmResultInput {
  provider: string;
  model: string;
  result?: string;
  status: string;
}

export interface InputContextInput {
  content: string;
  label?: string;
}

export interface CoverImageInput {
  thumbnailUrl: string;
  fullSizeUrl: string;
  alt: string;
}

export interface HtmlGeneratorInput {
  title: string;
  synthesizedResult: string;
  shareUrl: string;
  sharedAt: string;
  staticAssetsUrl: string;
  llmResults?: LlmResultInput[];
  inputContexts?: InputContextInput[];
  coverImage?: CoverImageInput;
}

// Configure marked with custom link renderer for external links
const renderer = new Renderer();
renderer.link = ({ href, title, text }): string => {
  const titleAttr =
    title !== null && title !== undefined && title !== '' ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({
  renderer,
  gfm: true,
  breaks: true,
});

const PROSE_STYLES = `
  :root {
    --color-primary: #2563eb;
    --color-text: #1e293b;
    --color-text-muted: #64748b;
    --color-bg: #f8fafc;
    --color-border: #e2e8f0;
  }

  * { box-sizing: border-box; }

  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--color-bg);
    color: var(--color-text);
    line-height: 1.75;
    margin: 0;
    padding: 0;
  }

  .container {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 1.5rem;
    margin-bottom: 2rem;
    border-bottom: 1px solid var(--color-border);
  }

  header img {
    height: 32px;
    width: auto;
  }

  header span {
    font-weight: 600;
    color: var(--color-text);
    font-size: 1.125rem;
  }

  .meta {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  .cover-image {
    width: 100%;
    height: auto;
    border-radius: 0.5rem;
    margin-bottom: 2rem;
  }

  .prose h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    line-height: 1.25;
  }

  .prose h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 2rem 0 1rem 0;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem 0;
  }

  .prose p {
    margin: 1rem 0;
  }

  .prose ul, .prose ol {
    margin: 1rem 0;
    padding-left: 1.5rem;
  }

  .prose li {
    margin: 0.5rem 0;
  }

  .prose a {
    color: var(--color-primary);
    text-decoration: underline;
  }

  .prose a:hover {
    text-decoration: none;
  }

  .prose blockquote {
    border-left: 4px solid var(--color-primary);
    margin: 1.5rem 0;
    padding: 0.5rem 0 0.5rem 1rem;
    color: var(--color-text-muted);
    font-style: italic;
  }

  .prose code {
    background: #e2e8f0;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .prose pre {
    background: #1e293b;
    color: #e2e8f0;
    padding: 1rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin: 1.5rem 0;
  }

  .prose pre code {
    background: none;
    padding: 0;
    color: inherit;
  }

  .prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
  }

  .prose th, .prose td {
    border: 1px solid var(--color-border);
    padding: 0.75rem;
    text-align: left;
  }

  .prose th {
    background: #e2e8f0;
    font-weight: 600;
  }

  details {
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    margin: 1rem 0;
  }

  details summary {
    padding: 0.75rem 1rem;
    cursor: pointer;
    font-weight: 600;
    background: #f1f5f9;
    border-radius: 0.5rem;
    list-style: none;
  }

  details summary::-webkit-details-marker {
    display: none;
  }

  details summary::before {
    content: '\\25B6';
    display: inline-block;
    margin-right: 0.5rem;
    font-size: 0.75rem;
    transition: transform 0.2s;
  }

  details[open] summary::before {
    transform: rotate(90deg);
  }

  details[open] summary {
    border-bottom: 1px solid var(--color-border);
    border-radius: 0.5rem 0.5rem 0 0;
  }

  details .detail-content {
    padding: 1rem;
  }

  .provider-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    margin-left: 0.5rem;
    text-transform: capitalize;
  }

  .provider-google { background: #e8f5e9; color: #2e7d32; }
  .provider-openai { background: #e3f2fd; color: #1565c0; }
  .provider-anthropic { background: #fce4ec; color: #c62828; }

  footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.875rem;
    text-align: center;
  }

  footer a {
    color: var(--color-primary);
    text-decoration: none;
  }

  footer a:hover {
    text-decoration: underline;
  }

  @media (max-width: 640px) {
    .container {
      padding: 1rem;
    }

    .prose h1 {
      font-size: 1.5rem;
    }

    .prose h2 {
      font-size: 1.25rem;
    }
  }
`;

export function generateShareableHtml(input: HtmlGeneratorInput): string {
  const {
    title,
    synthesizedResult,
    shareUrl,
    sharedAt,
    staticAssetsUrl,
    llmResults,
    inputContexts,
    coverImage,
  } = input;

  const displayTitle = title !== '' ? title : 'Research Report';
  const formattedDate = new Date(sharedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const renderedMarkdown = marked.parse(synthesizedResult, { async: false });

  const ogImageMeta =
    coverImage !== undefined
      ? `<meta property="og:image" content="${escapeHtml(coverImage.thumbnailUrl)}">`
      : '';

  const coverImageHtml =
    coverImage !== undefined
      ? `<img class="cover-image" src="${escapeHtml(coverImage.fullSizeUrl)}" alt="${escapeHtml(coverImage.alt)}">`
      : '';

  const completedResults =
    llmResults?.filter(
      (r) => r.status === 'completed' && r.result !== undefined && r.result !== ''
    ) ?? [];

  const llmResultsHtml =
    completedResults.length > 0
      ? `
      <h2>Individual Provider Reports</h2>
      ${completedResults
        .map(
          (r) => `
        <details>
          <summary>
            ${escapeHtml(r.model)}
            <span class="provider-badge provider-${r.provider}">${r.provider}</span>
          </summary>
          <div class="detail-content prose">
            ${marked.parse(r.result ?? '', { async: false })}
          </div>
        </details>
      `
        )
        .join('')}
    `
      : '';

  const inputContextsHtml =
    inputContexts !== undefined && inputContexts.length > 0
      ? `
      <h2>Additional Context</h2>
      ${inputContexts
        .map(
          (ctx, i) => `
        <details>
          <summary>
            ${ctx.label !== undefined && ctx.label !== '' ? escapeHtml(ctx.label) : `Context ${String(i + 1)}`}
          </summary>
          <div class="detail-content prose">
            ${marked.parse(ctx.content, { async: false })}
          </div>
        </details>
      `
        )
        .join('')}
    `
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(displayTitle)} | IntexuraOS Research</title>

  <meta property="og:title" content="${escapeHtml(displayTitle)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(shareUrl)}">
  ${ogImageMeta}

  <link rel="icon" type="image/png" href="${staticAssetsUrl}/branding/exports/icon-dark.png">

  <style>${PROSE_STYLES}</style>
</head>
<body>
  <div class="container">
    <header>
      <img src="${staticAssetsUrl}/branding/exports/logo-primary-dark.png" alt="IntexuraOS">
      <span>IntexuraOS</span>
    </header>

    <main class="prose">
      <h1>${escapeHtml(displayTitle)}</h1>
      <p class="meta">Generated on ${formattedDate}</p>

      ${coverImageHtml}

      ${renderedMarkdown}

      ${llmResultsHtml}

      ${inputContextsHtml}
    </main>

    <footer>
      <p>Powered by <a href="https://intexuraos.cloud">IntexuraOS</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
