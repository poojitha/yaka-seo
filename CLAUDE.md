# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ScreamingAI is a desktop SEO crawler (Screaming Frog style) built with Electron + electron-vite, React 19, TypeScript 7, Crawlee 3 and Playwright. README.md is detailed and current; read it for the full data-field list, troubleshooting and roadmap.

## Commands

```bash
npm install          # postinstall downloads Playwright Chromium (~150 MB)
npm run dev          # Vite dev server + Electron; renderer hot-reloads, main/preload rebuild+restart
npm run build        # compile main, preload, renderer into out/
npm run preview      # run Electron against out/
npm run typecheck    # tsc --noEmit on tsconfig.node.json and tsconfig.web.json
```

- There is no test suite and no linter. The build uses esbuild, which does **not** type-check, so `npm run typecheck` is the only correctness gate — run it after changes.
- `dev`/`preview` go through `scripts/electron-vite.cjs`, which clears `ELECTRON_RUN_AS_NODE` (set by VS Code's terminal; it makes Electron run as plain Node and crash on `app.getPath`). Don't call `electron-vite` directly without unsetting it.
- `SiteCrawler` has no Electron dependency, so it can be exercised headlessly by bundling a script with esbuild (`--platform=node --format=esm --packages=external --alias:@shared=./src/shared`). See README "Running the crawler without Electron".

## Architecture

Three Electron processes, with all crawling in main and the renderer purely UI:

- **Main** (`src/main/`): `index.ts` owns the window and IPC handlers. `crawl:start` fires `SiteCrawler.run()` **without awaiting it**; rows are buffered and flushed to the renderer every 250 ms as `crawl:results` + `crawl:progress` events. `crawler.ts` picks `CheerioCrawler` (fast HTML) or `PlaywrightCrawler` (`renderJs`) and shares options/handlers between them. `extract.ts` turns a Cheerio `$` into SEO fields + indexability; `csv.ts` serializes (with UTF-8 BOM).
- **Preload** (`src/preload/`): `contextBridge` exposes a typed `window.api` (`ScreamingApi`). `contextIsolation` is on; the renderer has no Node access and a CSP in `index.html`.
- **Renderer** (`src/renderer/src/`): React state holds all rows in memory. `filters.ts` defines issue filters; `ResultsTable.tsx` is a hand-rolled virtualized table (fixed 28 px rows, `ResizeObserver`, no deps).
- **Shared** (`src/shared/types.ts`): the single IPC contract (`CrawlOptions`, `PageResult`, `CrawlProgress`, `ScreamingApi`), imported via the `@shared/*` alias defined in `electron.vite.config.ts` and both tsconfigs.

Key invariants in `crawler.ts`:

- Each crawl creates a fresh `Configuration({ persistStorage: false })` and a uniquely named `RequestQueue`, dropped in `finally`. Crawlee's default global queue would make a second crawl see every URL as already handled. `CRAWLEE_STORAGE_DIR` is pointed at Electron `userData` so nothing lands in `./storage`.
- Both modes funnel into one `handlePage()` → `extractSeo()` path (Playwright uses `parseWithCheerio()`), so extraction logic is written once. Each mode reads status/headers from its own response type (`response.statusCode` vs `response.status()`).
- HTTP 4xx/5xx are results, not failures: Cheerio mode sets `ignoreHttpErrorStatusCodes` 400–599; `useSessionPool: false` gives the same behavior in Playwright mode. Links are only enqueued when status < 400. Network-level failures go through `failedRequestHandler` → `errorResult()` rows.
- Depth, page limits and robots.txt come from Crawlee options (`maxCrawlDepth`, `maxRequestsPerCrawl`, `respectRobotsTxtFile`) — don't reimplement them. Scope is `same-hostname` (`www.` vs bare domain are different hosts).
- `stop()` is graceful (in-flight finish); `teardown()` is immediate and used on window close. Only one crawl runs at a time.

## Common change recipes

- **New SEO field:** `PageResult` in `types.ts` → `extractSeo()` in `extract.ts` → `errorResult()` in `crawler.ts` (must stay in sync or typecheck fails) → optionally a column in `ResultsTable.tsx`.
- **New issue filter:** `FILTERS` in `src/renderer/src/filters.ts`.
- **New IPC call:** `ScreamingApi` in `types.ts` → `preload/index.ts` → `ipcMain.handle` in `main/index.ts`.

## Version / config gotchas

- TypeScript 7 dropped `baseUrl`; `paths` entries must be relative (`"./src/shared/*"`).
- electron-vite 5 supports Vite ≤ 7, so `vite` is pinned `^7` and `@vitejs/plugin-react` `^5`. Don't upgrade them independently.
- Use `CheerioRoot` from `crawlee` for Cheerio types; don't install a separate `cheerio` (type mismatch).

## Style

4-space indent, single quotes, semicolons, short comments explaining *why* (see `crawler.ts`, `main/index.ts`).
