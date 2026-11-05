import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    Activity,
    CircleAlert,
    CircleCheck,
    CircleMinus,
    CircleX,
    EyeOff,
    Gauge,
    Globe,
    HeartPulse,
    Info,
    Leaf,
    SlidersHorizontal,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react';
import type { PageResult } from '@shared/types';
import { FILTERS, SEVERITY_LABELS, filterContext, isHtmlPage, isRobotsBlocked, type Severity } from './filters';

/*
 * Crawl summary built from the same rows as the results table (which stays the full, accessible view of every value).
 * Single-series charts use one hue (--info); status tones (good/warn/bad) always sit next to a text label.
 */

interface Props {
    rows: PageResult[];
    /** Whether the crawl rendered JavaScript; some measurements only exist in that mode. */
    renderJs: boolean;
    /** Opens the results table with this issue filter (and optionally a search). */
    onOpen: (filterId: string, search?: string) => void;
}

type Tone = 'info' | 'good' | 'warn' | 'bad' | 'neutral';
interface Bar {
    label: string;
    value: number;
    tone?: Tone;
    /** Clicking the bar opens the table filtered to it. */
    filterId?: string;
}

const SEVERITY_TONE: Record<Severity, Tone> = { error: 'bad', warning: 'warn', notice: 'info' };
const SEVERITY_ICON: Record<Severity, LucideIcon> = { error: CircleX, warning: TriangleAlert, notice: Info };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const fmt = (n: number) => n.toLocaleString('en-US');
const isAnswered = (r: PageResult) => r.error === null && r.status !== null;

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatMs(ms: number) {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Counts by key, largest first; anything past `max` rows is folded into "Other". */
function tally(values: string[], max = 6): Bar[] {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    if (sorted.length <= max) return sorted;
    const rest = sorted.slice(max - 1).reduce((a, b) => a + b.value, 0);
    return [...sorted.slice(0, max - 1), { label: 'Other', value: rest }];
}

/** One column per bucket; `max` is each bucket's exclusive upper bound, the lower bound is the previous one's. */
function bucket(values: number[], buckets: { label: string; max: number }[]): Bar[] {
    return buckets.map((b, i) => ({ label: b.label, value: values.filter((v) => v < b.max && v >= (buckets[i - 1]?.max ?? -Infinity)).length }));
}

const KB = 1024;
const MB = 1024 * KB;
const DAY = 24 * 60 * 60 * 1000;
const RESPONSE_BUCKETS = [
    { label: '< 250 ms', max: 250 },
    { label: '250–500 ms', max: 500 },
    { label: '0.5–1 s', max: 1000 },
    { label: '1–2 s', max: 2000 },
    { label: '2–5 s', max: 5000 },
    { label: '5 s +', max: Infinity },
];
const WEIGHT_BUCKETS = [
    { label: '< 100 KB', max: 100 * KB },
    { label: '100–500 KB', max: 500 * KB },
    { label: '0.5–1 MB', max: MB },
    { label: '1–3 MB', max: 3 * MB },
    { label: '3 MB +', max: Infinity },
];
const WORD_BUCKETS = [
    { label: '< 200', max: 200 },
    { label: '200–500', max: 500 },
    { label: '500–1k', max: 1000 },
    { label: '1k–2k', max: 2000 },
    { label: '2k +', max: Infinity },
];
const INLINK_BUCKETS = [
    { label: '0', max: 1 },
    { label: '1', max: 2 },
    { label: '2–5', max: 6 },
    { label: '6–10', max: 11 },
    { label: '11–50', max: 51 },
    { label: '51 +', max: Infinity },
];
const AGE_BUCKETS = [
    { label: '< 1 month', max: 30 * DAY },
    { label: '1–6 months', max: 182 * DAY },
    { label: '6–12 months', max: 365 * DAY },
    { label: '1–2 years', max: 730 * DAY },
    { label: '2 years +', max: Infinity },
];
const READABILITY_BANDS = ['Very Easy', 'Easy', 'Fairly Easy', 'Normal', 'Fairly Hard', 'Hard', 'Very Hard'];
const CARBON_RATINGS = ['A+', 'A', 'B', 'C', 'D', 'E', 'F'];
const MAX_DEPTH_COLUMN = 10;
const MAX_SECTIONS = 10;

type CheckState = 'pass' | 'partial' | 'fail' | 'info';
interface Check {
    label: string;
    state: CheckState;
    detail: string;
    filterId?: string;
}

/** A share of `total` as a checklist state: all pass, some, or none. */
function shareCheck(label: string, ok: number, total: number, filterId?: string): Check {
    const state: CheckState = !total ? 'info' : ok === total ? 'pass' : ok === 0 ? 'fail' : 'partial';
    return { label, state, detail: total ? `${pct(ok, total)}% (${fmt(ok)} of ${fmt(total)})` : 'Nothing to check', filterId: ok === total ? undefined : filterId };
}

/** First path segment, so /blog/a and /blog/b are one section. */
function sectionOf(url: string) {
    try {
        const first = new URL(url).pathname.split('/').filter(Boolean)[0];
        return first ? `/${first}/` : '/';
    } catch {
        return '/';
    }
}

/** Every tile and panel the viewer can hide, in display order and grouped by the heading they sit under. */
const WIDGET_GROUPS = [
    {
        heading: 'Summary',
        widgets: [
            { id: 'health', label: 'Site health' },
            { id: 'urls', label: 'URLs crawled' },
            { id: 'indexable', label: 'Indexable' },
            { id: 'errors', label: '4xx / 5xx / Failed' },
            { id: 'avg-response', label: 'Avg response time' },
            { id: 'avg-weight', label: 'Avg page weight' },
            { id: 'avg-co2', label: 'Avg CO2 per page' },
        ],
    },
    { heading: 'Issues', widgets: [{ id: 'issues', label: 'Issues by severity' }] },
    {
        heading: 'Crawlability & indexing',
        widgets: [
            { id: 'status', label: 'Status codes' },
            { id: 'indexability', label: 'Indexability' },
            { id: 'redirects', label: 'Redirect health' },
            { id: 'canonicals', label: 'Canonical health' },
            { id: 'depth', label: 'Crawl depth' },
            { id: 'content-types', label: 'Content types' },
        ],
    },
    {
        heading: 'Content',
        widgets: [
            { id: 'duplicates', label: 'Duplicate content' },
            { id: 'title-fit', label: 'Title & description fit' },
            { id: 'words', label: 'Word count' },
            { id: 'readability', label: 'Readability' },
            { id: 'freshness', label: 'Freshness' },
        ],
    },
    {
        heading: 'Site structure',
        widgets: [
            { id: 'sections', label: 'Site sections' },
            { id: 'inlinks', label: 'Internal linking' },
            { id: 'js', label: 'JavaScript dependency' },
            { id: 'top-pages', label: 'Top pages by link score' },
        ],
    },
    {
        heading: 'Performance, sustainability & setup',
        widgets: [
            { id: 'response-times', label: 'Response time' },
            { id: 'weight', label: 'Page weight & compression' },
            { id: 'carbon', label: 'Carbon rating' },
            { id: 'slowest', label: 'Slowest pages' },
            { id: 'checklist', label: 'Technical checklist' },
        ],
    },
] as const;

type WidgetGroup = (typeof WIDGET_GROUPS)[number];
type WidgetId = WidgetGroup['widgets'][number]['id'];
const WIDGET_LABELS = Object.fromEntries(WIDGET_GROUPS.flatMap((g) => g.widgets.map((w) => [w.id, w.label]))) as Record<WidgetId, string>;
const WIDGET_IDS = new Set<string>(Object.keys(WIDGET_LABELS));
export const HIDDEN_WIDGETS_KEY = 'yaka-seo.dashboard.hidden';

/** Hidden widget ids, kept in localStorage so the layout survives reloads. Storage can be unavailable or hold junk: then everything shows. */
function useHiddenWidgets() {
    const [hidden, setHidden] = useState<ReadonlySet<WidgetId>>(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(HIDDEN_WIDGETS_KEY) ?? '[]');
            // Unknown ids (a panel renamed or removed since) are dropped, so nothing stays hidden with no checkbox to show it.
            return new Set(Array.isArray(saved) ? (saved.filter((id) => typeof id === 'string' && WIDGET_IDS.has(id)) as WidgetId[]) : []);
        } catch {
            return new Set();
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem(HIDDEN_WIDGETS_KEY, JSON.stringify([...hidden]));
        } catch {
            // Not persisted; the choice still holds until the app closes.
        }
    }, [hidden]);
    const setShown = (id: WidgetId, shown: boolean) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (shown) next.delete(id);
            else next.add(id);
            return next;
        });
    return { hidden, setShown, showAll: () => setHidden(new Set()) };
}

