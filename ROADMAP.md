# Roadmap

Planned work for Yaka|SEO, roughly in priority order. For what the app can't do today, see [Known limitations](README.md#known-limitations) in the README.

1. **Redirect chains:** each hop as its own row with its 3xx status, as Screaming Frog reports them. Today a redirect is one row with `finalUrl`. This is the last Screaming Frog per-page field not yet collected (see "Data collected per URL" in the README).
2. **Store crawls in SQLite** in the main process, with the UI fetching results a page at a time. Makes very large crawls possible and lets you save and reopen them.
3. **Link graph views.** Inlinks, `% of Total`, link score and JS-only links are done. Still to do: an inlinks/outlinks panel for the selected URL (which pages link here, with anchor text), broken-link sources, and orphan pages (in a sitemap but not linked).
4. **Spelling and grammar checks** (for example LanguageTool or nspell), with dictionaries per page language. Near-duplicate detection is done.
5. **More checks:** hreflang, structured data (JSON-LD), Open Graph and Twitter tags, duplicate titles and descriptions, sitemap.xml comparison, pagination.
6. **Crawl settings:** include/exclude patterns, subdomain scope, crawl delay.
7. **AI features (Claude API):** content audits, rewritten titles and meta descriptions, grouping pages by topic, semantic similarity between pages (embeddings) and a semantic relevance score that flags off-topic pages.
8. **Packaging** with electron-builder, including the Playwright browser.
