import { useMemo, useState, type ReactNode } from 'react';
import { Activity, CircleAlert, CircleCheck, Gauge, Globe, Leaf, type LucideIcon } from 'lucide-react';
import type { PageResult } from '@shared/types';
import { FILTERS } from './filters';

/*
 * Crawl summary built from the same rows as the results table (which stays the full, accessible view of every value).
 * Single-series charts use one hue (--info); the status chart uses the status tones, always next to a text label.
 */

interface Props {
    rows: PageResult[];
    /** Opens the results table with this issue filter. */
    onOpenFilter: (filterId: string) => void;
}

type Tone = 'info' | 'good' | 'warn' | 'bad';
interface Bar {
    label: string;
    value: number;
    tone?: Tone;
    /** Clicking the bar opens the table filtered to it. */
    filterId?: string;
}

const isHtmlPage = (r: PageResult) => r.error === null && (r.contentType ?? '').includes('html') && (r.status ?? 0) >= 200 && (r.status ?? 0) < 300;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const fmt = (n: number) => n.toLocaleString('en-US');

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

const RESPONSE_BUCKETS: { label: string; max: number }[] = [
    { label: '< 250 ms', max: 250 },
    { label: '250–500 ms', max: 500 },
    { label: '0.5–1 s', max: 1000 },
    { label: '1–2 s', max: 2000 },
    { label: '2–5 s', max: 5000 },
    { label: '5 s +', max: Infinity },
];
const CARBON_RATINGS = ['A+', 'A', 'B', 'C', 'D', 'E', 'F'];
const MAX_DEPTH_COLUMN = 10;

function useStats(rows: PageResult[]) {
    return useMemo(() => {
        const html = rows.filter(isHtmlPage);
        const answered = rows.filter((r) => r.error === null && r.status !== null);
        const indexable = rows.filter((r) => r.indexable).length;
        const errors = rows.filter((r) => r.error !== null || (r.status ?? 0) >= 400).length;

        const statusClass = (r: PageResult) => {
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
        };
        const statuses: Bar[] = tally(rows.map(statusClass), 6)
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

        const contentTypes = tally(rows.filter((r) => r.error === null).map((r) => (r.contentType ?? '').split(';')[0].trim().toLowerCase() || '(none)'));

        const issues: Bar[] = FILTERS.filter((f) => f.id !== 'all')
            .map((f) => ({ label: f.label, value: rows.filter(f.test).length, filterId: f.id }))
            .filter((b) => b.value > 0)
            .sort((a, b) => b.value - a.value);

        const depthCounts = new Array<number>(MAX_DEPTH_COLUMN + 1).fill(0);
        for (const r of rows) depthCounts[Math.min(r.depth, MAX_DEPTH_COLUMN)]++;
        const lastDepth = depthCounts.findLastIndex((n) => n > 0);
        const depths = depthCounts.slice(0, lastDepth + 1).map((value, d) => ({ label: d === MAX_DEPTH_COLUMN ? `${d}+` : String(d), value }));

        const times = answered.map((r) => r.responseTimeMs).filter((t): t is number => t !== null);
        const responseTimes = RESPONSE_BUCKETS.map((b, i) => ({
            label: b.label,
            value: times.filter((t) => t < b.max && t >= (RESPONSE_BUCKETS[i - 1]?.max ?? 0)).length,
        }));

        const rated = rows.filter((r) => r.carbonRating);
        const carbon = CARBON_RATINGS.map((rating) => ({ label: rating, value: rated.filter((r) => r.carbonRating === rating).length }));

        const weights = html.map((r) => r.totalTransferredBytes).filter((b): b is number => b !== null);
        const co2 = html.map((r) => r.co2Mg).filter((c): c is number => c !== null);
        const analysed = rows.some((r) => r.linkScore !== null);

        return {
            total: rows.length,
            htmlCount: html.length,
            indexable,
            errors,
            redirects: rows.filter((r) => r.redirectUrl !== null).length,
            avgResponse: mean(times),
            slowest: [...answered].sort((a, b) => (b.responseTimeMs ?? 0) - (a.responseTimeMs ?? 0)).slice(0, 8),
            avgWeight: mean(weights),
            avgCo2: mean(co2),
            statuses,
            indexability,
            contentTypes,
            issues,
            depths,
            responseTimes,
            carbon,
            ratedCount: rated.length,
            analysed,
            topPages: analysed ? [...html].sort((a, b) => (b.linkScore ?? 0) - (a.linkScore ?? 0)).slice(0, 8) : [],
        };
    }, [rows]);
}