function useStats(rows: PageResult[]) {
    return useMemo(() => {
        const ctx = filterContext(rows);
        const count = (id: string) => {
            const f = FILTERS.find((x) => x.id === id)!;
            return rows.filter((r) => f.test(r, ctx)).length;
        };
        const issueBar = (id: string, label?: string): Bar => {
            const f = FILTERS.find((x) => x.id === id)!;
            return { label: label ?? f.label, value: count(id), filterId: id, tone: f.severity ? SEVERITY_TONE[f.severity] : 'info' };
        };

        const html = rows.filter(isHtmlPage);
        const answered = rows.filter(isAnswered);
        const indexable = rows.filter((r) => r.indexable).length;

        // Health: the share of URLs with no error-level issue (the Ahrefs-style score: easy to explain and to move).
        const severityCounts = { error: count('severity-error'), warning: count('severity-warning'), notice: count('severity-notice') };
        const health = rows.length ? Math.round(((rows.length - severityCounts.error) / rows.length) * 100) : 0;
        const issuesBySeverity = Object.fromEntries(
            (['error', 'warning', 'notice'] as const).map((sev) => [
                sev,
                FILTERS.filter((f) => f.severity === sev)
                    .map((f) => issueBar(f.id))
                    .filter((b) => b.value > 0)
                    .sort((a, b) => b.value - a.value),
            ]),
        ) as Record<Severity, Bar[]>;

        const statusClass = (r: PageResult) => {
            if (isRobotsBlocked(r)) return 'Blocked';
            const s = r.status ?? 0;
            if (r.error !== null || s === 0) return 'Failed';
            return `${Math.floor(s / 100)}xx`;
        };
        const statusLook: Record<string, { label: string; tone: Tone; filterId?: string }> = {
            '1xx': { label: '1xx Informational', tone: 'info' },
            '2xx': { label: '2xx Success', tone: 'good' },
            '3xx': { label: '3xx Redirect', tone: 'warn', filterId: 'redirects' },
            '4xx': { label: '4xx Client error', tone: 'bad', filterId: 'errors' },
            '5xx': { label: '5xx Server error', tone: 'bad', filterId: 'errors' },
            Failed: { label: 'Failed (no response)', tone: 'bad', filterId: 'errors' },
            Blocked: { label: 'Blocked by robots.txt', tone: 'warn', filterId: 'noindex' },
        };
        const statuses: Bar[] = tally(rows.map(statusClass), 7)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((b) => ({ ...b, ...statusLook[b.label] }));

        // "Status 404", "Status 503"… grouped by class, so the chart stays a handful of bars.
        const indexability = tally(
            rows.map((r) => {
                if (r.indexable) return 'Indexable';
                const status = /^Status (\d)/.exec(r.indexabilityReason);
                if (status) return status[1] === '4' ? 'Client error (4xx)' : status[1] === '5' ? 'Server error (5xx)' : r.indexabilityReason;
                return r.indexabilityReason || 'Non-indexable';
            }),
        ).map((b) => (b.label === 'Indexable' ? b : { ...b, filterId: 'noindex' }));

        // Redirects: what kind, and whether they lead somewhere useful.
        const redirectRows = rows.filter((r) => r.redirectUrl !== null);
        const redirectTypes = tally(
            redirectRows.map((r) => (r.redirectType === 'HTTP Redirect' ? `${r.status} ${r.statusText}`.trim() : r.redirectType || 'Redirect')),
            9,
        );
        const redirectProblems = [issueBar('redirect-chain'), issueBar('redirect-loop'), issueBar('redirect-broken')];

        const canonicals: Bar[] = [
            { label: 'Self-referencing', value: html.filter((r) => r.canonical === r.url).length, tone: 'good' },
            issueBar('canonicalised'),
            issueBar('canonical-missing', 'Missing'),
            issueBar('canonical-broken'),
        ];

        const duplicates = [issueBar('dup-hash'), issueBar('near-duplicates'), issueBar('dup-title'), issueBar('dup-desc'), issueBar('dup-h1')];

        // Each page in exactly one band, checked in this order.
        const fit = (missing: string, short: string, wide: string): Bar[] => {
            const by = (id: string) => FILTERS.find((f) => f.id === id)!;
            const bands = [0, 0, 0, 0];
            for (const r of html) bands[by(missing).test(r, ctx) ? 0 : by(wide).test(r, ctx) ? 3 : by(short).test(r, ctx) ? 1 : 2]++;
            return [
                { label: 'Missing', value: bands[0], tone: 'bad', filterId: missing },
                { label: 'Too short', value: bands[1], tone: 'warn', filterId: short },
                { label: 'Good', value: bands[2], tone: 'good' },
                { label: 'Too long', value: bands[3], tone: 'warn', filterId: wide },
            ];
        };

        // Sections by first path segment: where the problems cluster.
        const sectionMap = new Map<string, PageResult[]>();
        for (const r of rows) {
            const key = sectionOf(r.url);
            const list = sectionMap.get(key);
            if (list) list.push(r);
            else sectionMap.set(key, [r]);
        }
        const sections = [...sectionMap]
            .map(([name, list]) => ({
                name,
                urls: list.length,
                errors: list.filter((r) => r.error !== null || (r.status ?? 0) >= 400).length,
                nonIndexable: list.filter((r) => !r.indexable).length,
                avgResponse: mean(list.map((r) => r.responseTimeMs).filter((t): t is number => t !== null)),
            }))
            .sort((a, b) => b.urls - a.urls)
            .slice(0, MAX_SECTIONS);

        const depthCounts = new Array<number>(MAX_DEPTH_COLUMN + 1).fill(0);
        for (const r of rows) depthCounts[Math.min(r.depth, MAX_DEPTH_COLUMN)]++;
        const lastDepth = depthCounts.findLastIndex((n) => n > 0);
        const depths = depthCounts.slice(0, lastDepth + 1).map((value, d) => ({ label: d === MAX_DEPTH_COLUMN ? `${d}+` : String(d), value }));

        const analysed = rows.some((r) => r.linkScore !== null);
        const inlinkBuckets = bucket(
            html.map((r) => r.uniqueInlinks).filter((n): n is number => n !== null),
            INLINK_BUCKETS,
        );

        const times = answered.map((r) => r.responseTimeMs).filter((t): t is number => t !== null);
        const weights = html.map((r) => r.totalTransferredBytes).filter((b): b is number => b !== null);
        const htmlSizes = html.filter((r) => r.sizeBytes !== null && r.transferredBytes !== null);
        const avgHtmlSize = mean(htmlSizes.map((r) => r.sizeBytes!));
        const avgHtmlTransferred = mean(htmlSizes.map((r) => r.transferredBytes!));
        const rated = rows.filter((r) => r.carbonRating);

        // Ages are measured from the crawl itself, not "now", so reopening old results doesn't shift them.
        const crawledAt = rows.reduce((latest, r) => Math.max(latest, Date.parse(r.crawlTimestamp) || 0), 0);
        const modified = html.map((r) => Date.parse(r.lastModified)).filter((t) => !Number.isNaN(t));
        const freshness = [...bucket(modified.map((t) => Math.max(0, crawledAt - t)), AGE_BUCKETS), { label: 'Not sent', value: html.length - modified.length }];

        const compressed = htmlSizes.filter((r) => !FILTERS.find((f) => f.id === 'uncompressed')!.test(r, ctx)).length;
        const checks: Check[] = [
            shareCheck('HTTPS', rows.filter((r) => r.url.startsWith('https:')).length, rows.length, 'http-urls'),
            shareCheck('HTTP/2 or HTTP/3', answered.filter((r) => r.httpVersion === '2' || r.httpVersion === '3').length, answered.length),
            shareCheck('Language declared', html.filter((r) => r.language).length, html.length, 'no-lang'),
            shareCheck('Canonical tag', html.filter((r) => r.canonical).length, html.length, 'canonical-missing'),
            shareCheck('Compressed HTML', compressed, htmlSizes.length, 'uncompressed'),
            { label: 'Sets cookies', state: 'info', detail: `${fmt(answered.filter((r) => r.cookies).length)} URLs` },
            { label: 'AMP versions', state: 'info', detail: `${fmt(html.filter((r) => r.amphtml).length)} pages` },
            { label: 'Mobile alternates', state: 'info', detail: `${fmt(html.filter((r) => r.mobileAlternate).length)} pages` },
        ];

        return {
            total: rows.length,
            htmlCount: html.length,
            indexable,
            errors: count('errors'),
            redirects: redirectRows.length,
            health,
            severityCounts,
            issuesBySeverity,
            statuses,
            indexability,
            redirectTypes,
            redirectProblems,
            canonicals,
            duplicates,
            titleFit: fit('title-missing', 'title-short', 'title-wide'),
            descFit: fit('desc-missing', 'desc-short', 'desc-wide'),
            words: bucket(
                html.map((r) => r.wordCount),
                WORD_BUCKETS,
            ),
            readability: READABILITY_BANDS.map((band) => ({ label: band, value: html.filter((r) => r.readability === band).length })),
            sections,
            depths,
            analysed,
            inlinkBuckets,
            weakInlinks: issueBar('weak-inlinks'),
            jsDependency: [issueBar('js-outlinks', 'Pages with JS-only links'), issueBar('js-only-inlinks', 'Pages only linked via JS')],
            jsExternal: html.filter((r) => r.uniqueExternalJsOutlinks > 0).length,
            topPages: analysed ? [...html].sort((a, b) => (b.linkScore ?? 0) - (a.linkScore ?? 0)).slice(0, 8) : [],
            avgResponse: mean(times),
            responseTimes: bucket(times, RESPONSE_BUCKETS),
            slowest: [...answered].sort((a, b) => (b.responseTimeMs ?? 0) - (a.responseTimeMs ?? 0)).slice(0, 8),
            avgWeight: mean(weights),
            weightBuckets: bucket(weights, WEIGHT_BUCKETS),
            avgHtmlSize,
            avgHtmlTransferred,
            uncompressed: issueBar('uncompressed'),
            heavy: issueBar('heavy'),
            avgCo2: mean(html.map((r) => r.co2Mg).filter((c): c is number => c !== null)),
            carbon: CARBON_RATINGS.map((rating) => ({ label: rating, value: rated.filter((r) => r.carbonRating === rating).length })),
            ratedCount: rated.length,
            contentTypes: tally(rows.filter((r) => r.error === null).map((r) => (r.contentType ?? '').split(';')[0].trim().toLowerCase() || '(none)')),
            freshness,
            checks,
        };
    }, [rows]);
}

