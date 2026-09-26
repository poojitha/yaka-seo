import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CrawlProgress, PageResult } from '@shared/types';
import { FILTERS } from './filters';
import { ResultsTable } from './ResultsTable';

export function App() {
    const [startUrl, setStartUrl] = useState('https://');
    const [maxPages, setMaxPages] = useState(500);
    const [maxDepth, setMaxDepth] = useState(10);
    const [concurrency, setConcurrency] = useState(10);
    const [renderJs, setRenderJs] = useState(false);

    const [results, setResults] = useState<PageResult[]>([]);
    const [progress, setProgress] = useState<CrawlProgress>({ status: 'idle', crawled: 0 });
    const [filterId, setFilterId] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<PageResult | null>(null);

    useEffect(() => {
        const offResults = window.api.onResults((rows) => setResults((prev) => prev.concat(rows)));
        const offProgress = window.api.onProgress(setProgress);
        return () => {
            offResults();
            offProgress();
        };
    }, []);

    const running = progress.status === 'running' || progress.status === 'stopping';

    const start = async (e: FormEvent) => {
        e.preventDefault();
        try {
            new URL(startUrl);
        } catch {
            setProgress({ status: 'error', crawled: 0, message: 'Enter a valid URL, e.g. https://example.com' });
            return;
        }
        setResults([]);
        setSelected(null);
        await window.api.startCrawl({ startUrl, maxPages, maxDepth, concurrency, renderJs });
    };

    const stop = async () => {
        setProgress((p) => ({ ...p, status: 'stopping' }));
        await window.api.stopCrawl();
    };

    const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, results.filter(f.test).length])), [results]);

    const visible = useMemo(() => {
        const filter = FILTERS.find((f) => f.id === filterId)!;
        const q = search.toLowerCase();
        return results.filter((r) => filter.test(r) && (!q || r.url.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
    }, [results, filterId, search]);

    return (
        <div className="app">
            <form className="toolbar" onSubmit={start}>
                <input className="url" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} disabled={running} />
                <label>
                    Max pages <input type="number" min={1} value={maxPages} onChange={(e) => setMaxPages(+e.target.value)} disabled={running} />
                </label>
                <label>
                    Depth <input type="number" min={0} value={maxDepth} onChange={(e) => setMaxDepth(+e.target.value)} disabled={running} />
                </label>
                <label>
                    Threads <input type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(+e.target.value)} disabled={running} />
                </label>
                <label className="check">
                    <input type="checkbox" checked={renderJs} onChange={(e) => setRenderJs(e.target.checked)} disabled={running} /> Render JavaScript
                </label>
                {running ? (
                    <button type="button" onClick={stop} disabled={progress.status === 'stopping'}>
                        {progress.status === 'stopping' ? 'Stopping…' : 'Stop'}
                    </button>
                ) : (
                    <button type="submit" className="primary">Start</button>
                )}
                <button type="button" onClick={() => window.api.exportCsv(visible)} disabled={visible.length === 0}>
                    Export CSV
                </button>
            </form>

            <div className="filters">
                {FILTERS.map((f) => (
                    <button key={f.id} className={f.id === filterId ? 'active' : ''} onClick={() => setFilterId(f.id)}>
                        {f.label} <span className="count">{counts[f.id]}</span>
                    </button>
                ))}
                <input className="search" placeholder="Search URL or title…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <ResultsTable rows={visible} selected={selected} onSelect={setSelected} />

            {selected && (
                <div className="details">
                    <dl>
                        {Object.entries(selected).map(([k, v]) => (
                            <div key={k}>
                                <dt>{k}</dt>
                                <dd>{String(v ?? '')}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}

            <div className="statusbar">
                <span>{progress.status.toUpperCase()}</span>
                <span>{results.length} URLs crawled</span>
                {progress.message && <span className="error">{progress.message}</span>}
            </div>
        </div>
    );
}