export function Dashboard({ rows, onOpenFilter }: Props) {
    const s = useStats(rows);

    if (rows.length === 0) {
        return <div className="flex flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-line bg-surface text-muted">No URLs crawled yet.</div>;
    }

    return (
        <div className="dashboard flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
            <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <StatTile icon={Globe} label="URLs crawled" value={fmt(s.total)} detail={`${fmt(s.htmlCount)} HTML pages`} />
                <StatTile
                    icon={CircleCheck}
                    label="Indexable"
                    value={`${pct(s.indexable, s.total)}%`}
                    detail={`${fmt(s.indexable)} of ${fmt(s.total)} URLs`}
                    meter={s.total ? s.indexable / s.total : 0}
                />
                <StatTile
                    icon={CircleAlert}
                    label="4xx / 5xx / Failed"
                    value={fmt(s.errors)}
                    detail={`${fmt(s.redirects)} redirects`}
                    onClick={() => onOpenFilter('errors')}
                />
                <StatTile icon={Activity} label="Avg response time" value={s.avgResponse === null ? '–' : formatMs(s.avgResponse)} detail="all answered URLs" />
                <StatTile
                    icon={Gauge}
                    label="Avg page weight"
                    value={s.avgWeight === null ? '–' : formatBytes(s.avgWeight)}
                    detail="HTML pages, incl. resources"
                />
                <StatTile icon={Leaf} label="Avg CO2 per page" value={s.avgCo2 === null ? '–' : `${s.avgCo2.toFixed(2)} mg`} detail="Sustainable Web Design model" />
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                <Panel title="Status codes" subtitle="URLs by response class">
                    <BarList bars={s.statuses} total={s.total} onOpen={onOpenFilter} />
                </Panel>
                <Panel title="Indexability" subtitle="Why URLs can or can't be indexed">
                    <BarList bars={s.indexability} total={s.total} onOpen={onOpenFilter} />
                </Panel>
                <Panel title="Top issues" subtitle="Click an issue to see its URLs">
                    {s.issues.length ? <BarList bars={s.issues.slice(0, 8)} total={s.total} onOpen={onOpenFilter} /> : <Empty>No issues found.</Empty>}
                </Panel>
                <Panel title="Crawl depth" subtitle="Clicks from the start URL">
                    <ColumnChart bars={s.depths} unit="URLs" axisLabel="Depth" />
                </Panel>
                <Panel title="Response time" subtitle="Per URL, answered requests">
                    <ColumnChart bars={s.responseTimes} unit="URLs" />
                </Panel>
                <Panel title="Carbon rating" subtitle="Per page, Sustainable Web Design model">
                    {s.ratedCount ? <ColumnChart bars={s.carbon} unit="pages" /> : <Empty>Carbon ratings need Render JavaScript mode (page resources are measured).</Empty>}
                </Panel>
                <Panel title="Content types" subtitle="Responses by Content-Type">
                    <BarList bars={s.contentTypes} total={s.contentTypes.reduce((a, b) => a + b.value, 0)} />
                </Panel>
                <Panel title="Top pages by link score" subtitle="Internal PageRank, 0–100">
                    {s.analysed ? (
                        <PageTable rows={s.topPages} valueLabel="Link score" value={(r) => String(r.linkScore ?? '')} extraLabel="Inlinks" extra={(r) => fmt(r.inlinks ?? 0)} />
                    ) : (
                        <Empty>Link scores are calculated when the crawl finishes.</Empty>
                    )}
                </Panel>
                <Panel title="Slowest pages" subtitle="Highest response time">
                    <PageTable rows={s.slowest} valueLabel="Time" value={(r) => formatMs(r.responseTimeMs ?? 0)} extraLabel="Status" extra={(r) => String(r.status ?? 'ERR')} />
                </Panel>
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
    const box = 'rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 text-left';
    return onClick ? (
        <button type="button" className={`${box} flex flex-col justify-start hover:border-info/60 hover:bg-surface-2`} onClick={onClick}>
            {body}
        </button>
    ) : (
        <div className={box}>{body}</div>
    );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <section className="flex min-h-[230px] flex-col rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3">
            <h2 className="m-0 text-[15px] font-semibold text-fg">{title}</h2>
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
                const clickable = Boolean(onOpen && b.filterId);
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
                    <span key={b.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
                        {b.label}
                    </span>
                ))}
            </div>
            {axisLabel && <div className="pt-0.5 text-center text-[11px] text-muted">{axisLabel}</div>}
        </div>
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