export function Dashboard({ rows, renderJs, onOpen }: Props) {
    const s = useStats(rows);
    const { hidden, setShown, showAll } = useHiddenWidgets();
    const [customizing, setCustomizing] = useState(false);

    if (rows.length === 0) {
        return <div className="flex flex-1 items-center justify-center glass rounded-[var(--radius-lg)] text-muted">No URLs crawled yet.</div>;
    }

    const healthTone: Tone = s.health >= 80 ? 'good' : s.health >= 50 ? 'warn' : 'bad';
    const healthWord = s.health >= 80 ? 'Good' : s.health >= 50 ? 'Needs work' : 'Poor';
    // Dense flow lets a later panel fill the gap a wide panel leaves.
    const grid = 'grid shrink-0 grid-flow-row-dense grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3';
    const show = (id: WidgetId) => !hidden.has(id);
    // A heading only shows while something under it does.
    const anyShown = (heading: WidgetGroup['heading']) => WIDGET_GROUPS.find((g) => g.heading === heading)!.widgets.some((w) => show(w.id));
    const panel = (id: WidgetId, subtitle: string, children: ReactNode, wide?: boolean) =>
        show(id) && (
            <Panel title={WIDGET_LABELS[id]} subtitle={subtitle} wide={wide} onHide={() => setShown(id, false)}>
                {children}
            </Panel>
        );
    const tile = (id: WidgetId, children: ReactNode) =>
        show(id) && (
            <Hideable label={WIDGET_LABELS[id]} onHide={() => setShown(id, false)}>
                {children}
            </Hideable>
        );

    return (
        <div className="dashboard glass-backdrop flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
            <div className="flex shrink-0 items-center justify-end gap-3">
                {hidden.size > 0 && (
                    <button type="button" className="border-0 bg-transparent p-0 text-[13px] text-info hover:underline" onClick={showAll}>
                        Show all ({fmt(hidden.size)} hidden)
                    </button>
                )}
                <button
                    type="button"
                    className={`flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2 ${customizing ? 'border-info' : ''}`}
                    aria-expanded={customizing}
                    aria-controls="dashboard-customize"
                    onClick={() => setCustomizing((c) => !c)}
                >
                    <SlidersHorizontal size={15} aria-hidden />
                    Customize
                </button>
            </div>
            {customizing && <CustomizePanel hidden={hidden} setShown={setShown} showAll={showAll} onClose={() => setCustomizing(false)} />}

            {hidden.size === WIDGET_IDS.size && <Empty>Every panel is hidden. Use Customize or Show all to bring them back.</Empty>}

            {anyShown('Summary') && (
                <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                    {tile('health', <HealthTile score={s.health} tone={healthTone} word={healthWord} counts={s.severityCounts} onOpen={onOpen} />)}
                    {tile('urls', <StatTile icon={Globe} label="URLs crawled" value={fmt(s.total)} detail={`${fmt(s.htmlCount)} HTML pages`} />)}
                    {tile(
                        'indexable',
                        <StatTile
                            icon={CircleCheck}
                            label="Indexable"
                            value={`${pct(s.indexable, s.total)}%`}
                            detail={`${fmt(s.indexable)} of ${fmt(s.total)} URLs`}
                            meter={s.total ? s.indexable / s.total : 0}
                        />,
                    )}
                    {tile('errors', <StatTile icon={CircleAlert} label="4xx / 5xx / Failed" value={fmt(s.errors)} detail={`${fmt(s.redirects)} redirects`} onClick={() => onOpen('errors')} />)}
                    {tile('avg-response', <StatTile icon={Activity} label="Avg response time" value={s.avgResponse === null ? '–' : formatMs(s.avgResponse)} detail="all answered URLs" />)}
                    {tile('avg-weight', <StatTile icon={Gauge} label="Avg page weight" value={s.avgWeight === null ? '–' : formatBytes(s.avgWeight)} detail="HTML pages, incl. resources" />)}
                    {tile('avg-co2', <StatTile icon={Leaf} label="Avg CO2 per page" value={s.avgCo2 === null ? '–' : `${s.avgCo2.toFixed(2)} mg`} detail="Sustainable Web Design model" />)}
                </div>
            )}

            {anyShown('Issues') && <SectionHeading>Issues</SectionHeading>}
            {panel(
                'issues',
                'URLs affected by each issue. Click one to see its URLs',
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    {(['error', 'warning', 'notice'] as const).map((sev) => {
                        const Icon = SEVERITY_ICON[sev];
                        return (
                            <div key={sev} className="min-w-0">
                                <h4 className={`tone-${SEVERITY_TONE[sev]} m-0 mb-1 flex items-center gap-2 px-2 text-[13px] font-semibold text-(--tone)`}>
                                    <Icon size={16} aria-hidden />
                                    {SEVERITY_LABELS[sev]}
                                    <span className="font-normal text-muted">{fmt(s.severityCounts[sev])} URLs</span>
                                </h4>
                                {s.issuesBySeverity[sev].length ? <BarList bars={s.issuesBySeverity[sev]} total={s.total} onOpen={onOpen} /> : <Empty>None found.</Empty>}
                            </div>
                        );
                    })}
                </div>,
            )}

            {anyShown('Crawlability & indexing') && (
                <>
                    <SectionHeading>Crawlability &amp; indexing</SectionHeading>
                    <div className={grid}>
                        {panel('status', 'URLs by response class', <BarList bars={s.statuses} total={s.total} onOpen={onOpen} />)}
                        {panel('indexability', "Why URLs can or can't be indexed", <BarList bars={s.indexability} total={s.total} onOpen={onOpen} />)}
                        {panel(
                            'redirects',
                            'Redirect types, and where redirects lead',
                            s.redirects ? (
                                <>
                                    <BarList bars={s.redirectTypes} total={s.redirects} />
                                    <div className="my-2 border-t border-line" />
                                    <BarList bars={s.redirectProblems} total={s.redirects} onOpen={onOpen} />
                                </>
                            ) : (
                                <Empty>No redirects found.</Empty>
                            ),
                        )}
                        {panel(
                            'canonicals',
                            'rel=canonical on 2xx HTML pages',
                            s.htmlCount ? <BarList bars={s.canonicals} total={s.htmlCount} onOpen={onOpen} /> : <Empty>No HTML pages.</Empty>,
                        )}
                        {panel('depth', 'Clicks from the start URL', <ColumnChart bars={s.depths} unit="URLs" axisLabel="Depth" />)}
                        {panel('content-types', 'Responses by Content-Type', <BarList bars={s.contentTypes} total={s.contentTypes.reduce((a, b) => a + b.value, 0)} />)}
                    </div>
                </>
            )}

            {anyShown('Content') && (
                <>
                    <SectionHeading>Content</SectionHeading>
                    <div className={grid}>
                        {panel(
                            'duplicates',
                            '2xx HTML pages sharing content or tags',
                            <>
                                <BarList bars={s.duplicates} total={s.htmlCount} onOpen={onOpen} />
                                {!s.analysed && <p className="m-0 mt-2 px-2 text-[12px] text-muted">Near duplicates are found when the crawl finishes.</p>}
                            </>,
                        )}
                        {panel(
                            'title-fit',
                            "Length in Google's desktop results",
                            <div className="flex flex-col gap-4">
                                <StackedBar label="Titles" parts={s.titleFit} total={s.htmlCount} onOpen={onOpen} />
                                <StackedBar label="Meta descriptions" parts={s.descFit} total={s.htmlCount} onOpen={onOpen} />
                            </div>,
                            true,
                        )}
                        {panel('words', 'Words per 2xx HTML page', <ColumnChart bars={s.words} unit="pages" axisLabel="Words" />)}
                        {panel('readability', 'Flesch reading ease band (English formula)', <ColumnChart bars={s.readability} unit="pages" />)}
                        {panel('freshness', 'Last-Modified header age at crawl time, 2xx HTML pages', <ColumnChart bars={s.freshness} unit="pages" />)}
                    </div>
                </>
            )}

            {anyShown('Site structure') && (
                <>
                    <SectionHeading>Site structure</SectionHeading>
                    <div className={grid}>
                        {panel('sections', 'URLs by first folder. Click a section to see its URLs', <SectionTable sections={s.sections} onOpen={onOpen} />, true)}
                        {panel(
                            'inlinks',
                            'Distinct pages linking to each 2xx HTML page',
                            s.analysed ? (
                                <>
                                    <ColumnChart bars={s.inlinkBuckets} unit="pages" axisLabel="Linking pages" />
                                    <BarList bars={[s.weakInlinks]} total={s.htmlCount} onOpen={onOpen} />
                                </>
                            ) : (
                                <Empty>Inlinks are counted when the crawl finishes.</Empty>
                            ),
                        )}
                        {panel(
                            'js',
                            'Links that only exist after JavaScript runs',
                            !renderJs ? (
                                <Empty>Needs Render JavaScript mode (fast mode never runs scripts).</Empty>
                            ) : (
                                <>
                                    <BarList bars={s.jsDependency} total={s.htmlCount} onOpen={onOpen} />
                                    <p className="m-0 mt-2 px-2 text-[12px] text-muted">{fmt(s.jsExternal)} pages have external links only added by JavaScript.</p>
                                    {!s.analysed && <p className="m-0 mt-1 px-2 text-[12px] text-muted">JS-only inlinks are counted when the crawl finishes.</p>}
                                </>
                            ),
                        )}
                        {panel(
                            'top-pages',
                            'Internal PageRank, 0–100',
                            s.analysed ? (
                                <PageTable rows={s.topPages} valueLabel="Link score" value={(r) => String(r.linkScore ?? '')} extraLabel="Inlinks" extra={(r) => fmt(r.inlinks ?? 0)} />
                            ) : (
                                <Empty>Link scores are calculated when the crawl finishes.</Empty>
                            ),
                            true,
                        )}
                    </div>
                </>
            )}

            {anyShown('Performance, sustainability & setup') && (
                <>
                    <SectionHeading>Performance, sustainability &amp; setup</SectionHeading>
                    <div className={grid}>
                        {panel('response-times', 'Per URL, answered requests', <ColumnChart bars={s.responseTimes} unit="URLs" />)}
                        {panel(
                            'weight',
                            renderJs ? 'Per page, incl. resources' : 'Per page, HTML only (fast mode)',
                            <>
                                <ColumnChart bars={s.weightBuckets} unit="pages" />
                                {s.avgHtmlSize !== null && s.avgHtmlTransferred !== null && (
                                    <p className="m-0 mt-2 px-2 text-[12px] text-muted">
                                        Avg HTML {formatBytes(s.avgHtmlSize)}, {formatBytes(s.avgHtmlTransferred)} transferred ({pct(s.avgHtmlSize - s.avgHtmlTransferred, s.avgHtmlSize)}% saved by
                                        compression)
                                    </p>
                                )}
                                <BarList bars={[s.uncompressed, s.heavy]} total={s.htmlCount} onOpen={onOpen} />
                            </>,
                        )}
                        {panel(
                            'carbon',
                            'Per page, Sustainable Web Design model',
                            s.ratedCount ? <ColumnChart bars={s.carbon} unit="pages" /> : <Empty>Carbon ratings need Render JavaScript mode (page resources are measured).</Empty>,
                        )}
                        {panel(
                            'slowest',
                            'Highest response time',
                            <PageTable rows={s.slowest} valueLabel="Time" value={(r) => formatMs(r.responseTimeMs ?? 0)} extraLabel="Status" extra={(r) => String(r.status ?? 'ERR')} />,
                        )}
                        {panel('checklist', 'Site-wide setup, share of URLs that pass', <Checklist checks={s.checks} onOpen={onOpen} />, true)}
                    </div>
                </>
            )}
        </div>
    );
}

