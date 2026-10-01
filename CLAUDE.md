# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Yaka|SEO (repo and package name: ScreamingAI) is a desktop SEO crawler (Screaming Frog style) built with Electron + electron-vite, React 19, TypeScript 7, Crawlee 3 and Playwright. README.md is detailed and current; read it for the full data-field list and troubleshooting. Planned work lives in ROADMAP.md.

## Commands

```bash
npm install          # postinstall downloads Playwright Chromium (~150 MB)
npm run dev          # Vite dev server + Electron; renderer hot-reloads, main/preload rebuild+restart
npm run build        # compile main, preload, renderer into out/
npm run preview      # run Electron against out/
npm run typecheck    # tsc --noEmit on tsconfig.node.json and tsconfig.web.json
npm test             # Vitest: main (node) + renderer (jsdom) projects
npx vitest run tests/main/extract.test.ts   # single file; -t "name" for a single test
```

- There is no linter. The build uses esbuild, which does **not** type-check, so run `npm run typecheck` and `npm test` after changes.
- Tests live in `tests/main/` and `tests/renderer/` (mirroring `src/`), and each tsconfig includes its half. Crawler tests run real crawls against a local HTTP server (see the site map at the top of `tests/main/crawler.test.ts`); `index.test.ts` mocks `electron` and `src/main/crawler`; renderer tests mock `window.api`. Use `makeResult()` from `tests/fixtures.ts` for `PageResult` rows, and load Cheerio via `tests/main/test-utils.ts` (it re-exports `loadHtml` from `src/main/html.ts`; cheerio is only installed nested under crawlee, so don't import `cheerio` directly).
- `dev`/`preview` go through `scripts/electron-vite.cjs`, which clears `ELECTRON_RUN_AS_NODE` (set by VS Code's terminal; it makes Electron run as plain Node and crash on `app.getPath`). Don't call `electron-vite` directly without unsetting it.
- `SiteCrawler` has no Electron dependency, so it can be exercised headlessly by bundling a script with esbuild (`--platform=node --format=esm --packages=external --alias:@shared=./src/shared`). See README "Running the crawler without Electron".

## Architecture

Three Electron processes, with all crawling in main and the renderer purely UI:

- **Main** (`src/main/`): `index.ts` owns the window and IPC handlers. Every handler first calls `checkSender()` (only our window's top frame may call main), and `crawl:start` runs its payload through `parseCrawlOptions()` in `validate.ts` (http/https only, bounded integers, no control characters in the User-Agent). `crawl:start` fires `SiteCrawler.run()` **without awaiting it**; rows are buffered and flushed to the renderer every 250 ms as `crawl:results` + `crawl:progress` events. `crawl:stop` sends `stopping`, and a stopped crawl ends as `stopped` rather than `finished`. `SiteCrawler.run()` resolves with a `CrawlAnalysis` (post-crawl fields from `analysis.ts`: inlinks, link score, near duplicates), which main sends as one `crawl:analysis` event after the last results and before the final status; rows carry those fields as `null` until then. `crawler.ts` picks `CheerioCrawler` (fast HTML) or `PlaywrightCrawler` (`renderJs`) and shares options/handlers between them. `extract.ts` turns a Cheerio `$` into SEO fields + indexability; `csv.ts` serializes (with UTF-8 BOM, and a `'` prefix on strings starting with `= + - @` tab or CR so crawled text can't run as a spreadsheet formula).
- **Preload** (`src/preload/`): `contextBridge` exposes a typed `window.api` (`ScreamingApi`). `contextIsolation` and `sandbox` are on (the preload must stay a CJS bundle that only imports `electron`); popups and navigation are denied; the renderer has no Node access and a CSP in `index.html`.
- **Renderer** (`src/renderer/src/`): `App.tsx` switches between three screens: `StartScreen` (settings) → `CrawlingScreen` (progress) → results. React state holds all rows in memory. IPC rejections are caught and shown (a rejected start shows as a failed crawl). `filters.ts` defines issue filters (shown as cards by `FilterCards.tsx`, which maps each to a Lucide icon and a tone); `ResultsTable.tsx` is a hand-rolled virtualized table (fixed 34 px rows, `ResizeObserver`). Styling is Tailwind v4 (`@tailwindcss/vite`) plus `lucide-react` icons. The theme lives in `styles.css`: colour tokens on `:root` (light values, dark under `prefers-color-scheme` and `data-theme`), exposed to Tailwind via `@theme inline` (`bg-surface`, `border-line`, `text-muted`, `text-info`…), and `tone-*` classes that set `--tone` for pills, cards, buttons and the `glow` utility. Any plain CSS there must sit in `@layer base`/`components`: unlayered rules beat every Tailwind utility.
- **Shared** (`src/shared/types.ts`): the single IPC contract (`CrawlOptions`, `PageResult`, `CrawlProgress`, `ScreamingApi`, and the `IPC` channel-name constants used by main and preload), imported via the `@shared/*` alias defined in `electron.vite.config.ts` and both tsconfigs.

Key invariants in `crawler.ts`:

- Each crawl creates a fresh `Configuration({ persistStorage: false })` and a uniquely named `RequestQueue`, dropped in `finally`. Crawlee's default global queue would make a second crawl see every URL as already handled. `CRAWLEE_STORAGE_DIR` is pointed at Electron `userData` so nothing lands in `./storage`.
- Both modes funnel into one `handlePage()` → `extractSeo()` path (Playwright uses `parseWithCheerio()`), so extraction logic is written once. `handlePage()` runs `detectBotProtection()` first; a blocked/challenge page becomes an error-style row and its links are not enqueued. Each mode reads status/headers from its own response type (`response.statusCode` vs `response.status()`).
- HTTP 4xx/5xx are results, not failures: Cheerio mode sets `ignoreHttpErrorStatusCodes` 400–599; `useSessionPool: false` gives the same behavior in Playwright mode. Links are only enqueued when status < 400. Network-level failures go through `failedRequestHandler` → `errorResult()` rows. Non-HTML responses get an empty document in both modes (Chromium's own image/text viewer page is never parsed). In JS mode, navigation errors matching `HTTP_FALLBACK_ERRORS` (downloads, 204/205/304/407, redirect loops) skip the retry and go through `fetchOverHttp()`, which builds the row from a got response exactly as fast mode does (`gotPageResponse()`) and queues the page's same-hostname links. The same fallback handles Chromium's HSTS upgrade: once a host sends `Strict-Transport-Security`, the browser turns later `http://` navigations into a synthetic `307 Internal Redirect` (`non-authoritative-reason` header) that the server never sent.
- Redirects are reported Screaming Frog style: a URL answering 3xx gets its own row (`redirectUrl` = next hop, no content) and only that hop is enqueued, so each hop and the final page are separate rows. Hops are recorded from got's `beforeRedirect` hook (Cheerio) or Playwright's `redirectedFrom()` chain. In Playwright mode a `page.route` handler aborts (`'aborted'`, not `'failed'`, which would load Chromium's error page) any later main-frame navigation (meta refresh, `Refresh` header, JS), so extraction never races a navigation; the attempt becomes the page's redirect. Because an inline JS redirect stops the parser, `load` may never fire: `goto` uses `waitUntil: 'commit'` and a post-navigation hook waits for load *or* a blocked navigation.
- Depth, page limits and robots.txt come from Crawlee options (`maxCrawlDepth`, `maxRequestsPerCrawl`, `respectRobotsTxtFile`) — don't reimplement them. Scope is `same-hostname` (`www.` vs bare domain are different hosts).
- `stop()` is graceful (in-flight finish); `teardown()` is immediate and runs on `window-all-closed`. Both set `stopRequested`, which `crawl()` checks after the queue opens, so a stop during setup (before `this.crawler` exists) isn't lost. Only one crawl runs at a time.

## Common change recipes

- **New SEO field:** `PageResult` in `types.ts` → `extractSeo()` in `extract.ts` → `errorResult()` in `crawler.ts` (must stay in sync or typecheck fails) → optionally a column in `ResultsTable.tsx`.
- **New post-crawl field** (needs the whole crawl): add it to `PageResult` and `PostCrawlFields` in `types.ts` → `NOT_ANALYSED` in `crawler.ts` → compute it in `analyseCrawl()` in `analysis.ts`, collecting any per-page input in `CrawledPage` (kept in main, not sent to the renderer).
- **New issue filter:** `FILTERS` in `src/renderer/src/filters.ts`.
- **New IPC call:** `ScreamingApi` and a channel name in `IPC` in `types.ts` → `preload/index.ts` → `ipcMain.handle(IPC.x, …)` in `main/index.ts`, calling `checkSender(event)` first and validating the payload (treat it as `unknown`).

## Version / config gotchas

- TypeScript 7 dropped `baseUrl`; `paths` entries must be relative (`"./src/shared/*"`).
- electron-vite 5 supports Vite ≤ 7, so `vite` is pinned `^7` and `@vitejs/plugin-react` `^5`. Don't upgrade them independently.
- Use `CheerioRoot` from `crawlee` for Cheerio types; don't install a separate `cheerio` (type mismatch).

## Style

4-space indent, single quotes, semicolons, short comments explaining *why* (see `crawler.ts`, `main/index.ts`).
