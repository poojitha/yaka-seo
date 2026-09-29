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
| UI | React 19 |
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
                          │  events: crawl:results · crawl:progress
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
   - It then calls the shared `handlePage()`. If `detectBotProtection()` recognizes a CDN block or challenge page, the row is reported as blocked and its links are ignored. Otherwise it runs `extractSeo()`, reports the row, and adds same-hostname links to the queue (only if the status is below 400).
5. **Failures:** timeouts, DNS errors, unsupported content types and similar go to `failedRequestHandler` and appear as rows with `error` set.
6. **UI update (renderer):** each batch is appended to the React state. The filter counts, filtered view and search are recalculated with `useMemo`.
7. **Stop and quit:**
   - **Stop** calls `crawler.stop()`, a graceful stop: in-flight requests finish and nothing new starts. Main sends a `stopping` status right away and `stopped` (not `finished`) when the crawl ends. A Stop that arrives while the crawl is still setting up is remembered and applied once setup completes.
   - Closing the last window calls `crawler.teardown()`, which shuts down immediately.
   - The queue is deleted in a `finally` block.

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
│   └── electron-vite.cjs     # clears ELECTRON_RUN_AS_NODE, then runs electron-vite
├── src/
│   ├── shared/
│   │   └── types.ts          # CrawlOptions, PageResult, CrawlProgress, ScreamingApi, IPC channel names
│   ├── main/                 # Electron main process (Node.js)
│   │   ├── index.ts          # window, IPC handlers, batching, CSV save dialog
│   │   ├── crawler.ts        # SiteCrawler: Cheerio/Playwright crawlers, queue, limits
│   │   ├── extract.ts        # SEO field extraction + indexability rules
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
| `finalUrl` | URL after redirects (only set if different) |
| `redirectType` | `HTTP Redirect` or `JavaScript Redirect` when `finalUrl` is set, `Meta Refresh` when the page has a meta refresh with a URL |
| `status`, `statusText` | HTTP status code (`null` if the request failed) and its standard reason phrase (`Not Found`) |
| `contentType` | `Content-Type` response header |
| `httpVersion` | Protocol version: `1.1`, `2` or `3` |
| `lastModified` | `Last-Modified` response header |
| `cookies` | Names of cookies set by `Set-Cookie` headers |
| `depth` | Clicks from the start URL |
| `folderDepth` | Non-empty path segments (`/` is 0, `/blog/post` is 2) |
| `responseTimeMs` | Time from navigation start to handler (includes rendering in JS mode) |
| `crawlTimestamp` | When the page was processed (ISO 8601) |
| `sizeBytes`, `hash` | Uncompressed size and MD5 of the response body. Equal hashes mean exact duplicates. In JS mode these are for the raw HTML, not the rendered DOM. |
| `title`, `titleLength` | `<title>` text and length |
| `metaDescription`, `metaDescriptionLength` | Meta description and length |
| `metaKeywords`, `metaKeywordsLength` | Meta keywords and length (ignored by Google) |
| `h1`, `h1Length`, `h1Second`, `h1SecondLength`, `h1Count` | First and second H1 text and lengths, H1 count |
| `h2`, `h2Length`, `h2Count` | First H2 text and length, H2 count |
| `canonical` | Absolute canonical URL |
| `metaRobots`, `metaRobots2` | First and second meta robots tags (lower-cased) |
| `xRobotsTag` | `X-Robots-Tag` response header |
| `metaRefresh` | `content` of `<meta http-equiv="refresh">` |
| `relNext`, `relPrev` | Pagination links from `<link rel="next/prev">` |
| `httpRelNext`, `httpRelPrev` | Pagination links from the HTTP `Link` header |
| `amphtml`, `mobileAlternate` | `<link rel="amphtml">` and `<link rel="alternate" media="...">` URLs |
| `language` | `<html lang>` |
| `indexable`, `indexabilityReason` | `false` with a reason for non-2xx status, `noindex` (either meta robots tag, or X-Robots-Tag), or a canonical pointing elsewhere |
| `wordCount` | Words in body text (scripts and styles excluded) |
| `sentenceCount`, `avgWordsPerSentence` | Sentences end at `.`, `!`, `?` and at block elements such as headings, list items and cells |
| `fleschReadingEase`, `readability` | Flesch reading ease (English formula, higher is easier) and its band: Very Easy, Easy, Fairly Easy, Normal, Fairly Difficult, Difficult, Very Difficult |
| `textRatio` | Visible text characters as a percentage of HTML characters |
| `internalLinks`, `uniqueInternalLinks` | Links to the same hostname: all, and distinct URLs |
| `externalLinks`, `uniqueExternalLinks` | Links to other hostnames: all, and distinct URLs |
| `imagesMissingAlt` | `<img>` elements with no or empty `alt` |
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
- **No link graph.** Link counts are recorded but not where links point, so there are no inlinks, broken-link sources or orphan pages yet.
- **No installer or packaging** yet.

Planned work is tracked in [ROADMAP.md](ROADMAP.md).
