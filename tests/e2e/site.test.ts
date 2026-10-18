import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { log } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
import { SiteCrawler } from '../../src/main/crawler';
import { toCsv } from '../../src/main/csv';
import { FILTERS, filterContext } from '../../src/renderer/src/filters';
import { ALL_CASES, IGNORED_FILTERS, expectationFor, startTestSite, type Mode, type TestSite } from '../../testsite/site';

/*
 * End-to-end run against the test site (testsite/site.ts): a full crawl in each mode, the post-crawl analysis
 * merged in as the renderer does, then the renderer's own issue filters. Every URL must match exactly the
 * filters its case declares, so a missed issue and a false positive both fail.
 */

const ISSUES = FILTERS.filter((f) => f.id !== 'all' && !f.id.startsWith('severity-') && !IGNORED_FILTERS.includes(f.id));
const defaults: Omit<CrawlOptions, 'startUrl' | 'renderJs'> = { maxPages: 500, maxDepth: 20, concurrency: 5, userAgent: '' };

let site: TestSite;

beforeAll(async () => {
    process.env.CRAWLEE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'screamingai-e2e-'));
    log.setLevel(log.LEVELS.OFF);
    site = await startTestSite();
});

afterAll(async () => {
    await site?.close();
    rmSync(process.env.CRAWLEE_STORAGE_DIR!, { recursive: true, force: true });
});

async function crawl(options: Partial<CrawlOptions>) {
    const rows: PageResult[] = [];
    const analysis = await new SiteCrawler().run({ ...defaults, renderJs: false, startUrl: `${site.origin}/`, ...options }, (r) => rows.push(r));
    return rows.map((r) => ({ ...r, ...analysis[r.url] }));
}

/** Path of a row on the test site's host, or null for any other host. */
const pathOf = (row: PageResult) => {
    const u = new URL(row.urlEncoded);
    return u.host === new URL(site.origin).host ? u.pathname : null;
};

describe.each<Mode>(['fast', 'js'])('%s mode', (mode) => {
    let rows: PageResult[] = [];
    let byPath = new Map<string, PageResult>();
    let filtersOf: (row: PageResult) => string[];

    beforeAll(async () => {
        rows = await crawl({ renderJs: mode === 'js' });
        byPath = new Map(rows.map((r) => [pathOf(r) ?? r.url, r]));
        const ctx = filterContext(rows);
        filtersOf = (row) => ISSUES.filter((f) => f.test(row, ctx)).map((f) => f.id).sort();
    });

    it('crawls every URL once and nothing it should not', () => {
        const paths = rows.map((r) => pathOf(r) ?? r.url);
        const expected = new Set(ALL_CASES.filter((c) => expectationFor(c, mode).crawled).map((c) => c.path));
        expect(paths.filter((p, i) => paths.indexOf(p) !== i), 'crawled twice').toEqual([]);
        expect(paths.filter((p) => !expected.has(p)).sort(), 'unexpected URLs').toEqual([]);
    });

    it.each(ALL_CASES.map((c) => [c.path, c] as const))('%s', (path, c) => {
        const want = expectationFor(c, mode);
        const row = byPath.get(path);
        if (!want.crawled) {
            expect(row, 'should not be crawled').toBeUndefined();
            return;
        }
        expect(row, 'not crawled').toBeDefined();
        // Path in the object so a failure says which page it was.
        expect({ path, filters: filtersOf(row!) }).toEqual({ path, filters: want.filters });
        for (const [field, value] of Object.entries(want.fields ?? {})) {
            const actual = row![field as keyof PageResult];
            if (value instanceof RegExp) expect(String(actual), field).toMatch(value);
            else expect(actual, field).toEqual(value);
        }
    });

    it.runIf(mode === 'fast')('exports a CSV that spreadsheets open safely', () => {
        const csv = toCsv(rows);
        expect(csv.startsWith('﻿')).toBe(true);
        expect(csv).toContain(`"'=HYPERLINK(""http://example.org"",""Click me"") page"`);
    });
});

describe('crawl limits', () => {
    it('stops at the page limit', async () => {
        const rows = await crawl({ maxPages: 10 });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(10);
    });

    it('stops at the depth limit', async () => {
        const rows = await crawl({ maxDepth: 1 });
        expect(Math.max(...rows.map((r) => r.depth))).toBe(1);
        expect(rows.some((r) => pathOf(r) === '/links/weak')).toBe(false);
    });
});
