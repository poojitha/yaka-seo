import { useId, useState, type FormEvent } from 'react';
import { Check, ChevronDown, ChevronUp, FileText, Globe, Layers, Link, Monitor, Play, Settings, X, type LucideIcon } from 'lucide-react';
import type { CrawlOptions } from '@shared/types';
import logo from './assets/logo.png';

type UaMode = 'browser' | 'custom';
const uaModeOf = (ua: string): UaMode => (ua === '' ? 'browser' : 'custom');

interface Props {
    initial: CrawlOptions;
    onStart: (options: CrawlOptions) => void;
    onClose: () => void;
}

/** Decorative glows, arcs and dot grids behind the setup and crawling cards. */
export function Backdrop() {
    return (
        <div className="backdrop" aria-hidden="true">
            <span className="arc arc-left" />
            <span className="arc arc-left-2" />
            <span className="arc arc-right" />
            <span className="arc arc-right-2" />
            <span className="dots dots-left" />
            <span className="dots dots-right" />
        </div>
    );
}

function FieldLabel({ icon: Icon, children, htmlFor }: { icon: LucideIcon; children: string; htmlFor?: string }) {
    return (
        <label className="field-label" htmlFor={htmlFor}>
            <Icon size={17} strokeWidth={1.8} />
            {children}
        </label>
    );
}

/** Number input with its own up/down chevrons (the native spinner is hidden; it can't be themed). */
function NumberField({ label, icon, value, min, max, onChange }: { label: string; icon: LucideIcon; value: number; min: number; max?: number; onChange: (n: number) => void }) {
    const id = useId();
    const step = (by: number) => onChange(Math.min(max ?? Infinity, Math.max(min, value + by)));
    return (
        <div className="field">
            <FieldLabel icon={icon} htmlFor={id}>{label}</FieldLabel>
            <div className="stepper">
                <input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} />
                {/* tabIndex -1: the arrow keys already step a focused number input. */}
                <div className="stepper-buttons">
                    <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} onClick={() => step(1)}>
                        <ChevronUp size={14} />
                    </button>
                    <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} onClick={() => step(-1)}>
                        <ChevronDown size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function StartScreen({ initial, onStart, onClose }: Props) {
    const [startUrl, setStartUrl] = useState(initial.startUrl);
    const [maxPages, setMaxPages] = useState(initial.maxPages);
    const [maxDepth, setMaxDepth] = useState(initial.maxDepth);
    const [concurrency, setConcurrency] = useState(initial.concurrency);
    const [renderJs, setRenderJs] = useState(initial.renderJs);
    const [uaMode, setUaMode] = useState<UaMode>(uaModeOf(initial.userAgent));
    const [customUa, setCustomUa] = useState(uaModeOf(initial.userAgent) === 'custom' ? initial.userAgent : '');
    const [error, setError] = useState('');
    const urlId = useId();
    const uaId = useId();

    const submit = (e: FormEvent) => {
        e.preventDefault();
        try {
            new URL(startUrl);
        } catch {
            setError('Enter a valid URL, e.g. https://example.com');
            return;
        }
        if (uaMode === 'custom' && !customUa.trim()) {
            setError('Enter a custom User-Agent, or pick a preset');
            return;
        }
        const userAgent = uaMode === 'browser' ? '' : customUa.trim();
        onStart({ startUrl, maxPages, maxDepth, concurrency, renderJs, userAgent });
    };

    return (
        <div className="start-screen">
            <Backdrop />
            <button type="button" className="close" onClick={onClose} title="Close" aria-label="Close">
                <X size={20} />
            </button>
            <form className="start-card setup" onSubmit={submit}>
                <div className="brand">
                    <img src={logo} alt="" />
                    <h1>
                        <b>Yaka</b>
                        <span className="brand-sep">|</span>
                        <span className="brand-seo">SEO</span>
                    </h1>
                </div>
                <div className="field">
                    <FieldLabel icon={Link} htmlFor={urlId}>Website URL</FieldLabel>
                    <div className="url-box">
                        <span className="url-icon">
                            <Globe size={18} strokeWidth={1.8} />
                        </span>
                        <input
                            id={urlId}
                            autoFocus
                            spellCheck={false}
                            value={startUrl}
                            onChange={(e) => {
                                setStartUrl(e.target.value);
                                setError('');
                            }}
                        />
                    </div>
                </div>
                <div className="settings">
                    <NumberField label="Max pages" icon={FileText} min={1} value={maxPages} onChange={setMaxPages} />
                    <NumberField label="Depth" icon={Layers} min={0} value={maxDepth} onChange={setMaxDepth} />
                    <NumberField label="Threads" icon={Settings} min={1} max={50} value={concurrency} onChange={setConcurrency} />
                </div>
                <div className="field">
                    <FieldLabel icon={Monitor} htmlFor={uaId}>User agent</FieldLabel>
                    <div className="select-box">
                        <select
                            id={uaId}
                            value={uaMode}
                            onChange={(e) => {
                                setUaMode(e.target.value as UaMode);
                                setError('');
                            }}
                        >
                            <option value="browser">Browser (Chrome)</option>
                            <option value="custom">Custom…</option>
                        </select>
                        <ChevronDown size={18} />
                    </div>
                    {uaMode === 'custom' && (
                        <input
                            className="custom-ua"
                            aria-label="Custom user agent"
                            placeholder="e.g. Mozilla/5.0 (compatible; MyBot/1.0)"
                            value={customUa}
                            onChange={(e) => {
                                setCustomUa(e.target.value);
                                setError('');
                            }}
                        />
                    )}
                </div>
                <label className="check">
                    <span className="checkbox">
                        <input type="checkbox" checked={renderJs} onChange={(e) => setRenderJs(e.target.checked)} />
                        <Check size={15} strokeWidth={3} />
                    </span>
                    Render JavaScript
                </label>
                {error && <div className="error">{error}</div>}
                <button type="submit" className="start-button">
                    <Play size={20} strokeWidth={2.2} />
                    Start
                </button>
            </form>
        </div>
    );
}
