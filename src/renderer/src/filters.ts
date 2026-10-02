import type { PageResult } from '@shared/types';

export type Severity = 'error' | 'warning' | 'notice';

/** Where a redirect chain starting at a URL ends up, following the crawled hops. */
export interface RedirectTrace {
    /** Redirect hops followed (1 for a plain redirect). */
    hops: number;
    loop: boolean;
    /** The last crawled URL in the chain, or null if a hop wasn't crawled. */
    final: PageResult | null;
}

/** Facts that need every row (duplicates, where redirects and canonicals lead), computed once per row set. */
export interface FilterContext {
    byUrl: Map<string, PageResult>;
    dupHashes: Set<string>;
    dupTitles: Set<string>;
    dupDescriptions: Set<string>;
    dupH1s: Set<string>;
    redirects: Map<string, RedirectTrace>;
}

export interface Filter {
    id: string;
    label: string;
    test: (r: PageResult, ctx: FilterContext) => boolean;
    /** Issue level for the dashboard's health score; filters without one are informational. */
    severity?: Severity;
    /** false: only in the issue dropdown and dashboard links, not a filter card. */
    card?: boolean;
}

const isHtml = (r: PageResult) => r.error === null && (r.contentType ?? '').includes('html');
/** An HTML page that answered 2xx: the pages content checks apply to. */
export const isHtmlPage = (r: PageResult) => isHtml(r) && (r.status ?? 0) >= 200 && (r.status ?? 0) < 300;
const isFailure = (r: PageResult) => r.error !== null || (r.status ?? 0) >= 400;
const MAX_HOPS = 20;

/** Values that appear on more than one row. */
function repeated(values: string[]): Set<string> {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const v of values) {
        if (!v) continue;
        if (seen.has(v)) dups.add(v);
        seen.add(v);
    }
    return dups;
}

export function filterContext(rows: PageResult[]): FilterContext {
    const byUrl = new Map(rows.map((r) => [r.url, r]));
    // Duplicate titles etc. only matter between pages that compete in search: indexable 2xx HTML.
    const competing = rows.filter((r) => isHtmlPage(r) && r.indexable);
    const redirects = new Map<string, RedirectTrace>();
    for (const r of rows) {
        if (r.redirectUrl === null) continue;
        const visited = new Set([r.url]);
        let cur: PageResult | null = r;
        let hops = 0;
        let loop = false;
        while (cur?.redirectUrl != null && hops < MAX_HOPS) {
            hops++;
            const next: PageResult | null = byUrl.get(cur.redirectUrl) ?? null;
            if (next && visited.has(next.url)) {
                loop = true;
                break;
            }
            if (next) visited.add(next.url);
            cur = next;
        }
        redirects.set(r.url, { hops, loop: loop || hops >= MAX_HOPS, final: cur });
    }
    return {
        byUrl,
        dupHashes: repeated(rows.filter(isHtmlPage).map((r) => r.hash)),
        dupTitles: repeated(competing.map((r) => r.title.trim())),
        dupDescriptions: repeated(competing.map((r) => r.metaDescription.trim())),
        dupH1s: repeated(competing.map((r) => r.h1.trim())),
        redirects,
    };
}

const MB = 1024 * 1024;

