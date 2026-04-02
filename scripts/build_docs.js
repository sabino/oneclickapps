/*jshint esversion: 6 */
const path = require('path');
const fs = require('fs-extra');

const pathOfDocs = path.join(__dirname, '..', 'docs');
const pathOfDist = path.join(__dirname, '..', 'dist');
const pathOfDistDocs = path.join(pathOfDist, 'docs');

const SITE_TITLE = 'Sabino One-Click Apps';
const BRAND_ICON = 'assets/caprover-green.svg';

function escapeHtml(value) {
    return `${value}`
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function titleFromSlug(slug) {
    return slug
        .split('-')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function renderInlineMarkdown(text) {
    return escapeHtml(text)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listType = null;
    let inCodeBlock = false;
    let codeLines = [];

    function flushParagraph() {
        if (!paragraph.length) {
            return;
        }
        html.push(`<p>${paragraph.join(' ')}</p>`);
        paragraph = [];
    }

    function flushList() {
        if (!listType) {
            return;
        }
        html.push(`</${listType}>`);
        listType = null;
    }

    function flushCodeBlock() {
        if (!inCodeBlock) {
            return;
        }
        html.push(
            `<div class="code-block"><button class="copy-code-button" type="button" data-copy-code>Copy</button><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`
        );
        inCodeBlock = false;
        codeLines = [];
    }

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();

        if (rawLine.startsWith('```')) {
            flushParagraph();
            flushList();
            if (inCodeBlock) {
                flushCodeBlock();
            } else {
                inCodeBlock = true;
                codeLines = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(rawLine);
            continue;
        }

        if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }

        const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (ordered) {
            flushParagraph();
            if (listType !== 'ol') {
                flushList();
                listType = 'ol';
                html.push('<ol>');
            }
            html.push(`<li>${renderInlineMarkdown(ordered[2])}</li>`);
            continue;
        }

        const bullet = trimmed.match(/^-\s+(.*)$/);
        if (bullet) {
            flushParagraph();
            if (listType !== 'ul') {
                flushList();
                listType = 'ul';
                html.push('<ul>');
            }
            html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
            continue;
        }

        flushList();
        paragraph.push(renderInlineMarkdown(trimmed));
    }

    flushParagraph();
    flushList();
    flushCodeBlock();

    return html.join('\n');
}

function parseDoc(pathOfFile) {
    const slug = path.basename(pathOfFile, '.md');
    const markdown = fs.readFileSync(pathOfFile, 'utf-8');
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const firstHeading = lines.find(line => /^#\s+/.test(line));
    const title = firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : titleFromSlug(slug);

    let summary = '';
    let paragraph = [];
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            if (paragraph.length) {
                summary = paragraph.join(' ');
                break;
            }
            continue;
        }
        if (/^#/.test(trimmed) || /^```/.test(trimmed) || /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
            if (paragraph.length) {
                summary = paragraph.join(' ');
                break;
            }
            continue;
        }
        paragraph.push(trimmed);
    }
    if (!summary && paragraph.length) {
        summary = paragraph.join(' ');
    }

    return {
        slug,
        title,
        summary,
        markdown,
        html: renderMarkdown(markdown),
    };
}

function layoutCss() {
    return `
      :root {
        --page-bg: #0b1017;
        --surface: #121926;
        --surface-soft: #1a2231;
        --text: #ecf3fb;
        --muted: #b2c0d1;
        --muted-soft: #7f90a8;
        --border: rgba(148, 163, 184, 0.18);
        --accent: #16c47f;
        --accent-soft: rgba(22, 196, 127, 0.16);
        --shadow: 0 18px 48px rgba(2, 6, 23, 0.35);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: var(--page-bg);
        color: var(--text);
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code, pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      header {
        background: rgba(11, 16, 23, 0.92);
        border-bottom: 1px solid var(--border);
        backdrop-filter: blur(14px);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .container {
        width: min(1240px, calc(100vw - 32px));
        margin: 0 auto;
      }
      .navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        min-height: 72px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text);
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .brand-mark {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        display: inline-grid;
        place-items: center;
        background: linear-gradient(135deg, var(--accent-soft), rgba(255, 255, 255, 0.02) 85%);
        border: 1px solid var(--border);
        padding: 7px;
      }
      .brand-mark img {
        width: 100%;
        height: 100%;
        display: block;
      }
      .header-links {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        align-items: center;
      }
      .header-links a {
        color: var(--muted);
        font-size: 0.95rem;
      }
      main {
        padding: 28px 0 64px;
      }
      .eyebrow {
        color: var(--muted-soft);
        font-size: 0.88rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 600;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.8rem, 3vw, 2.4rem);
        line-height: 1.08;
        letter-spacing: -0.03em;
      }
      .hero {
        display: grid;
        gap: 10px;
        margin-bottom: 24px;
      }
      .hero p {
        margin: 0;
        max-width: 860px;
        color: var(--muted);
        line-height: 1.65;
        font-size: 0.98rem;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }
      .panel-inner {
        padding: 24px;
      }
      .docs-grid {
        display: grid;
        gap: 16px;
      }
      .doc-card {
        display: grid;
        gap: 10px;
        padding: 22px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--surface);
        box-shadow: var(--shadow);
      }
      .doc-card h2 {
        margin: 0;
        font-size: 1.22rem;
        letter-spacing: -0.02em;
      }
      .doc-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }
      .doc-meta {
        color: var(--muted-soft);
        font-size: 0.9rem;
      }
      .content {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow);
      }
      .content-inner {
        padding: 28px;
      }
      .content-inner h1,
      .content-inner h2,
      .content-inner h3 {
        color: var(--text);
        letter-spacing: -0.03em;
      }
      .content-inner h1 { font-size: 1.9rem; margin: 0 0 18px; }
      .content-inner h2 { font-size: 1.18rem; margin: 28px 0 12px; }
      .content-inner h3 { font-size: 1rem; margin: 22px 0 10px; }
      .content-inner p,
      .content-inner ul,
      .content-inner ol {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.75;
      }
      .content-inner ul,
      .content-inner ol {
        padding-left: 24px;
      }
      .content-inner pre {
        margin: 0 0 16px;
        overflow: auto;
        padding: 52px 16px 16px;
        border-radius: 14px;
        background: #0d1521;
        border: 1px solid var(--border);
        color: var(--text);
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.36) transparent;
      }
      .content-inner pre::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .content-inner pre::-webkit-scrollbar-track {
        background: transparent;
      }
      .content-inner pre::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.28);
        border-radius: 999px;
      }
      .content-inner pre code {
        display: block;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .code-block {
        position: relative;
        margin-bottom: 16px;
      }
      .copy-code-button {
        position: absolute;
        top: 12px;
        right: 12px;
        border: 1px solid rgba(22, 196, 127, 0.35);
        background: rgba(22, 196, 127, 0.12);
        color: var(--accent);
        border-radius: 10px;
        padding: 8px 12px;
        font: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        z-index: 1;
      }
      .copy-code-button:hover {
        filter: brightness(1.06);
      }
      .copy-code-button.copied {
        color: var(--text);
        background: rgba(22, 196, 127, 0.22);
      }
      .breadcrumbs {
        margin: 0 0 18px;
        color: var(--muted-soft);
        font-size: 0.93rem;
      }
      footer {
        border-top: 1px solid var(--border);
        color: var(--muted-soft);
        background: var(--surface);
      }
      footer .container { padding: 20px 0; }
      @media (max-width: 720px) {
        .container { width: min(100vw - 20px, 1080px); }
        .navbar {
          padding: 12px 0;
          align-items: flex-start;
          flex-direction: column;
        }
      }
    `;
}

