# Roadmap

Planned work for Yaka|SEO, roughly in priority order. For what the app can't do today, see [Known limitations](README.md#known-limitations) in the README.

1. **Screaming Frog field parity (per page).** Fields that come straight from the response or HTML we already parse:
   - **Response:** status text, `X-Robots-Tag`, `Last-Modified`, HTTP version, redirect URL and type (HTTP, meta refresh, JavaScript), cookies, crawl timestamp.
   - **Directives:** meta refresh, `rel="next"`/`"prev"` (HTML and HTTP `Link` header), `amphtml`, mobile alternate link.
   - **Content:** second H1 and first H2 text, meta keywords, `<html lang>`, URL-encoded address, folder depth.
   - **Size:** HTML size, transferred (compressed) bytes, total transferred including resources (JS rendering), CO2 estimate and carbon rating (Sustainable Web Design model).
   - **Quality:** text-to-HTML ratio, sentence count, average words per sentence, Flesch reading ease score and readability band, content hash (MD5) for exact duplicates.
   - **SERP pixel widths** for titles (truncated at about 580 px) and meta descriptions (about 920–990 px). This needs font measurement.
2. **Store crawls in SQLite** in the main process, with the UI fetching results a page at a time. Makes very large crawls possible and lets you save and reopen them.
3. **Link graph:** inlinks and outlinks per URL (total, unique and JS-only), `% of Total` inlink share, a PageRank-style link score, broken-link sources, redirect chains, orphan pages.
4. **Post-crawl analysis:** near-duplicate detection (minhash, 90% similarity threshold), spelling and grammar checks.
5. **More checks:** hreflang, structured data (JSON-LD), Open Graph and Twitter tags, duplicate titles and descriptions, sitemap.xml comparison, pagination.
6. **Crawl settings:** include/exclude patterns, subdomain scope, crawl delay.
7. **AI features (Claude API):** content audits, rewritten titles and meta descriptions, grouping pages by topic, semantic similarity between pages (embeddings) and a semantic relevance score that flags off-topic pages.
8. **Packaging** with electron-builder, including the Playwright browser.
