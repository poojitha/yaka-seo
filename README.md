# Yaka|SEO

A desktop SEO crawler in the style of Screaming Frog, built with **Electron**, **TypeScript**, **Crawlee** and **Playwright**.

Enter a URL and Yaka|SEO crawls the site. It records each page's status code, title, meta description, headings, canonical, indexability, word count and link counts. It can also render JavaScript-heavy sites in headless Chromium. Issue filters flag common SEO problems, and results can be exported to CSV.

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Ways to run the project](#ways-to-run-the-project)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Data collected per URL](#data-collected-per-url)
- [Configuration notes](#configuration-notes)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations) (planned work: [ROADMAP.md](ROADMAP.md))

---

## Features

- **Two crawl modes**
  - **Fast HTML mode** (`CheerioCrawler`): plain HTTP requests plus HTML parsing, for server-rendered sites.
  - **Render JavaScript mode** (`PlaywrightCrawler`): loads each page in headless Chromium, for sites built with React, Vue, Angular and similar. This is the default.
- **Respects robots.txt.**
- **Crawl limits:** max pages, max depth and concurrency (threads).
- **Stays on the start URL's hostname.**
- **User-Agent setting:** a generated real-browser (Chrome) fingerprint (default), or a custom string.
- **Records 4xx/5xx pages and failures** as rows instead of silently dropping them. Bot-protection blocks and challenge pages (Akamai, Cloudflare) are flagged as **Blocked** instead of being reported as real pages.
- **Issue filters:** errors, redirects, non-indexable, missing or long titles, missing or long meta descriptions, missing or multiple H1s, thin content, and images missing alt text.
- **Results table:** sortable and searchable, and it only renders visible rows, so it stays fast on large crawls.
- **Details panel** showing every field for the selected URL.
- **CSV export** of the current filtered view. The file includes a UTF-8 BOM so Excel reads it correctly.
- **Light and dark theme** that follows your OS setting.

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) |
| Build tooling | [electron-vite](https://electron-vite.org/) (Vite 7) |
| Language | TypeScript 7 |
| UI | React 19, [Tailwind CSS](https://tailwindcss.com/) 4, [Lucide](https://lucide.dev/) icons (`lucide-react`) |
| Crawling | [Crawlee](https://crawlee.dev/) 3 (`CheerioCrawler`, `PlaywrightCrawler`, `RequestQueue`) |
| JS rendering | [Playwright](https://playwright.dev/) (Chromium) |
| HTML parsing | Cheerio (the version bundled with Crawlee) |

## Getting started

### Prerequisites

- **Node.js 22+** (developed on 22.13)
- **npm 10+**
- Windows, macOS or Linux

### Install

```bash
npm install
```

`npm install` also runs a `postinstall` step (`playwright install chromium`) that downloads the headless browser used by the Render JavaScript mode, about 150 MB.

---

## Ways to run the project

### 1. Development mode (recommended while coding)

```bash
npm run dev
```

- Starts the Vite dev server for the UI and launches the Electron app.
- Changes to the **renderer** (`src/renderer`) update the window straight away (hot reload).
- Changes to **main** or **preload** (`src/main`, `src/preload`) rebuild and restart the app.
- Crawler logs appear in the terminal. The UI's DevTools are under **View → Toggle Developer Tools**.
- Press `Ctrl+C` in the terminal to quit.

### 2. Production build and preview

```bash
npm run build     # compile main, preload and renderer into out/
npm run preview   # launch Electron against the compiled out/ files
```

Use this to check the app as it will be packaged: minified, with no dev server.

### 3. Type checking

```bash
npm run typecheck
```

Runs `tsc --noEmit` against both TypeScript projects:
- `tsconfig.node.json` covers main, preload and shared.
- `tsconfig.web.json` covers renderer and shared.

The build itself uses esbuild, which does **not** type-check, so run this before committing.

### Tests

```bash
npm test             # run everything once (~25 s)
npm run test:watch   # re-run on change
npx vitest run --project renderer   # only the React tests (fast)
```

Tests use [Vitest](https://vitest.dev/) and live in `tests/`, which mirrors `src/` (`tests/main/`, `tests/renderer/`). There are two projects in `vitest.config.ts`:
- **main** (Node): `extract`, `csv`, the IPC handlers in `index.ts` (Electron is mocked), and `SiteCrawler`. The crawler tests start a small local HTTP site and run real crawls in both modes, so they need the Playwright Chromium from `postinstall`.
- **renderer** (jsdom + Testing Library): the filters, the start and crawling screens, the results table and the full app flow, with `window.api` mocked.

Shared test data (`makeResult()`) is in `tests/fixtures.ts`.

### 4. Running the crawler without Electron (headless / scripting)

`SiteCrawler` in `src/main/crawler.ts` doesn't depend on Electron, so you can drive it from a plain Node script. This is handy for tests or command-line use. Bundle it with esbuild (installed with Vite):

```ts
// scripts/crawl.ts
import { SiteCrawler } from '../src/main/crawler';

const rows = [];
await new SiteCrawler().run(
    { startUrl: 'https://books.toscrape.com/', maxPages: 50, maxDepth: 3, concurrency: 5, renderJs: false, userAgent: '' },
    (row) => rows.push(row),
);
console.log(rows);
```

```bash
npx esbuild scripts/crawl.ts --bundle --platform=node --format=esm --packages=external \
  --alias:@shared=./src/shared --outfile=scripts/crawl.mjs
node scripts/crawl.mjs
```

### 5. Packaging an installer (not set up yet)

Packaging isn't configured yet. The planned approach is [electron-builder](https://www.electron.build/) (`npm i -D electron-builder`, then `electron-builder --win`). The Playwright Chromium browser has to be shipped with the installer, or downloaded on first run, for the Render JavaScript mode to work. See the [roadmap](ROADMAP.md).

### npm scripts reference

| Script | What it does |
|---|---|
| `npm run dev` | Dev server + Electron with hot reload |
| `npm run build` | Production build into `out/` |
| `npm run preview` | Run the production build |
| `npm run typecheck` | Type-check all TypeScript |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `postinstall` | Downloads Playwright Chromium (runs automatically) |

`dev` and `preview` go through `scripts/electron-vite.cjs`, which clears `ELECTRON_RUN_AS_NODE` first (see [Troubleshooting](#troubleshooting)).

---

## Architecture

Electron apps run as separate processes. Yaka|SEO keeps all crawling in the **main process** (Node.js), keeps the **renderer** (Chromium) purely for UI, and connects them through a small, typed **preload bridge**.

```
┌──────────────────────────── Renderer process (Chromium, React UI) ─────────────────────────┐
│  App.tsx ─────────── crawl form, filter tabs, search, details panel, status bar            │
│  ResultsTable.tsx ── sortable table that only draws visible rows                           │
│  filters.ts ──────── issue rules (4xx, missing title, multiple H1, …)                      │
│                         │  window.api.startCrawl() / onResults() / onProgress()            │
└─────────────────────────┼──────────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┼──── Preload (src/preload/index.ts) ──────────────────────────────┐
│  contextBridge exposes a small, typed `window.api`. The UI has no Node or Electron access. │
└─────────────────────────┼──────────────────────────────────────────────────────────────────┘
                          │  IPC
                          │  invoke: crawl:start · crawl:stop · export:csv
                          │  events: crawl:results · crawl:progress · crawl:analysis
┌─────────────────────────┼──── Main process (Node.js) ──────────────────────────────────────┐
│  index.ts ── creates the window, handles IPC, sends results in 250 ms batches, save dialog │
│  validate.ts ─ checks crawl options from the renderer before a crawl starts                │
│     │                                                                                      │
│     ▼                                                                                      │
│  crawler.ts (SiteCrawler)                                                                  │
│     ├─ CheerioCrawler ──── HTTP + HTML parse (fast)                                        │
│     └─ PlaywrightCrawler ─ headless Chromium, runs JavaScript (slower)                     │
│        shared: RequestQueue · robots.txt · page/depth limits · error handling              │
│     │                                                                                      │
│     ▼                                                                                      │
│  extract.ts ── parsed page ($) → SEO fields                                                │
│  csv.ts ────── results → CSV                                                               │
└────────────────────────────────────────────────────────────────────────────────────────────┘

   src/shared/types.ts ── CrawlOptions, PageResult, CrawlProgress, ScreamingApi (used by all layers)
```

### How a crawl runs

1. **Start (renderer):** clicking **Start** calls `window.api.startCrawl(options)`, which sends an `ipcRenderer.invoke('crawl:start')` message to the main process.
2. **Dispatch (main):** `index.ts` checks that the call came from the app window and validates the options with `parseCrawlOptions()`. Invalid options reject the call, and the UI shows the message as a failed crawl. It then calls `SiteCrawler.run()` **without awaiting it**, so the IPC call returns immediately. Results arrive through a callback and are **buffered**. Every 250 ms the buffer is flushed to the renderer as a `crawl:results` event, along with a `crawl:progress` update. This stops fast crawls from flooding the UI with one message per page.
3. **Crawl setup (`crawler.ts`):**
   - A new `Configuration({ persistStorage: false })` and a uniquely named `RequestQueue` are created for **each** crawl.
   - The crawler is chosen from `renderJs`: `CheerioCrawler` or `PlaywrightCrawler`.
   - Shared options: `maxRequestsPerCrawl`, `maxCrawlDepth`, `maxConcurrency`, `respectRobotsTxtFile`, `useSessionPool: false`, one retry.
4. **Per page:**
   - A `preNavigationHooks` hook records the start time, which is used for response time.
   - The mode-specific `requestHandler` gets the status and headers from its own response type. For example, Cheerio has `response.statusCode` and Playwright has `response.status()`.
   - It then calls the shared `handlePage()`. If `detectBotProtection()` recognizes a CDN block or challenge page, the row is reported as blocked and its links are ignored. Otherwise it runs `extractSeo()`, reports the row, and adds same-hostname links to the queue (only if the status is below 400). A 4xx/5xx page's content isn't analysed at all (title, meta tags, word count and outlinks stay blank, as in Screaming Frog): the error page says nothing about the URL's real content.
5. **Failures:** timeouts, DNS errors and similar go to `failedRequestHandler` and appear as rows with `error` set. A linked file that isn't HTML (an image, a PDF, a 204 with no body) is not a failure: it's reported like a page with an empty document, so it gets its status, headers, size and any header directives (X-Robots-Tag, `Link` canonical). In JS mode, anything the browser can't show as a page (a download, a 204/205/304/407, a redirect loop) fails navigation; those URLs are fetched once over plain HTTP instead, with no retry in the browser. So are `http://` URLs of a host that sent HSTS earlier in the crawl: Chromium would otherwise upgrade them to https itself and report a 307 the server never sent.
6. **UI update (renderer):** each batch is appended to the React state. The filter counts, filtered view and search are recalculated with `useMemo`.
7. **Post-crawl analysis:** while crawling, `crawler.ts` keeps each page's internal link targets, its JS-only links and a MinHash fingerprint of its text in main (they're never sent to the UI). When the crawl ends, finished or stopped, `analyseCrawl()` in `analysis.ts` works out inlinks, % of Total, link score (PageRank) and near duplicates for every page. `SiteCrawler.run()` resolves with the result, and main sends it as one `crawl:analysis` event after the last results and before the final status. The renderer merges it into the rows; until then those columns are empty.
8. **Stop and quit:**
   - **Stop** calls `crawler.stop()`, a graceful stop: in-flight requests finish and nothing new starts. Main sends a `stopping` status right away and `stopped` (not `finished`) when the crawl ends. A Stop that arrives while the crawl is still setting up is remembered and applied once setup completes.
   - Closing the last window calls `crawler.teardown()`, which shuts down immediately.
   - The queue is deleted in a `finally` block.

### Call path when you press Start

The same flow as above, as the functions that actually run and the files they live in:

```
StartScreen.submit()                                  renderer/src/StartScreen.tsx   validate URL, build CrawlOptions
 └─ App.start(opts)                                   renderer/src/App.tsx           reset state, setScreen('crawling')
     └─ window.api.startCrawl(opts)                   preload/index.ts               ipcRenderer.invoke('crawl:start')
         └─ ipcMain.handle('crawl:start')             main/index.ts                  checkSender(), parseCrawlOptions() (validate.ts),
             │                                                                       start 250 ms flush() timer, run crawl without await
             └─ SiteCrawler.run() → crawl()           main/crawler.ts                RequestQueue.open(), new Cheerio/PlaywrightCrawler,
                 │                                                                   this.crawler.run([startUrl])
                 ├─ preNavigationHooks                main/crawler.ts                record startedAt; set User-Agent (Cheerio)
                 ├─ requestHandler                    main/crawler.ts                collect status, headers, body → PageResponse
                 │   └─ handlePage()                  main/crawler.ts
                 │       ├─ detectBotProtection()     main/extract.ts                block/challenge page → errorResult() row, stop here
                 │       ├─ baseResult()              main/crawler.ts                url, depth, timing, timestamp
                 │       ├─ extractSeo()              main/extract.ts                on-page SEO fields + indexability
                 │       ├─ onPage(row)               main/index.ts                  push row into buffer
                 │       └─ enqueueLinks()            (Crawlee)                      same-hostname links back into the queue (status < 400)
                 └─ failedRequestHandler              main/crawler.ts                network failure → errorResult() row

flush() every 250 ms                                  main/index.ts                  webContents.send('crawl:results' / 'crawl:progress')
 └─ subscribe() listeners                             preload/index.ts               call the onResults / onProgress callbacks
     └─ App useEffect → setResults / setProgress      renderer/src/App.tsx           CrawlingScreen re-renders (count, current URL, bar)

crawl() ends → analyseCrawl(pages)                    main/analysis.ts               inlinks, link score (PageRank), near duplicates (MinHash)
 └─ crawler.run() resolves with the analysis          main/index.ts                  final flush(); send('crawl:analysis');
     │                                                                               status 'finished', 'stopped' or 'error'
     └─ onAnalysis → merge into rows                  renderer/src/App.tsx           post-crawl columns fill in
 └─ CrawlingScreen "View results" → onContinue        renderer/src/CrawlingScreen.tsx  setScreen('results') → ResultsTable
```

### Key design decisions

**The RequestQueue is new for every crawl and kept in memory.**
Crawlee's `RequestQueue` is the list of URLs still to visit.
- It skips duplicate URLs.
- It tracks which requests are pending, in progress or done.
- It records each request's `crawlDepth`, which is how the depth limit works.

By default Crawlee shares one queue for the whole process and saves it to `./storage`. That would make a second crawl think every URL had already been visited. A separate `Configuration` and queue per crawl prevents this. `CRAWLEE_STORAGE_DIR` is also pointed at Electron's `userData` folder so nothing is written to the working directory.

**One extraction path for both modes.**
Both crawlers produce a Cheerio `$`: Cheerio mode parses the HTML directly, and Playwright mode uses `parseWithCheerio()` on the rendered page. That means `extract.ts` is written once and gives the same results in both modes.

**HTTP errors are data, not exceptions.**
- Cheerio mode passes `ignoreHttpErrorStatusCodes` (400–599), so 4xx/5xx pages reach the normal handler with a status code instead of being retried and failed.
- In Playwright mode, turning off the session pool has the same effect.

**Crawl limits come from Crawlee.**
`maxCrawlDepth`, `respectRobotsTxtFile` and `maxRequestsPerCrawl` are Crawlee features, so there's no custom depth counting or robots.txt parsing.

**The UI only renders visible rows.**
`ResultsTable` gives every row a fixed height (28 px) and only draws the rows in view, plus a small buffer. A `ResizeObserver` tracks the viewport height. There are no extra dependencies.

**Security.**
- `contextIsolation` and `sandbox` are on. The window denies popups and navigation away from the app.
- The renderer can only reach the five functions in `window.api`, typed by `ScreamingApi`.
- Main accepts IPC calls only from the app window's top frame, and validates payloads instead of trusting their TypeScript types: start URLs must be http(s), limits must be whole numbers in range, and the User-Agent can't contain control characters.
- CSV export prefixes crawled text that starts with `=`, `+`, `-`, `@`, tab or CR with `'`, so a malicious page title can't run as a formula in Excel or Google Sheets.
- `index.html` has a Content-Security-Policy that blocks outside scripts.

**Shared types.**
`src/shared/types.ts` is the single definition of the IPC contract, including the `IPC` channel-name constants that main and preload both use. It's imported everywhere through the `@shared/*` alias, which is set up in `electron.vite.config.ts` and in both tsconfigs.

---

## Project structure

```
ScreamingAI/
├── electron.vite.config.ts   # build config for main / preload / renderer, @shared alias
├── package.json
├── tsconfig.json             # references the two projects below
├── tsconfig.node.json        # main + preload + shared (Node types)
├── tsconfig.web.json         # renderer + shared (DOM types, JSX)
├── vitest.config.ts          # test projects: main (node) + renderer (jsdom)
├── resources/
│   └── icon.png              # full-size logo; window icon (imported with ?asset in main)
├── scripts/
│   ├── electron-vite.cjs     # clears ELECTRON_RUN_AS_NODE, then runs electron-vite
│   └── generate-arial-widths.mjs  # regenerates src/main/arial-widths.ts from arial.ttf (Windows copy by default)
├── src/
│   ├── shared/
│   │   └── types.ts          # CrawlOptions, PageResult, CrawlProgress, ScreamingApi, IPC channel names
│   ├── main/                 # Electron main process (Node.js)
│   │   ├── index.ts          # window, IPC handlers, batching, CSV save dialog
│   │   ├── crawler.ts        # SiteCrawler: Cheerio/Playwright crawlers, queue, limits
│   │   ├── extract.ts        # SEO field extraction + indexability rules
│   │   ├── analysis.ts       # post-crawl: inlinks, link score (PageRank), near duplicates (MinHash)
│   │   ├── carbon.ts         # CO2 per page view and carbon rating (Sustainable Web Design Model v4)
│   │   ├── pixel-width.ts    # title/description width in search results, from arial-widths.ts
│   │   ├── arial-widths.ts   # Arial character widths, generated by scripts/generate-arial-widths.mjs
│   │   ├── csv.ts            # CSV serialisation (formula-safe)
│   │   └── validate.ts       # checks CrawlOptions received over IPC
│   ├── preload/
│   │   ├── index.ts          # contextBridge → window.api
│   │   └── index.d.ts        # types window.api for the renderer
│   └── renderer/             # React UI
│       ├── index.html
│       └── src/
│           ├── main.tsx      # React entry
│           ├── App.tsx       # screen switching, results toolbar, filter tabs, details, status bar
│           ├── StartScreen.tsx     # URL + crawl settings
│           ├── CrawlingScreen.tsx  # spinner, current URL, progress, Continue
│           ├── ResultsTable.tsx
│           ├── filters.ts    # issue filter definitions
│           ├── styles.css    # light/dark theme
│           ├── assets/       # images imported by components (logo.png, 256 px)
│           └── env.d.ts      # Vite client types
├── tests/                    # Vitest, mirrors src/
│   ├── fixtures.ts           # makeResult() for PageResult rows
│   ├── main/                 # extract, csv, validate, IPC (index), SiteCrawler against a local server
│   └── renderer/             # setup.ts, filters, screens, table, App flow
└── out/                      # build output (git-ignored)
```

### Where to make common changes

| I want to… | Edit |
|---|---|
| Add a new SEO field | `PageResult` in `src/shared/types.ts`, `extractSeo()` in `src/main/extract.ts`, `errorResult()` in `src/main/crawler.ts`, and optionally a column in `ResultsTable.tsx` |
| Add a new issue filter | `FILTERS` in `src/renderer/src/filters.ts` |
| Change crawl behaviour (scope, retries, headers) | `shared` options in `src/main/crawler.ts` |
| Add a new IPC call | `ScreamingApi` and a channel in `IPC` in `types.ts`, then `preload/index.ts` and an `ipcMain.handle` in `main/index.ts` that calls `checkSender()` and validates its payload |

---

## Data collected per URL

| Field | Description |
|---|---|
| `url`, `urlEncoded` | Requested URL, and its percent-encoded form |
| `redirectUrl`, `redirectType` | Where the URL redirects to, and how: `HTTP Redirect` (a 3xx, reported as its own row with no page content), `HTTP Refresh Redirect` (`Refresh` header), `Meta Refresh Redirect` or `JavaScript Redirect` (JS mode). As in Screaming Frog, this is the next hop: each hop of a chain, and the final page, are crawled as their own rows. A redirect loop is reported as a redirect to itself (JS mode: an error, since the browser refuses to load it). |
| `status`, `statusText` | HTTP status code (`null` if the request failed) and its standard reason phrase (`Not Found`) |
| `contentType` | `Content-Type` response header |
| `httpVersion` | Protocol version: `1.1`, `2` or `3` |
| `lastModified` | `Last-Modified` response header |
| `cookies` | Names of cookies set by `Set-Cookie` headers |
| `depth` | Clicks from the start URL |
| `folderDepth` | Directories in the path, as in Screaming Frog: `/` and `/page` are 0, `/blog/post` is 1, `/blog/post/` is 2 |
| `responseTimeMs` | Time from navigation start to handler (includes rendering in JS mode) |
| `crawlTimestamp` | When the page was processed (ISO 8601) |
| `sizeBytes`, `hash` | Uncompressed size and MD5 of the response body. Equal hashes mean exact duplicates. In JS mode these are for the raw HTML, not the rendered DOM. |
| `transferredBytes` | Response body bytes as received, before decompression (headers excluded). In JS mode this is what Chromium reports, which also counts chunked-encoding framing. |
| `totalTransferredBytes` | JS mode: `transferredBytes` of the page plus every resource it loaded by the `load` event (CSS, JS, images, fonts…), with the browser cache off so each page counts what a first-time visitor downloads. Fast HTML mode fetches only the HTML, so this equals `transferredBytes`. |
| `co2Mg` | Estimated CO2e per page view from `totalTransferredBytes`, using the Sustainable Web Design Model v4 for a first-time visitor on the global average grid: 0.3 kWh/GB × 494 g/kWh = 148.2 g per GB. Matches Screaming Frog's CO2 (mg) column. |
| `carbonRating` | A+ to F from `co2Mg` (A+ ≤ 40 mg, A ≤ 79, B ≤ 145, C ≤ 209, D ≤ 278, E ≤ 359, else F). JS mode only; empty in fast HTML mode, where the total covers just the HTML. |
| `title`, `titleLength` | `<title>` text and length |
| `titlePixelWidth` | Title width in Google's desktop results (Arial 20 px). Over about 561 px gets cut off. |
| `metaDescription`, `metaDescriptionLength` | Meta description and length |
| `metaDescriptionPixelWidth` | Description width in Google's desktop results (Arial 14 px). Over about 985 px gets cut off. |
| `metaKeywords`, `metaKeywordsLength` | Meta keywords and length (ignored by Google) |
| `h1`, `h1Length`, `h1Second`, `h1SecondLength`, `h1Count` | First and second H1 text and lengths, H1 count |
| `h2`, `h2Length`, `h2Count` | First H2 text and length, H2 count |
| `canonical` | Absolute canonical URL from `<link rel="canonical">` in `<head>` (one in `<body>` is ignored), or else from an HTTP `Link: <url>; rel="canonical"` header. Compared exactly: `/page` and `/page/` are different URLs. |
| `metaRobots`, `metaRobots2` | First and second `<meta name="robots">` or `<meta name="googlebot">` tags (lower-cased) |
| `xRobotsTag` | `X-Robots-Tag` response header |
| `metaRefresh` | `content` of `<meta http-equiv="refresh">` |
| `relNext`, `relPrev` | Pagination links from `<link rel="next/prev">` in `<head>` (as are `amphtml` and `mobileAlternate`) |
| `httpRelNext`, `httpRelPrev` | Pagination links from the HTTP `Link` header |
| `amphtml`, `mobileAlternate` | `<link rel="amphtml">` and `<link rel="alternate" media="...">` URLs |
| `language` | `<html lang>` |
| `indexable`, `indexabilityReason` | `false` with a reason: `Redirected` (3xx, or a refresh or JavaScript redirect to another URL), `Status 404` and other non-2xx statuses, `noindex (meta)` (robots or googlebot tag), `noindex (X-Robots-Tag)`, or `Canonicalised` |
| `wordCount` | Words in body text (scripts and styles excluded) |
| `sentenceCount`, `avgWordsPerSentence` | Sentences end at `.`, `!`, `?` and at block elements such as headings, list items and cells |
| `fleschReadingEase`, `readability` | Flesch reading ease (English formula, higher is easier) capped to 0-100, and its band: Very Easy, Easy, Fairly Easy, Normal, Fairly Hard, Hard, Very Hard (Screaming Frog's names) |
| `textRatio` | Visible text characters as a percentage of the HTML as served (not the rendered page, which JavaScript can grow). Matches Screaming Frog. |
| `internalLinks`, `uniqueInternalLinks` | Links to the same hostname: all, and distinct URLs |
| `externalLinks`, `uniqueExternalLinks` | Links to other hostnames: all, and distinct URLs |
| `uniqueJsOutlinks`, `uniqueExternalJsOutlinks` | Distinct internal/external link targets in the rendered page that aren't in the HTML as served (JS mode; the served HTML is parsed with the browser's `DOMParser`). Always 0 in fast HTML mode. |
| `imagesMissingAlt` | `<img>` elements with no or empty `alt` |

**Post-crawl fields.** These need the whole crawl, so they're empty while it runs and filled in when it ends (finished or stopped).

| Field | Description |
|---|---|
| `inlinks`, `uniqueInlinks` | Internal links to the page from other crawled pages: every link, and distinct linking pages. Self-links, and links from 4xx/5xx pages (which aren't followed), don't count. |
| `uniqueJsInlinks` | Distinct pages whose link to this page only exists after JavaScript runs |
| `percentOfTotal` | `uniqueInlinks` as a percentage of the crawl's 200 HTML pages |
| `linkScore` | 0–100. PageRank (damping 0.85) over the internal link graph of crawled pages, scaled `100 × log10(1 + 9 × rank / best rank)`, so the best-linked page is 100. Same idea as Screaming Frog's Link Score; its exact scaling isn't public, so values differ. |
| `nearDuplicates`, `closestNearDuplicate`, `closestNearDuplicateSimilarity` | Pages whose body text is at least 90% similar (MinHash over 5-word shingles, 128 hashes, LSH so pages aren't all compared pairwise), the most similar one, and its similarity in percent. Only indexable pages with at least 5 words are checked; others have `nearDuplicates` null. |
| `error` | First line of the error message for failed requests |

---

## Configuration notes

- **TypeScript 7** no longer supports `baseUrl`, so `paths` entries must be relative (`"./src/shared/*"`).
- **electron-vite 5** supports Vite up to version 7 only, so `vite` is pinned to `^7` and `@vitejs/plugin-react` to `^5`.
- **Cheerio types:** use `CheerioRoot` from `crawlee`, not a separately installed `cheerio`. The two versions' types don't match.
- **Crawl scope** is `same-hostname`: `www.example.com` and `example.com` count as different hosts.

---

## Troubleshooting

**`TypeError: Cannot read properties of undefined (reading 'getPath')` on startup**
`ELECTRON_RUN_AS_NODE=1` is set in your environment. VS Code's integrated terminal sets it, and it makes Electron run as plain Node. The npm scripts clear it for you. If you run `electron-vite` directly, unset it first:
- bash: `env -u ELECTRON_RUN_AS_NODE npx electron-vite dev`
- PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE; npx electron-vite dev`

**`Error: Electron uninstall`**
The Electron binary wasn't downloaded during install. Run:
```bash
node node_modules/electron/install.js
```

**Render JavaScript mode fails with "Executable doesn't exist"**
Playwright's Chromium is missing. Run:
```bash
npx playwright install chromium
```

**`npm install` fails with ERESOLVE about vite**
Something upgraded Vite past 7. Reinstall the pinned versions:
```bash
npm i -D vite@7 @vitejs/plugin-react@5
```

**Only the start page is crawled**
- The site may redirect to a different hostname (for example `example.com` → `www.example.com`). Start from the final hostname.
- robots.txt may disallow the pages.
- The links may be added by JavaScript. Turn on **Render JavaScript**.

**Pages show as "Blocked by bot protection"**
The site's CDN (Akamai, Cloudflare) is refusing automated clients. Try a custom User-Agent. If you own the site, allowlist a custom user agent or your IP in the CDN/WAF, which is how crawlers such as Screaming Frog get through.

---

## Known limitations

- Results are held **in memory**, as a React array in the renderer and in IPC batches. They're lost when the app closes and will struggle past roughly 100k URLs.
- **Only one crawl at a time.**
- **Link graph is in memory and summarised.** Inlinks and link scores are worked out when the crawl ends, but the individual links aren't shown or exported, so there's no "which pages link here" view, broken-link sources or orphan pages yet. Near duplicates and link scores cover only the pages this crawl reached.
- **No installer or packaging** yet.

Planned work is tracked in [ROADMAP.md](ROADMAP.md).
