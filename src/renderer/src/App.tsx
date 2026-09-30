import { useEffect, useMemo, useState } from 'react';
import type { CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { FILTERS } from './filters';
import { ResultsTable } from './ResultsTable';
import { CrawlingScreen } from './CrawlingScreen';
import { StartScreen } from './StartScreen';
import logo from './assets/logo.png';

/** Electron wraps rejections from main as "Error invoking remote method 'x': Error: msg"; keep just msg. */
const ipcMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

export function App() {
    // Kept here (not in StartScreen) so "New crawl" reopens the setup screen with the last settings.
    const [options, setOptions] = useState<CrawlOptions>({ startUrl: 'https://', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true, userAgent: '' });
    const [screen, setScreen] = useState<'setup' | 'crawling' | 'results'>('setup');

    const [results, setResults] = useState<PageResult[]>([]);
    const [progress, setProgress] = useState<CrawlProgress>({ status: 'idle', crawled: 0 });
    const [filterId, setFilterId] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<PageResult | null>(null);
    const [exportError, setExportError] = useState('');

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

    const start = async (opts: CrawlOptions) => {
        setOptions(opts);
        setResults([]);
        setSelected(null);
        setFilterId('all');
        setSearch('');
        setProgress({ status: 'idle', crawled: 0 });
        setExportError('');
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

    const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, results.filter(f.test).length])), [results]);

    const visible = useMemo(() => {
        const filter = FILTERS.find((f) => f.id === filterId)!;
        const q = search.toLowerCase();
        return results.filter((r) => filter.test(r) && (!q || r.url.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
    }, [results, filterId, search]);

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

    return (
        <div className="app">
            <div className="toolbar">
                <img className="toolbar-logo" src={logo} alt="Yaka|SEO" />
                <span className="crawl-url" title={options.startUrl}>{options.startUrl}</span>
                {running ? (
                    <button type="button" onClick={stop} disabled={progress.status === 'stopping'}>
                        {progress.status === 'stopping' ? 'Stopping…' : 'Stop'}
                    </button>
                ) : (
                    <button type="button" className="primary" onClick={() => setScreen('setup')}>
                        New crawl
                    </button>
                )}
                <button type="button" onClick={exportCsv} disabled={visible.length === 0}>
                    Export CSV
                </button>
            </div>

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
                {exportError && <span className="error">{exportError}</span>}
            </div>
        </div>
    );
}