/** Issue filters: the cards above the results table, the issue dropdown, and the dashboard's links into the table. */
const ISSUES: Filter[] = [
    { id: 'errors', label: '4xx / 5xx / Failed', severity: 'error', test: isFailure },
    { id: 'redirects', label: 'Redirected', severity: 'notice', test: (r) => r.redirectUrl !== null },
    { id: 'noindex', label: 'Non-indexable', severity: 'warning', test: (r) => !r.indexable },
    { id: 'title-missing', label: 'Title missing', severity: 'error', test: (r) => isHtml(r) && r.titleLength === 0 },
    { id: 'title-long', label: 'Title > 60 chars', severity: 'notice', test: (r) => r.titleLength > 60 },
    // Pixel limits are Screaming Frog's defaults for where Google's desktop results cut text off.
    { id: 'title-wide', label: 'Title > 561 px', severity: 'warning', test: (r) => r.titlePixelWidth > 561 },
    { id: 'desc-missing', label: 'Meta desc missing', severity: 'warning', test: (r) => isHtml(r) && r.metaDescriptionLength === 0 },
    { id: 'desc-long', label: 'Meta desc > 155', severity: 'notice', test: (r) => r.metaDescriptionLength > 155 },
    { id: 'desc-wide', label: 'Meta desc > 985 px', severity: 'notice', test: (r) => r.metaDescriptionPixelWidth > 985 },
    { id: 'h1-missing', label: 'H1 missing', severity: 'warning', test: (r) => isHtml(r) && r.h1Count === 0 },
    { id: 'h1-multiple', label: 'Multiple H1', severity: 'notice', test: (r) => r.h1Count > 1 },
    { id: 'thin', label: 'Thin (< 200 words)', severity: 'warning', test: (r) => isHtml(r) && r.wordCount < 200 },
    // Filled in when the crawl ends, so this tab stays empty until then.
    { id: 'near-duplicates', label: 'Near duplicates', severity: 'warning', test: (r) => (r.nearDuplicates ?? 0) > 0 },
    { id: 'img-alt', label: 'Images missing alt', severity: 'warning', test: (r) => r.imagesMissingAlt > 0 },

    // Dropdown and dashboard only.
    { id: 'title-short', label: 'Title < 30 chars', severity: 'notice', card: false, test: (r) => isHtmlPage(r) && r.titleLength > 0 && r.titleLength < 30 },
    {
        id: 'desc-short',
        label: 'Meta desc < 70',
        severity: 'notice',
        card: false,
        test: (r) => isHtmlPage(r) && r.metaDescriptionLength > 0 && r.metaDescriptionLength < 70,
    },
    { id: 'dup-hash', label: 'Exact duplicates', severity: 'error', card: false, test: (r, ctx) => isHtmlPage(r) && ctx.dupHashes.has(r.hash) },
    {
        id: 'dup-title',
        label: 'Duplicate titles',
        severity: 'warning',
        card: false,
        test: (r, ctx) => isHtmlPage(r) && r.indexable && ctx.dupTitles.has(r.title.trim()),
    },
    {
        id: 'dup-desc',
        label: 'Duplicate meta desc',
        severity: 'warning',
        card: false,
        test: (r, ctx) => isHtmlPage(r) && r.indexable && ctx.dupDescriptions.has(r.metaDescription.trim()),
    },
    { id: 'dup-h1', label: 'Duplicate H1', severity: 'notice', card: false, test: (r, ctx) => isHtmlPage(r) && r.indexable && ctx.dupH1s.has(r.h1.trim()) },
    {
        id: 'redirect-chain',
        label: 'Redirect chains',
        severity: 'warning',
        card: false,
        test: (r, ctx) => {
            const t = ctx.redirects.get(r.url);
            return Boolean(t && !t.loop && t.hops > 1);
        },
    },
    { id: 'redirect-loop', label: 'Redirect loops', severity: 'error', card: false, test: (r, ctx) => ctx.redirects.get(r.url)?.loop === true },
    {
        id: 'redirect-broken',
        label: 'Redirect to error',
        severity: 'error',
        card: false,
        test: (r, ctx) => {
            const t = ctx.redirects.get(r.url);
            return Boolean(t && !t.loop && t.final && isFailure(t.final));
        },
    },
    { id: 'canonical-missing', label: 'Canonical missing', severity: 'notice', card: false, test: (r) => isHtmlPage(r) && !r.canonical },
    { id: 'canonicalised', label: 'Canonicalised', severity: 'notice', card: false, test: (r) => isHtmlPage(r) && r.canonical !== '' && r.canonical !== r.url },
    {
        id: 'canonical-broken',
        label: 'Canonical to non-200',
        severity: 'error',
        card: false,
        test: (r, ctx) => {
            if (!isHtmlPage(r) || !r.canonical || r.canonical === r.url) return false;
            const target = ctx.byUrl.get(r.canonical);
            return Boolean(target && (target.error !== null || target.status !== 200));
        },
    },
    {
        id: 'weak-inlinks',
        label: 'Weakly linked (≤ 1)',
        severity: 'notice',
        card: false,
        // The start URL (depth 0) needs no inlinks.
        test: (r) => isHtmlPage(r) && r.depth > 0 && r.uniqueInlinks !== null && r.uniqueInlinks <= 1,
    },
    {
        id: 'js-only-inlinks',
        label: 'Only linked via JS',
        severity: 'warning',
        card: false,
        test: (r) => (r.uniqueInlinks ?? 0) > 0 && r.uniqueJsInlinks === r.uniqueInlinks,
    },
    { id: 'js-outlinks', label: 'Has JS-only links', severity: 'notice', card: false, test: (r) => r.uniqueJsOutlinks > 0 },
    { id: 'slow', label: 'Slow (> 1 s)', severity: 'warning', card: false, test: (r) => (r.responseTimeMs ?? 0) > 1000 },
    {
        id: 'uncompressed',
        label: 'Uncompressed HTML',
        severity: 'warning',
        card: false,
        // Bytes on the wire about equal to the body size means no gzip/brotli; tiny bodies aren't worth compressing.
        test: (r) => isHtmlPage(r) && (r.sizeBytes ?? 0) > 1024 && r.transferredBytes !== null && r.transferredBytes >= (r.sizeBytes ?? 0) * 0.95,
    },
    { id: 'heavy', label: 'Heavy (> 3 MB)', severity: 'warning', card: false, test: (r) => isHtmlPage(r) && (r.totalTransferredBytes ?? 0) > 3 * MB },
    { id: 'hard-to-read', label: 'Hard to read', severity: 'notice', card: false, test: (r) => isHtmlPage(r) && (r.readability === 'Hard' || r.readability === 'Very Hard') },
    { id: 'no-lang', label: 'Lang missing', severity: 'notice', card: false, test: (r) => isHtmlPage(r) && !r.language },
    { id: 'http-urls', label: 'Non-HTTPS URLs', severity: 'warning', card: false, test: (r) => r.url.startsWith('http:') },
];

export const SEVERITY_LABELS: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', notice: 'Notices' };

const withSeverity = (severity: Severity) => ISSUES.filter((f) => f.severity === severity);

export const FILTERS: Filter[] = [
    { id: 'all', label: 'All URLs', test: () => true },
    ...ISSUES,
    // "Any issue of this level", for the dashboard's health score counts.
    ...(['error', 'warning', 'notice'] as const).map(
        (severity): Filter => ({
            id: `severity-${severity}`,
            label: `URLs with ${SEVERITY_LABELS[severity].toLowerCase()}`,
            card: false,
            test: (r, ctx) => withSeverity(severity).some((f) => f.test(r, ctx)),
        }),
    ),
];