/** A checkbox per tile and panel, grouped under the dashboard's headings. */
function CustomizePanel({
    hidden,
    setShown,
    showAll,
    onClose,
}: {
    hidden: ReadonlySet<WidgetId>;
    setShown: (id: WidgetId, shown: boolean) => void;
    showAll: () => void;
    onClose: () => void;
}) {
    return (
        <section
            id="dashboard-customize"
            aria-label="Customize dashboard"
            className="shrink-0 glass rounded-[var(--radius-lg)] px-4 py-3"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
        >
            <div className="mb-3 flex items-center gap-3">
                <h3 className="m-0 text-[15px] font-semibold text-fg">Show on dashboard</h3>
                <span className="text-[12px] text-muted">Remembered on this computer</span>
                <button type="button" className="ml-auto border-0 bg-transparent p-0 text-[13px] text-info hover:underline" onClick={showAll} disabled={hidden.size === 0}>
                    Show all
                </button>
                <button type="button" className="px-3 py-1 text-[13px] hover:bg-surface-2" onClick={onClose}>
                    Done
                </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
                {WIDGET_GROUPS.map((g) => (
                    <fieldset key={g.heading} className="m-0 min-w-0 border-0 p-0">
                        <legend className="mb-1 p-0 text-[12px] font-semibold tracking-wider text-muted uppercase">{g.heading}</legend>
                        {g.widgets.map((w) => (
                            <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] px-1 py-0.5 text-[13px] text-fg hover:bg-surface-2">
                                <input type="checkbox" className="size-4 shrink-0 cursor-pointer p-0 accent-info" checked={!hidden.has(w.id)} onChange={(e) => setShown(w.id, e.target.checked)} />
                                <span className="truncate">{w.label}</span>
                            </label>
                        ))}
                    </fieldset>
                ))}
            </div>
        </section>
    );
}

