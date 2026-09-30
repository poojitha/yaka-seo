# Roadmap

Planned work for Yaka|SEO, roughly in priority order. For what the app can't do today, see [Known limitations](README.md#known-limitations) in the README.

1. **Screaming Frog parity follow-ups** (from comparing exports on crawler-test.com):
   - JS mode: statuses the browser won't display (204, 205, 304, 407), downloads (PDF), and redirect loops become error rows; fall back to a plain HTTP fetch for those.
   - Readability: Screaming Frog counts sentences and syllables differently (Flesch often differs by 10-30 points), and by default leaves `<nav>` and `<footer>` out of word counts. Its word count is also often exactly 1 higher than ours on crawler-test.com pages (cause not yet found).
   - Title/description pixel widths: Screaming Frog uses hinted (grid-fitted) glyph widths; ours are rounded design widths, off by up to ~35 px on i/f-heavy titles.
   - JS mode transferred bytes are ~175 bytes higher than Screaming Frog's (HTTP/2 header bytes, it appears).
   - Title 2 / Meta Description 2 / Canonical 2 columns, and H1 text from an `<img alt>` inside the H1.
2. **Store crawls in SQLite** in the main process, with the UI fetching results a page at a time. Makes very large crawls possible and lets you save and reopen them.
3. **Link graph views.** Inlinks, `% of Total`, link score and JS-only links are done. Still to do: an inlinks/outlinks panel for the selected URL (which pages link here, with anchor text), broken-link sources, and orphan pages (in a sitemap but not linked).
4. **Spelling and grammar checks** (for example LanguageTool or nspell), with dictionaries per page language. Near-duplicate detection is done.
5. **More checks:** hreflang, structured data (JSON-LD), Open Graph and Twitter tags, duplicate titles and descriptions, sitemap.xml comparison, pagination.
6. **Crawl settings:** include/exclude patterns, subdomain scope, crawl delay.
7. **AI features (Claude API):** content audits, rewritten titles and meta descriptions, grouping pages by topic, semantic similarity between pages (embeddings) and a semantic relevance score that flags off-topic pages.
8. **Packaging** with electron-builder, including the Playwright browser.
