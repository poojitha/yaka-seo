import { ArrowRight, Globe, Square, X } from 'lucide-react';
import type { CrawlProgress } from '@shared/types';
import logo from './assets/logo.png';
import { Backdrop } from './StartScreen';

interface Props {
    startUrl: string;
    maxPages: number;
    progress: CrawlProgress;
    /** URL of the most recently crawled page, or '' before the first rows arrive. */
    currentUrl: string;
    crawled: number;
    onStop: () => void;
    onContinue: () => void;
    /** Leave the screen; App also stops the crawl if it is still running. */
    onClose: () => void;
}

export function CrawlingScreen({ startUrl, maxPages, progress, currentUrl, crawled, onStop, onContinue, onClose }: Props) {
    const { status } = progress;
    const done = status === 'finished' || status === 'stopped' || status === 'error';
    // 'idle' only lasts until main sends its first 'running' event, so show it as starting.
    const heading = {
        finished: 'Crawl complete',
        stopped: 'Crawl stopped',
        error: 'Crawl failed',
        stopping: 'Stopping…',
        running: 'Crawling…',
        idle: 'Crawling…',
    }[status];
    const percent = Math.min(100, (crawled / Math.max(1, maxPages)) * 100);

    return (
        <div className="start-screen">
            <Backdrop />
            <button
                type="button"
                className="close"
                onClick={onClose}
                title={done || status === 'stopping' ? 'Close' : 'Stop the crawl and close'}
                aria-label="Close"
            >
                <X size={20} />
            </button>
            <div className={`start-card crawling${status === 'error' ? ' failed' : ''}`}>
                <div className={`loader ${status === 'finished' || status === 'stopped' ? 'ok' : status === 'error' ? 'fail' : ''}`}>
                    {!done && <span className="loader-ring" />}
                    <img className="loader-logo" src={logo} alt="" />
                    {done && <span className="loader-badge">{status === 'error' ? '!' : '✓'}</span>}
                </div>
                <h1>{heading}</h1>
                <div className="crawl-target" title={startUrl}>
                    <Globe size={15} strokeWidth={1.8} aria-hidden />
                    <span>{startUrl}</span>
                </div>

                <div className="crawl-progress">
                    <div className="progress-bar">
                        <div style={{ width: `${done ? 100 : percent}%` }} />
                    </div>
                    <div className="crawl-count">
                        {crawled} {crawled === 1 ? 'page' : 'pages'} crawled{!done && ` (max ${maxPages})`}
                    </div>
                </div>

                <div className="current-url" title={currentUrl}>
                    {status === 'error' ? <span className="error">{progress.message}</span> : done ? ' ' : currentUrl || 'Connecting…'}
                </div>

                <div className="crawling-actions">
                    {!done && (
                        <button type="button" className="stop-button" onClick={onStop} disabled={status === 'stopping'}>
                            <Square size={15} fill="currentColor" aria-hidden />
                            {status === 'stopping' ? 'Stopping…' : 'Stop'}
                        </button>
                    )}
                    <button type="button" className="start-button" onClick={onContinue}>
                        {done ? 'View results' : 'Show live results'}
                        <ArrowRight size={19} strokeWidth={2.2} aria-hidden />
                    </button>
                </div>
                {!done && (
                    <div className="crawl-hint">
                        The crawl keeps running in the background. Results appear in the table as pages are crawled.
                    </div>
                )}
            </div>
        </div>
    );
}