/** Corner button that hides one tile or panel; it appears on hover or keyboard focus. */
function HideButton({ label, onHide }: { label: string; onHide: () => void }) {
    return (
        <button
            type="button"
            className="absolute top-2 right-2 z-10 flex size-7 items-center justify-center border-0 bg-transparent p-0 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100"
            aria-label={`Hide ${label}`}
            title={`Hide ${label}`}
            onClick={onHide}
        >
            <EyeOff size={15} aria-hidden />
        </button>
    );
}

/** Wraps a tile (which may itself be a button) so the hide button sits beside it, not nested inside it. */
function Hideable({ label, onHide, children }: { label: string; onHide: () => void; children: ReactNode }) {
    return (
        <div className="group relative flex *:flex-1">
            {children}
            <HideButton label={label} onHide={onHide} />
        </div>
    );
}

function SectionHeading({ children }: { children: ReactNode }) {
    return <h2 className="m-0 mt-2 shrink-0 text-[12px] font-semibold tracking-wider text-muted uppercase">{children}</h2>;
}

function HealthTile({
    score,
    tone,
    word,
    counts,
    onOpen,
}: {
    score: number;
    tone: Tone;
    word: string;
    counts: Record<Severity, number>;
    onOpen: (filterId: string) => void;
}) {
    return (
        <div className={`tone-${tone} glass rounded-[var(--radius-lg)] px-4 py-3`}>
            <div className="flex items-center gap-2 text-muted">
                <HeartPulse size={16} aria-hidden />
                <span className="text-[13px]">Site health</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[28px] leading-tight font-semibold text-fg">{score}</span>
                <span className="text-[13px] text-muted">/ 100</span>
                <span className="ml-auto text-[13px] font-semibold text-(--tone)">{word}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Site health">
                <div className="h-full rounded-full bg-(--tone)" style={{ width: `${score}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2.5 text-[12px]">
                {(['error', 'warning', 'notice'] as const).map((sev) => (
                    <button
                        key={sev}
                        type="button"
                        className={`tone-${SEVERITY_TONE[sev]} border-0 bg-transparent p-0 whitespace-nowrap text-muted hover:text-(--tone) hover:underline`}
                        onClick={() => onOpen(`severity-${sev}`)}
                    >
                        <span className="font-semibold text-(--tone)">{fmt(counts[sev])}</span> {SEVERITY_LABELS[sev].toLowerCase()}
                    </button>
                ))}
            </div>
        </div>
    );
}

function StatTile({ icon: Icon, label, value, detail, meter, onClick }: { icon: LucideIcon; label: string; value: string; detail: string; meter?: number; onClick?: () => void }) {
    const body = (
        <>
            <div className="flex items-center gap-2 text-muted">
                <Icon size={16} aria-hidden />
                <span className="text-[13px]">{label}</span>
            </div>
            <div className="mt-1 text-[28px] leading-tight font-semibold text-fg">{value}</div>
            {meter !== undefined && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(meter * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
                    <div className="h-full rounded-full bg-info" style={{ width: `${meter * 100}%` }} />
                </div>
            )}
            <div className="mt-1 text-[12px] text-muted">{detail}</div>
        </>
    );
    const box = 'glass rounded-[var(--radius-lg)] px-4 py-3 text-left';
    return onClick ? (
        <button type="button" className={`${box} flex flex-col justify-start hover:border-info/60 hover:brightness-110`} onClick={onClick}>
            {body}
        </button>
    ) : (
        <div className={box}>{body}</div>
    );
}

function Panel({ title, subtitle, wide, onHide, children }: { title: string; subtitle: string; wide?: boolean; onHide: () => void; children: ReactNode }) {
    return (
        <section className={`group relative flex min-h-[230px] shrink-0 flex-col glass rounded-[var(--radius-lg)] px-4 py-3 ${wide ? 'lg:col-span-2' : ''}`}>
            <HideButton label={title} onHide={onHide} />
            <h3 className="m-0 pr-8 text-[15px] font-semibold text-fg">{title}</h3>
            <p className="m-0 mb-3 text-[12px] text-muted">{subtitle}</p>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </section>
    );
}

function Empty({ children }: { children: ReactNode }) {
    return <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-muted">{children}</div>;
}

/** Horizontal bars: label, bar (scaled to the largest), value and share. Clickable when a bar has a filter. */
function BarList({ bars, total, onOpen }: { bars: Bar[]; total: number; onOpen?: (filterId: string) => void }) {
    const max = Math.max(1, ...bars.map((b) => b.value));
    return (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {bars.map((b) => {
                const clickable = Boolean(onOpen && b.filterId && b.value > 0);
                const content = (
                    <>
                        <span className="truncate text-[13px] text-fg" title={b.label}>
                            {b.label}
                        </span>
                        <span className="h-3 overflow-hidden">
                            <span
                                className={`tone-${b.tone ?? 'info'} block h-full rounded-r-[4px] bg-(--tone)`}
                                style={{ width: `${Math.max(b.value ? 1.5 : 0, (b.value / max) * 100)}%` }}
                            />
                        </span>
                        <span className="text-right text-[13px] tabular-nums text-fg">{fmt(b.value)}</span>
                        <span className="text-right text-[12px] tabular-nums text-muted">{pct(b.value, total)}%</span>
                    </>
                );
                const grid = 'grid w-full grid-cols-[minmax(0,11rem)_1fr_3.5rem_3.25rem] items-center gap-3 rounded-[var(--radius)] px-2 py-1.5';
                return (
                    <li key={b.label}>
                        {clickable ? (
                            <button
                                type="button"
                                className={`${grid} border-0 bg-transparent text-left hover:bg-surface-2`}
                                onClick={() => onOpen!(b.filterId!)}
                                title={`${b.label}: ${fmt(b.value)} (show URLs)`}
                            >
                                {content}
                            </button>
                        ) : (
                            <div className={grid}>{content}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** One 100% bar split into labelled parts; the legend below carries the labels, counts and links. */
function StackedBar({ label, parts, total, onOpen }: { label: string; parts: Bar[]; total: number; onOpen: (filterId: string) => void }) {
    return (
        <div>
            <div className="mb-1.5 px-2 text-[13px] text-fg">{label}</div>
            <div className="mx-2 flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
                {parts
                    .filter((p) => p.value > 0)
                    .map((p) => (
                        <span
                            key={p.label}
                            className={`tone-${p.tone ?? 'info'} block h-full bg-(--tone)`}
                            style={{ width: `${pct(p.value, total)}%` }}
                            title={`${p.label}: ${fmt(p.value)} (${pct(p.value, total)}%)`}
                        />
                    ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-1 gap-y-0.5">
                {parts.map((p) => {
                    const content = (
                        <>
                            <span className={`tone-${p.tone ?? 'info'} inline-block size-2.5 rounded-full bg-(--tone)`} aria-hidden />
                            <span className="text-fg">{p.label}</span>
                            <span className="tabular-nums text-muted">
                                {fmt(p.value)} ({pct(p.value, total)}%)
                            </span>
                        </>
                    );
                    const cls = 'flex items-center gap-1.5 rounded-[var(--radius)] px-2 py-1 text-[12px]';
                    return p.filterId && p.value > 0 ? (
                        <button key={p.label} type="button" className={`${cls} border-0 bg-transparent hover:bg-surface-2`} onClick={() => onOpen(p.filterId!)}>
                            {content}
                        </button>
                    ) : (
                        <span key={p.label} className={cls}>
                            {content}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

/** Vertical columns from one baseline, value on each cap, with a hover tooltip. */
function ColumnChart({ bars, unit, axisLabel }: { bars: Bar[]; unit: string; axisLabel?: string }) {
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(1, ...bars.map((b) => b.value));
    const total = bars.reduce((a, b) => a + b.value, 0);
    return (
        <div className="flex flex-1 flex-col">
            <div className="relative flex h-40 items-end gap-1 border-b border-line" onMouseLeave={() => setHover(null)}>
                {bars.map((b, i) => (
                    <div
                        key={b.label}
                        className="relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t-[4px] hover:bg-surface-2"
                        onMouseEnter={() => setHover(i)}
                        onFocus={() => setHover(i)}
                        onBlur={() => setHover(null)}
                        tabIndex={0}
                        aria-label={`${axisLabel ? `${axisLabel} ` : ''}${b.label}: ${fmt(b.value)} ${unit}`}
                    >
                        <span className="mb-1 text-[11px] tabular-nums text-muted">{b.value ? fmt(b.value) : ''}</span>
                        <span className="tone-info block w-full max-w-6 rounded-t-[4px] bg-(--tone)" style={{ height: `${(b.value / max) * 82}%` }} />
                        {hover === i && (
                            <span className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-lg">
                                <strong className="text-fg">{fmt(b.value)}</strong>{' '}
                                <span className="text-muted">
                                    {unit} · {axisLabel ? `${axisLabel} ` : ''}
                                    {b.label} · {pct(b.value, total)}%
                                </span>
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div className="flex gap-1 pt-1">
                {bars.map((b) => (
                    <span key={b.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted" title={b.label}>
                        {b.label}
                    </span>
                ))}
            </div>
            {axisLabel && <div className="pt-0.5 text-center text-[11px] text-muted">{axisLabel}</div>}
        </div>
    );
}

const CHECK_LOOK: Record<CheckState, { icon: LucideIcon; tone: Tone; word: string }> = {
    pass: { icon: CircleCheck, tone: 'good', word: 'Pass' },
    partial: { icon: TriangleAlert, tone: 'warn', word: 'Partial' },
    fail: { icon: CircleX, tone: 'bad', word: 'Missing' },
    info: { icon: CircleMinus, tone: 'neutral', word: 'Info' },
};

function Checklist({ checks, onOpen }: { checks: Check[]; onOpen: (filterId: string) => void }) {
    return (
        <ul className="m-0 flex list-none flex-col p-0">
            {checks.map((c) => {
                const { icon: Icon, tone, word } = CHECK_LOOK[c.state];
                const content = (
                    <>
                        <Icon size={16} className="shrink-0 text-(--tone)" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-fg">{c.label}</span>
                        <span className="tabular-nums text-muted">{c.detail}</span>
                        <span className="w-14 text-right text-[12px] font-semibold text-(--tone)">{word}</span>
                    </>
                );
                const cls = `tone-${tone} flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2 py-1.5 text-left text-[13px]`;
                return (
                    <li key={c.label} className="border-t border-line/60 first:border-t-0">
                        {c.filterId ? (
                            <button type="button" className={`${cls} border-0 bg-transparent hover:bg-surface-2`} onClick={() => onOpen(c.filterId!)} title={`${c.label}: show URLs that fail`}>
                                {content}
                            </button>
                        ) : (
                            <div className={cls}>{content}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

interface SectionStats {
    name: string;
    urls: number;
    errors: number;
    nonIndexable: number;
    avgResponse: number | null;
}

function SectionTable({ sections, onOpen }: { sections: SectionStats[]; onOpen: (filterId: string, search?: string) => void }) {
    const max = Math.max(1, ...sections.map((s) => s.urls));
    return (
        <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
                <tr className="text-left text-[12px] text-muted">
                    <th className="pb-1.5 font-normal">Section</th>
                    <th className="w-[30%] pb-1.5 font-normal">URLs</th>
                    <th className="w-24 pb-1.5 text-right font-normal">4xx / 5xx</th>
                    <th className="w-28 pb-1.5 text-right font-normal">Non-indexable</th>
                    <th className="w-24 pb-1.5 text-right font-normal">Avg time</th>
                </tr>
            </thead>
            <tbody>
                {sections.map((s) => (
                    <tr key={s.name} className="border-t border-line/60">
                        <td className="truncate py-1 pr-2">
                            {s.name === '/' ? (
                                <span className="px-1 text-fg">/ (root)</span>
                            ) : (
                                <button type="button" className="max-w-full truncate rounded-[var(--radius)] border-0 bg-transparent px-1 text-left text-info hover:underline" onClick={() => onOpen('all', s.name)}>
                                    {s.name}
                                </button>
                            )}
                        </td>
                        <td className="py-1">
                            <span className="flex items-center gap-2">
                                <span className="h-2.5 min-w-0 flex-1">
                                    <span className="tone-info block h-full rounded-r-[4px] bg-(--tone)" style={{ width: `${(s.urls / max) * 100}%` }} />
                                </span>
                                <span className="w-10 text-right tabular-nums text-fg">{fmt(s.urls)}</span>
                            </span>
                        </td>
                        <td className={`py-1 text-right tabular-nums ${s.errors ? 'text-bad' : 'text-muted'}`}>
                            {fmt(s.errors)} <span className="text-[11px] text-muted">({pct(s.errors, s.urls)}%)</span>
                        </td>
                        <td className="py-1 text-right tabular-nums text-fg">{fmt(s.nonIndexable)}</td>
                        <td className="py-1 text-right tabular-nums text-muted">{s.avgResponse === null ? '–' : formatMs(s.avgResponse)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function PageTable({
    rows,
    valueLabel,
    value,
    extraLabel,
    extra,
}: {
    rows: PageResult[];
    valueLabel: string;
    value: (r: PageResult) => string;
    extraLabel: string;
    extra: (r: PageResult) => string;
}) {
    return (
        <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
                <tr className="text-left text-[12px] text-muted">
                    <th className="pb-1.5 font-normal">URL</th>
                    <th className="w-20 pb-1.5 text-right font-normal">{valueLabel}</th>
                    <th className="w-16 pb-1.5 text-right font-normal">{extraLabel}</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => {
                    const path = r.url.replace(/^https?:\/\/[^/]+/, '') || '/';
                    return (
                        <tr key={r.url} className="border-t border-line/60">
                            <td className="truncate py-1.5 pr-2 text-fg" title={r.url}>
                                {path}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-fg">{value(r)}</td>
                            <td className="py-1.5 text-right tabular-nums text-muted">{extra(r)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
