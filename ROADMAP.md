# Roadmap

Planned work for Yaka|SEO, roughly in priority order. For what the app can't do today, see [Known limitations](README.md#known-limitations) in the README.

1. **Remaining Screaming Frog per-page fields.** The fields that come straight from the response and HTML are done (see "Data collected per URL" in the README). Still to do:
   - **JS-only outlinks** (unique internal and external): compare the raw HTML with the rendered DOM in JS mode.
   - **Redirect chains:** each hop as its own row with its 3xx status, as Screaming Frog reports them. Today a redirect is one row with `finalUrl`.
2. **Store crawls in SQLite** in the main process, with the UI fetching results a page at a time. Makes very large crawls possible and lets you save and reopen them.
3. **Link graph:** inlinks and outlinks per URL (total, unique and JS-only), `% of Total` inlink share, a PageRank-style link score, broken-link sources, redirect chains, orphan pages.
4. **Post-crawl analysis:** near-duplicate detection (minhash, 90% similarity threshold), spelling and grammar checks.
5. **More checks:** hreflang, structured data (JSON-LD), Open Graph and Twitter tags, duplicate titles and descriptions, sitemap.xml comparison, pagination.
6. **Crawl settings:** include/exclude patterns, subdomain scope, crawl delay.
7. **AI features (Claude API):** content audits, rewritten titles and meta descriptions, grouping pages by topic, semantic similarity between pages (embeddings) and a semantic relevance score that flags off-topic pages.
8. **Packaging** with electron-builder, including the Playwright browser.
