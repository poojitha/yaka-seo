import { useEffect, useMemo, useState } from 'react';
import type { CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { FILTERS } from './filters';
import { ResultsTable } from './ResultsTable';
import { CrawlingScreen } from './CrawlingScreen';
import { StartScreen } from './StartScreen';
import logo from './assets/logo.png';

export function App() {
    // Kept here (not in StartScreen) so "New crawl" reopens the setup screen with the last settings.
    const [options, setOptions] = useState<CrawlOptions>({ startUrl: 'https://', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true, userAgent: '' });
    const [screen, setScreen] = useState<'setup' | 'crawling' | 'results'>('setup');

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

    const start = async (opts: CrawlOptions) => {
        setOptions(opts);
        setResults([]);
        setSelected(null);
        setFilterId('all');
        setSearch('');
        setProgress({ status: 'idle', crawled: 0 });
        setScreen('crawling');
        await window.api.startCrawl(opts);
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
                <button type="button" onClick={() => window.api.exportCsv(visible)} disabled={visible.length === 0}>
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
            </div>
        </div>
    );
}