function pageShell(options) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(options.description)}" />
    <link rel="icon" type="image/svg+xml" href="${options.assetPrefix}${BRAND_ICON}" />
    <style>${layoutCss()}</style>
  </head>
  <body>
    <header>
      <div class="container navbar">
        <a class="brand" href="${options.homeHref}">
          <span class="brand-mark"><img src="${options.assetPrefix}${BRAND_ICON}" alt="" /></span>
          <span>${SITE_TITLE}</span>
        </a>
        <nav class="header-links" aria-label="Site links">
          <a href="${options.docsHref}">Docs</a>
          <a href="https://github.com/sabino/oneclickapps">GitHub</a>
          <a href="https://caprover.com/">CapRover</a>
        </nav>
      </div>
    </header>
    <main class="container">${options.body}</main>
    <footer>
      <div class="container">Built for CapRover third-party repositories.</div>
    </footer>
    <script>
      async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }

        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        document.body.appendChild(input);
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        return copied;
      }

      document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy-code]');
        if (!button) {
          return;
        }

        const pre = button.parentElement.querySelector('pre');
        if (!pre) {
          return;
        }

        const originalText = button.textContent;
        try {
          await copyText(pre.innerText.replace(/\\n$/, ''));
          button.textContent = 'Copied';
          button.classList.add('copied');
        } catch (error) {
          console.error(error);
          button.textContent = 'Copy failed';
        }

        window.setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove('copied');
        }, 1800);
      });
    </script>
  </body>
</html>`;
}

function buildDocsIndex(documents) {
    const cards = documents.map(doc => `
      <a class="doc-card" href="./${doc.slug}/">
        <div class="doc-meta">Documentation</div>
        <h2>${escapeHtml(doc.title)}</h2>
        <p>${escapeHtml(doc.summary || 'Open the guide for more details.')}</p>
      </a>
    `).join('\n');

    return pageShell({
        title: `${SITE_TITLE} Docs`,
        description: 'Operational guides for Sabino One-Click Apps.',
        assetPrefix: '../',
        homeHref: '../',
        docsHref: './',
        body: `
          <section class="hero">
            <div class="eyebrow">Documentation</div>
            <h1>Docs</h1>
            <p>Operational guides and deployment notes for this catalog. These pages are generated from markdown files in the repository and published as standalone URLs.</p>
          </section>
          <section class="docs-grid">
            ${cards}
          </section>
        `,
    });
}

function buildDocPage(doc) {
    return pageShell({
        title: `${doc.title} · ${SITE_TITLE}`,
        description: doc.summary || `Documentation for ${doc.title}.`,
        assetPrefix: '../../',
        homeHref: '../../',
        docsHref: '../',
        body: `
          <div class="breadcrumbs"><a href="../">Docs</a> / ${escapeHtml(doc.title)}</div>
          <article class="content">
            <div class="content-inner">
              ${doc.html}
            </div>
          </article>
        `,
    });
}

async function buildDocs() {
    if (!fs.existsSync(pathOfDocs)) {
        return;
    }

    const files = (await fs.readdir(pathOfDocs))
        .filter(name => name.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b));

    const docs = files.map(name => parseDoc(path.join(pathOfDocs, name)));

    await fs.ensureDir(pathOfDistDocs);
    await fs.writeFile(path.join(pathOfDistDocs, 'index.html'), buildDocsIndex(docs));

    for (const doc of docs) {
        const docDir = path.join(pathOfDistDocs, doc.slug);
        await fs.ensureDir(docDir);
        await fs.writeFile(path.join(docDir, 'index.html'), buildDocPage(doc));
    }
}

buildDocs().catch(err => {
    console.error(err);
    process.exit(127);
});
