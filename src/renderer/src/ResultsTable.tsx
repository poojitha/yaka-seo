import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { PageResult } from '@shared/types';

const ROW_HEIGHT = 34;
const OVERSCAN = 10;

type Tone = 'info' | 'good' | 'bad' | 'warn' | 'neutral';
type Column = {
    key: keyof PageResult;
    label: string;
    width: number;
    render?: (r: PageResult) => string | number | null;
    /** Shows the value as a coloured badge. */
    pill?: (r: PageResult) => Tone;
};

const statusTone = (r: PageResult): Tone => {
    const s = r.status ?? 0;
    return r.error || s >= 400 || s === 0 ? 'bad' : s >= 300 ? 'info' : 'good';
};
const indexTone = (r: PageResult): Tone => {
    if (r.indexable) return 'good';
    if (r.indexabilityReason.startsWith('noindex')) return 'warn';
    if (r.indexabilityReason === 'Redirected' || r.indexabilityReason === 'Canonicalised') return 'info';
    return 'bad';
};

const COLUMNS: Column[] = [
    { key: 'url', label: 'Address', width: 360 },
    { key: 'status', label: 'Status', width: 90, render: (r) => r.status ?? 'ERR', pill: statusTone },
    { key: 'indexable', label: 'Indexable', width: 160, render: (r) => (r.indexable ? 'Indexable' : r.indexabilityReason), pill: indexTone },
    { key: 'title', label: 'Title', width: 280 },
    { key: 'titleLength', label: 'Title len', width: 75 },
    { key: 'titlePixelWidth', label: 'Title px', width: 70 },
    { key: 'metaDescription', label: 'Meta description', width: 280 },
    { key: 'metaDescriptionLength', label: 'Desc len', width: 75 },
    { key: 'metaDescriptionPixelWidth', label: 'Desc px', width: 70 },
    { key: 'h1', label: 'H1', width: 200 },
    { key: 'h1Count', label: 'H1s', width: 50 },
    { key: 'h2', label: 'H2', width: 200 },
    { key: 'wordCount', label: 'Words', width: 70 },
    { key: 'fleschReadingEase', label: 'Flesch', width: 70 },
    { key: 'readability', label: 'Readability', width: 120 },
    { key: 'textRatio', label: 'Text %', width: 70 },
    { key: 'internalLinks', label: 'Int. links', width: 80 },
    { key: 'uniqueInternalLinks', label: 'Uniq. int.', width: 80 },
    { key: 'externalLinks', label: 'Ext. links', width: 80 },
    { key: 'uniqueExternalLinks', label: 'Uniq. ext.', width: 80 },
    { key: 'uniqueJsOutlinks', label: 'JS links', width: 70 },
    { key: 'inlinks', label: 'Inlinks', width: 70 },
    { key: 'uniqueInlinks', label: 'Uniq. inlinks', width: 95 },
    { key: 'percentOfTotal', label: '% of total', width: 80 },
    { key: 'linkScore', label: 'Link score', width: 80 },
    { key: 'nearDuplicates', label: 'Near dups', width: 80 },
    { key: 'closestNearDuplicateSimilarity', label: 'Dup %', width: 65 },
    { key: 'depth', label: 'Depth', width: 60 },
    { key: 'folderDepth', label: 'Folders', width: 65 },
    { key: 'responseTimeMs', label: 'Time (ms)', width: 80 },
    { key: 'sizeBytes', label: 'Size (B)', width: 80 },
    { key: 'transferredBytes', label: 'Transferred (B)', width: 110 },
    { key: 'totalTransferredBytes', label: 'Total transf. (B)', width: 120 },
    { key: 'co2Mg', label: 'CO2 (mg)', width: 80 },
    { key: 'carbonRating', label: 'Carbon', width: 65 },
    { key: 'canonical', label: 'Canonical', width: 280 },
    { key: 'metaRobots', label: 'Meta robots', width: 150 },
    { key: 'xRobotsTag', label: 'X-Robots-Tag', width: 150 },
    { key: 'metaRefresh', label: 'Meta refresh', width: 150 },
    { key: 'redirectType', label: 'Redirect type', width: 130 },
    { key: 'language', label: 'Lang', width: 60 },
    { key: 'httpVersion', label: 'HTTP', width: 55 },
    { key: 'lastModified', label: 'Last modified', width: 200 },
];

/** Row-number column first, then the data columns (plus room for the header's sort icon). */
const gridTemplate = ['56px', ...COLUMNS.map((c) => `${c.width + 18}px`)].join(' ');

interface Props {
    rows: PageResult[];
    selected: PageResult | null;
    onSelect: (row: PageResult) => void;
}

/** Sortable table that only renders the rows in view, so large crawls stay responsive. */
export function ResultsTable({ rows, selected, onSelect }: Props) {
    const [sort, setSort] = useState<{ key: keyof PageResult; dir: 1 | -1 } | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scrollRef.current!;
        const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const sorted = useMemo(() => {
        if (!sort) return rows;
        return [...rows].sort((a, b) => {
            const av = a[sort.key] ?? '';
            const bv = b[sort.key] ?? '';
            return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
    }, [rows, sort]);

    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(sorted.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

    const toggleSort = (key: keyof PageResult) =>
        setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

    return (
        <div className="results-table relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <div
                role="row"
                className="row header sticky top-0 z-10 grid h-10 w-max min-w-full items-center border-b border-line bg-surface-2 text-[13px] font-semibold"
                style={{ gridTemplateColumns: gridTemplate }}
            >
                <div className="px-3 text-center text-muted">#</div>
                {COLUMNS.map((c) => {
                    const dir = sort?.key === c.key ? sort.dir : 0;
                    const Icon = dir === 1 ? ChevronUp : dir === -1 ? ChevronDown : ChevronsUpDown;
                    return (
                        <div
                            key={c.key}
                            role="columnheader"
                            aria-sort={dir === 1 ? 'ascending' : dir === -1 ? 'descending' : 'none'}
                            className="cell flex cursor-pointer items-center gap-1 overflow-hidden px-3 select-none hover:text-info"
                            onClick={() => toggleSort(c.key)}
                        >
                            <span className="truncate">{c.label}</span>
                            <Icon size={14} className={dir ? 'shrink-0 text-info' : 'shrink-0 text-muted'} aria-hidden />
                        </div>
                    );
                })}
            </div>
            <div style={{ height: sorted.length * ROW_HEIGHT, position: 'relative' }}>
                {sorted.slice(start, end).map((r, i) => {
                    const bad = (r.status ?? 0) >= 400 || r.error !== null;
                    return (
                        <div
                            key={r.url}
                            role="row"
                            className={`row grid w-max min-w-full items-center border-b border-line/60 text-[13px] ${
                                r === selected ? 'selected bg-selected' : 'hover:bg-surface-2'
                            }${bad ? ' bad' : ''}`}
                            style={{ gridTemplateColumns: gridTemplate, position: 'absolute', top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                            onClick={() => onSelect(r)}
                        >
                            <div className="px-3 text-center text-muted tabular-nums">{start + i + 1}</div>
                            {COLUMNS.map((c) => {
                                const value = c.render ? c.render(r) : r[c.key];
                                const text = String(value ?? '');
                                return (
                                    <div key={c.key} className="cell truncate px-3" title={text}>
                                        {c.pill ? <span className={`pill tone-${c.pill(r)}`}>{text}</span> : text}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
