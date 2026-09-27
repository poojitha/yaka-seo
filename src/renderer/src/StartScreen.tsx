import { useState, type FormEvent } from 'react';
import type { CrawlOptions } from '@shared/types';
import logo from './assets/logo.png';

interface Props {
    initial: CrawlOptions;
    onStart: (options: CrawlOptions) => void;
    onClose: () => void;
}

export function StartScreen({ initial, onStart, onClose }: Props) {
    const [startUrl, setStartUrl] = useState(initial.startUrl);
    const [maxPages, setMaxPages] = useState(initial.maxPages);
    const [maxDepth, setMaxDepth] = useState(initial.maxDepth);
    const [concurrency, setConcurrency] = useState(initial.concurrency);
    const [renderJs, setRenderJs] = useState(initial.renderJs);
    const [error, setError] = useState('');

    const submit = (e: FormEvent) => {
        e.preventDefault();
        try {
            new URL(startUrl);
        } catch {
            setError('Enter a valid URL, e.g. https://example.com');
            return;
        }
        onStart({ startUrl, maxPages, maxDepth, concurrency, renderJs });
    };

    return (
        <div className="start-screen">
            <form className="start-card" onSubmit={submit}>
                <button type="button" className="close" onClick={onClose} title="Close" aria-label="Close">
                    ×
                </button>
                <div className="brand">
                    <img src={logo} alt="" />
                    <h1>
                        Yaka<span className="brand-sep">|</span>SEO
                    </h1>
                </div>
                <label className="field">
                    <span>Website URL</span>
                    <input
                        className="url"
                        autoFocus
                        value={startUrl}
                        onChange={(e) => {
                            setStartUrl(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <div className="settings">
                    <label className="field">
                        <span>Max pages</span>
                        <input type="number" min={1} value={maxPages} onChange={(e) => setMaxPages(+e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Depth</span>
                        <input type="number" min={0} value={maxDepth} onChange={(e) => setMaxDepth(+e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Threads</span>
                        <input type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(+e.target.value)} />
                    </label>
                </div>
                <label className="check">
                    <input type="checkbox" checked={renderJs} onChange={(e) => setRenderJs(e.target.checked)} /> Render JavaScript
                </label>
                {error && <div className="error">{error}</div>}
                <button type="submit" className="primary">Start</button>
            </form>
        </div>
    );
}
