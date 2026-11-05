# Roadmap

Planned work for Yaka|SEO, roughly in priority order. For what the app can't do today, see [Known limitations](README.md#known-limitations) in the README.

The local test site in `yaka-seo-website/` has a test page for most items below. After a change, crawl it and run `npm run compare -- crawl.csv` there to check the result (see its README).

1. **Crawl accuracy:** bugs found by the test site's comparison (`coverage-report.md`, 25 Oct 2026). Fix these before adding features.
   - Discovery: trailing slashes are stripped, so `/x/` and `/x` are treated as one URL (`/urls/duplication_types/`, `/redirects/trailing_slash/`); a redirect to another host loses its own row (`/redirects/external_redirect*`).
   - Redirects: a 304, or a 3xx with no or an empty `Location`, is reported as "Redirected" instead of `Status 30x`; a 5 s meta refresh or `Refresh` header to the same page counts as a redirect, while a 0 s self-refresh loop (`/redirects/infinite_meta_redirect`) doesn't.
   - HTTP: redirect-loop rows have no HTTP version; cookies set on redirect responses are dropped; `sizeBytes` is the decoded text re-encoded as UTF-8, not the bytes received (Latin-1 pages, UTF-8 BOM, invalid charset).
   - Head parsing: meta tags in `<body>`, or after `<head>` closes implicitly (a body element or text inside it), are honoured; a `<title>` in the body is ignored, although browsers use it (`document.title`).
   - Directives: `X-Robots-Tag: otherbot: noindex` is applied, although it targets another bot; a raw `noindex` that JavaScript removes is missed (Google keeps the raw one); a mobile alternate sent in the `Link` header isn't read.
   - Rendering: no wait after the load event, so timers, AJAX links and delayed JS redirects never run (`/javascript/renderer_timeout/*`, `window-location-delayed`); iframe content is merged into the parent page (extra H1, doubled word count, extra links); JavaScript blocked by robots.txt still runs (`/javascript/blocked_resource_content`).
   - Content: word count includes hidden text (`display:none`, SVG, body `<title>`) and counts symbol-only tokens; non-breaking spaces in titles are collapsed; some near duplicates are missed (`/content/near_duplicate_a`/`_b`).
2. **Store every link** (source, target, anchor text, rel/nofollow/ugc/sponsored, element type, whether it only exists after JavaScript). Today links are only counted. Keeping them unlocks most of the link work below:
   - an inlinks/outlinks panel for the selected URL (which pages link here, with anchor text);
   - broken-link sources (which pages link to each 4xx/5xx/failed URL) and a bulk export of them;
   - anchor text checks: aggregated and per-link views, and non-descriptive anchors ("click here", "read more"), empty anchors;
   - external link checking: request each external URL (HEAD, falling back to GET) and report its status and source pages;
   - orphan pages (in a sitemap but not linked; see item 5).
3. **Find more URLs** (about 75 of the 123 URLs the last test-site crawl missed):
   - follow URLs from canonicals (HTML and `Link` header), hreflang (HTML, header and sitemap), `amphtml`, mobile alternates, rel next/prev (HTML and header), other `<link>` elements in `<head>`, `<area>` and `<iframe>`, and XML sitemaps;
   - crawl resources as rows (images, CSS, JS, fonts, JSON from fetch/XHR in JS mode), so broken images, CSS and JS show up with the pages that use them;
   - remember how each URL was found (link, canonical, sitemap, resource…) and show it as a column.
4. **Checks from data we already fetch:**
   - URLs: non-ASCII characters, underscores, uppercase, query parameters, over 115 characters, repetitive path segments, broken `#fragment` bookmarks.
   - Headings: H2 missing / multiple / duplicate / long, and non-sequential headings (an H3 with no H2 before it).
   - Titles and descriptions: more than one `<title>` or meta description (also the Title 2 / Meta Description 2 columns in item 6).
   - Canonicals: more than one canonical, canonical outside `<head>`, HTML and HTTP header canonicals that disagree, canonical chains and loops, canonicals pointing at robots-blocked, redirecting or noindex URLs.
   - Directives: `X-Robots-Tag` per bot (`googlebot:` vs other prefixes), nofollow pages, and conflicting directives (meta vs header, `index` and `noindex` together).
   - Soft 404s: 200 pages that look like an error page (title or text saying "not found", very little content).
   - Security: mixed content, forms posting to HTTP, and missing security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
   - Images: broken images, oversized files, missing `width`/`height`, alt text over 100 characters, lazy loading, `srcset`/`<picture>`, background images set in CSS (JS mode).
   - Mobile: missing viewport tag, dynamic serving (`Vary: User-Agent`), and m-dot pages whose title, H1, word count or links differ from the desktop page.
   - Encoding: charset in the header and the page disagreeing, invalid or missing charset, a byte order mark.
   - Headers: caching (`Cache-Control`, `Expires`, `ETag`) and cookies, including cookies set on redirects.
   - Pagination: rel next/prev pointing at non-200, non-indexable or canonicalised URLs, and broken sequences (the values are already collected).
   - Validation: `<head>` problems that make bots stop reading it early (body elements in `<head>`, multiple `<head>`/`<body>`, invalid elements before a canonical or robots tag).
   - Resources blocked by robots.txt or failing during rendering (JS mode).
