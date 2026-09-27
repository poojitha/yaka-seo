import type { CrawlProgress } from '@shared/types';

interface Props {
    startUrl: string;
    maxPages: number;
    progress: CrawlProgress;
    /** URL of the most recently crawled page, or '' before the first rows arrive. */
    currentUrl: string;
    crawled: number;
    onStop: () => void;
    onContinue: () => void;
}

export function CrawlingScreen({ startUrl, maxPages, progress, currentUrl, crawled, onStop, onContinue }: Props) {
    const { status } = progress;
    const done = status === 'finished' || status === 'error';
    // 'idle' only lasts until main sends its first 'running' event, so show it as starting.
    const heading = status === 'finished' ? 'Crawl complete' : status === 'error' ? 'Crawl failed' : status === 'stopping' ? 'Stopping…' : 'Crawling…';
    const percent = Math.min(100, (crawled / Math.max(1, maxPages)) * 100);

    return (
        <div className="start-screen">
            <div className="start-card crawling">
                <div className={`loader ${status === 'finished' ? 'ok' : status === 'error' ? 'fail' : ''}`}>
                    {done ? <span className="loader-icon">{status === 'finished' ? '✓' : '!'}</span> : <span className="loader-ring" />}
                </div>
                <h1>{heading}</h1>
                <div className="crawl-target" title={startUrl}>{startUrl}</div>

                <div className="progress-bar">
                    <div style={{ width: `${done ? 100 : percent}%` }} />
                </div>
                <div className="crawl-count">
                    {crawled} {crawled === 1 ? 'page' : 'pages'} crawled{!done && ` (max ${maxPages})`}
                </div>

                <div className="current-url" title={currentUrl}>
                    {status === 'error' ? <span className="error">{progress.message}</span> : done ? ' ' : currentUrl || 'Connecting…'}
                </div>

                <div className="crawling-actions">
                    {!done && (
                        <button type="button" onClick={onStop} disabled={status === 'stopping'}>
                            {status === 'stopping' ? 'Stopping…' : 'Stop'}
                        </button>
                    )}
                    <button type="button" className="primary" onClick={onContinue}>
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
