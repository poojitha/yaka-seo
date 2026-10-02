import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleStop, CircleX, Download, LayoutDashboard, Link2, LoaderCircle, Plus, Search, Square, Table2 } from 'lucide-react';
import type { CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { FILTERS, filterContext } from './filters';
import { Dashboard } from './Dashboard';
import { FilterCards } from './FilterCards';
import { ResultsTable } from './ResultsTable';
import { CrawlingScreen } from './CrawlingScreen';
import { StartScreen } from './StartScreen';
import logo from './assets/logo.png';

/** Electron wraps rejections from main as "Error invoking remote method 'x': Error: msg"; keep just msg. */
const ipcMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/** 84000 → "1m 24s". */
function formatElapsed(ms: number) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s % 60}s`;
}

/** Status-bar icon and colour for each crawl state. */
const STATUS_LOOK = {
    idle: { icon: LoaderCircle, className: 'text-muted' },
    running: { icon: LoaderCircle, className: 'animate-spin text-info' },
    stopping: { icon: LoaderCircle, className: 'animate-spin text-warn' },
    finished: { icon: CircleCheck, className: 'text-good' },
    stopped: { icon: CircleStop, className: 'text-warn' },
    error: { icon: CircleX, className: 'text-bad' },
} as const;

export function App() {
    // Kept here (not in StartScreen) so "New crawl" reopens the setup screen with the last settings.
    const [options, setOptions] = useState<CrawlOptions>({ startUrl: 'https://', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true, userAgent: '' });
    const [screen, setScreen] = useState<'setup' | 'crawling' | 'results'>('setup');
    /** Results screen: the URL table, or the summary dashboard. */
    const [view, setView] = useState<'table' | 'dashboard'>('table');

    const [results, setResults] = useState<PageResult[]>([]);
    const [progress, setProgress] = useState<CrawlProgress>({ status: 'idle', crawled: 0 });
    const [filterId, setFilterId] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<PageResult | null>(null);
    const [exportError, setExportError] = useState('');
    // For the elapsed time in the status bar.
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [endedAt, setEndedAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const offResults = window.api.onResults((rows) => setResults((prev) => prev.concat(rows)));
        const offProgress = window.api.onProgress(setProgress);
        // Post-crawl fields arrive once, at the end; merge them into the rows (and the open details panel).
        const offAnalysis = window.api.onAnalysis((analysis) => {
            const merge = (r: PageResult) => (analysis[r.url] ? { ...r, ...analysis[r.url] } : r);
            setResults((prev) => prev.map(merge));
            setSelected((s) => s && merge(s));
        });
        return () => {
            offResults();
            offProgress();
            offAnalysis();
        };
    }, []);

    const running = progress.status === 'running' || progress.status === 'stopping';
    const done = progress.status === 'finished' || progress.status === 'stopped' || progress.status === 'error';

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running]);
    useEffect(() => {
        if (done) setEndedAt((t) => t ?? Date.now());
    }, [done]);

    const start = async (opts: CrawlOptions) => {
        setOptions(opts);
        setResults([]);
        setSelected(null);
        setFilterId('all');
        setSearch('');
        setView('table');
        setProgress({ status: 'idle', crawled: 0 });
        setExportError('');
        setStartedAt(Date.now());
        setNow(Date.now());
        setEndedAt(null);
        setScreen('crawling');
        try {
            await window.api.startCrawl(opts);
        } catch (err) {
            setProgress({ status: 'error', crawled: 0, message: ipcMessage(err) });
        }
    };

    const stop = async () => {
        // Main confirms with its own 'stopping' event; this just makes the button react immediately.
        setProgress((p) => ({ ...p, status: 'stopping' }));
        try {
            await window.api.stopCrawl();
        } catch (err) {
            setProgress((p) => ({ ...p, message: ipcMessage(err) }));
        }
    };

    const exportCsv = async () => {
        setExportError('');
        try {
            await window.api.exportCsv(visible);
        } catch (err) {
            setExportError(`Export failed: ${ipcMessage(err)}`);
        }
    };

    const ctx = useMemo(() => filterContext(results), [results]);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, results.filter((r) => f.test(r, ctx)).length])), [results, ctx]);

    const visible = useMemo(() => {
        const filter = FILTERS.find((f) => f.id === filterId)!;
        const q = search.toLowerCase();
        return results.filter((r) => filter.test(r, ctx) && (!q || r.url.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
    }, [results, ctx, filterId, search]);

    if (screen === 'setup') return <StartScreen initial={options} onStart={start} onClose={() => setScreen('results')} />;
    if (screen === 'crawling') {
        return (
            <CrawlingScreen
                startUrl={options.startUrl}
                maxPages={options.maxPages}
                progress={progress}
                currentUrl={results.at(-1)?.url ?? ''}
                crawled={results.length}
                onStop={stop}
                onContinue={() => setScreen('results')}
            />
        );
    }

    const percent = done ? 100 : Math.min(100, Math.round((results.length / Math.max(1, options.maxPages)) * 100));
    const elapsed = startedAt === null ? null : Math.max(0, (endedAt ?? now) - startedAt);
    const { icon: StatusIcon, className: statusClass } = STATUS_LOOK[progress.status];

    return (
        <div className="app flex h-screen flex-col gap-3 bg-canvas p-3 text-fg">
            <div className="toolbar flex items-center gap-3">
                <img className="toolbar-logo size-9 shrink-0" src={logo} alt="Yaka|SEO" />
                <div className="tone-info glow flex h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-lg)] bg-surface px-4">
                    <Link2 size={20} className="shrink-0 text-info" aria-hidden />
                    <span className="crawl-url truncate text-[15px]" title={options.startUrl}>
                        {options.startUrl}
                    </span>
                </div>
                {running ? (
                    <button type="button" className="btn-tone tone-good" onClick={stop} disabled={progress.status === 'stopping'}>
                        <Square size={16} fill="currentColor" aria-hidden />
                        {progress.status === 'stopping' ? 'Stopping…' : 'Stop'}
                    </button>
                ) : (
                    <button type="button" className="btn-tone tone-good" onClick={() => setScreen('setup')}>
                        <Plus size={18} aria-hidden />
                        New crawl
                    </button>
                )}
                {view === 'table' ? (
                    <button type="button" className="btn-tone tone-violet" onClick={() => setView('dashboard')}>
                        <LayoutDashboard size={18} aria-hidden />
                        Dashboard
                    </button>
                ) : (
                    <button type="button" className="btn-tone tone-violet" onClick={() => setView('table')}>
                        <Table2 size={18} aria-hidden />
                        Results
                    </button>
                )}
                <button type="button" className="btn-tone tone-info" onClick={exportCsv} disabled={visible.length === 0}>
                    <Download size={18} aria-hidden />
                    Export CSV
                </button>
            </div>

            {view === 'dashboard' ? (
                <Dashboard
                    rows={results}
                    renderJs={options.renderJs}
                    onOpen={(id, query = '') => {
                        setFilterId(id);
                        setSearch(query);
                        setView('table');
                    }}
                />
            ) : (
                <>
                    <FilterCards counts={counts} active={filterId} onSelect={setFilterId} />

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
                        <div className="flex items-center gap-3 px-4 py-3">
                            <span className="text-lg font-semibold tabular-nums">{visible.length} URLs</span>
                            <select
                                aria-label="Issue filter"
                                className="h-9 rounded-[var(--radius)] border-line bg-surface-2 px-3"
                                value={filterId}
                                onChange={(e) => setFilterId(e.target.value)}
                            >
                                {FILTERS.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.id === 'all' ? 'All issues' : `${f.label} (${counts[f.id]})`}
                                    </option>
                                ))}
                            </select>
                            <div className="relative ml-auto w-80">
                                <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
                                <input
                                    className="search h-9 w-full rounded-[var(--radius)] border-line bg-surface-2 pr-3 pl-9"
                                    placeholder="Search URL or title…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                        <ResultsTable rows={visible} selected={selected} onSelect={setSelected} />
                    </div>

                    {selected && (
                        <div className="details h-52 shrink-0 overflow-auto rounded-[var(--radius-lg)] border border-line bg-surface p-4">
                            <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-4 gap-y-1">
                                {Object.entries(selected).map(([k, v]) => (
                                    <div key={k} className="flex gap-2">
                                        <dt className="min-w-[150px] text-muted">{k}</dt>
                                        <dd className="m-0 break-all">{String(v ?? '')}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}

                </>
            )}

            <div className="statusbar flex items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 text-muted">
                <StatusIcon size={26} strokeWidth={2.5} className={`shrink-0 ${statusClass}`} aria-hidden />
                <span className={`font-semibold ${statusClass.replace('animate-spin', '')}`}>{progress.status.toUpperCase()}</span>
                <span className="h-5 border-l border-line" />
                <span className="text-fg">{results.length} URLs crawled</span>
                <span className="h-5 border-l border-line" />
                <span className="truncate">{options.startUrl}</span>
                {progress.message && <span className="error text-bad">{progress.message}</span>}
                {exportError && <span className="error text-bad">{exportError}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-4">
                    {elapsed !== null && <span>Elapsed: {formatElapsed(elapsed)}</span>}
                    <span className="h-5 border-l border-line" />
                    <span className="tabular-nums text-fg">
                        {results.length} / {options.maxPages} ({percent}%)
                    </span>
                    <span className="h-2.5 w-64 overflow-hidden rounded-full bg-surface-2">
                        <span
                            className="tone-good glow block h-full rounded-full bg-good transition-[width] duration-300"
                            style={{ width: `${percent}%` }}
                        />
                    </span>
                </span>
            </div>
        </div>
    );
}