5. **International SEO, sitemaps and structured data:**
   - hreflang: missing return tags, invalid language/region codes, missing self-reference and `x-default`, relative URLs, targets that aren't 200, are non-indexable or aren't canonical.
   - XML sitemaps: read existing ones (index, gzip and text sitemaps, from robots.txt or a URL) to find pages missing from them, non-indexable pages in them, orphan pages, and malformed or missing sitemaps; generate standard and image sitemaps from a crawl.
   - Structured data: parse JSON-LD, Microdata and RDFa; report syntax errors and unknown types; validate against Schema.org and Google's rich result requirements.
   - Open Graph and Twitter card tags: missing, too long, broken or relative `og:image`.
   - AMP: crawl and validate AMP URLs (`amphtml` is already collected).
   - robots.txt: view, edit and test a custom robots.txt against the crawl before publishing it.
6. **Measurement follow-ups** (from comparing exports with other SEO crawlers):
   - Readability: other crawlers count sentences and syllables differently (Flesch often differs by 10-30 points), and some leave `<nav>` and `<footer>` out of word counts by default. Their word count is also often exactly 1 higher than ours on crawler-test.com pages (cause not yet found).
   - Title/description pixel widths: hinted (grid-fitted) glyph widths would be more exact; ours are rounded design widths, off by up to ~35 px on i/f-heavy titles.
   - JS mode transferred bytes look ~175 bytes too high (HTTP/2 header bytes, it appears).
   - Title 2 / Meta Description 2 / Canonical 2 columns, and H1 text from an `<img alt>` inside the H1.
7. **Store crawls in SQLite** in the main process, with the UI fetching results a page at a time. Makes very large crawls possible, lets you save and reopen them, and is the base for crawl comparison and scheduling (item 12).
8. **Crawl settings:**
   - include/exclude patterns, subdomain scope, crawl delay;
   - a higher default max depth (the test site's 16-click chain stops at 10), and crawl-trap detection (calendars, repeating relative paths, endless parameters);
   - follow internal and external nofollow links (on/off), and ignore robots.txt (still reporting what it would have blocked);
   - JS mode: render wait after load (AJAX timeout) and a per-page render timeout;
   - list mode: crawl an uploaded URL list instead of following links (for site migrations, with redirect checks per URL);
   - user-agent presets: Googlebot (desktop/smartphone), Bingbot, AI crawlers (GPTBot, ClaudeBot, PerplexityBot…), with robots.txt evaluated for the chosen agent;
   - custom HTTP headers (Accept-Language, cookies, auth tokens), HTTP Basic/Digest authentication, and forms-based login;
   - segments: named URL groups (by pattern) that the dashboard and filters can break down by.
9. **Custom extraction and search:** extract data with CSS selectors, XPath or regex into extra columns; search page source or rendered HTML for text or regex (tracking tags, keywords); run custom JavaScript snippets in JS mode (scroll, click, extract).
10. **Rendering output:** store raw and rendered HTML per page, show a diff of what JavaScript changed (content, links, title, canonical, robots), record console errors and dialogs, and take screenshots. Compare a Googlebot fetch with a browser fetch to flag cloaking.
11. **Content quality:**
    - spelling and grammar checks (for example LanguageTool or nspell), with dictionaries per page language;
    - AI features (Claude API): content audits, rewritten titles and meta descriptions, grouping pages by topic, semantically similar pages (embeddings) and a relevance score that flags off-topic pages. Exact and near-duplicate detection is done.
12. **Reporting and automation:**
    - compare two crawls (new, removed and changed URLs, issues fixed and introduced), including staging vs production with URL mapping;
    - bulk exports (all issues with their URLs, broken links with sources, all links, all images);
    - a command-line mode for scripted crawls, and scheduled crawls with automatic export.
13. **Visualisations:** force-directed crawl diagram and directory tree graph, coloured by status or indexability.
14. **Integrations:** PageSpeed Insights / Lighthouse (Core Web Vitals, CrUX, mobile usability), Google Search Console (clicks and impressions, URL Inspection), Google Analytics, accessibility checks with axe-core (JS mode), and backlink metrics (Majestic, Ahrefs, Moz). These need API keys or OAuth, so they come last.
15. **Packaging:** code signing, auto-update, and macOS/Linux builds (the Windows installer is done).
