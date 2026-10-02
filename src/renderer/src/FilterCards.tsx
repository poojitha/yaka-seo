import {
    Ban,
    CircleAlert,
    Copy,
    FileText,
    FileX,
    Heading1,
    Image,
    MoveHorizontal,
    RefreshCw,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react';
import { FILTERS } from './filters';

type Tone = 'info' | 'good' | 'bad' | 'warn' | 'violet' | 'neutral';

/** How each filter card looks: problems in red/amber, informational ones neutral. */
const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
    all: { icon: FileText, tone: 'info' },
    errors: { icon: TriangleAlert, tone: 'bad' },
    redirects: { icon: RefreshCw, tone: 'neutral' },
    noindex: { icon: Ban, tone: 'bad' },
    'title-missing': { icon: CircleAlert, tone: 'warn' },
    'title-long': { icon: FileText, tone: 'info' },
    'title-wide': { icon: MoveHorizontal, tone: 'neutral' },
    'desc-missing': { icon: FileX, tone: 'bad' },
    'desc-long': { icon: FileText, tone: 'warn' },
    'desc-wide': { icon: FileText, tone: 'warn' },
    'h1-missing': { icon: Heading1, tone: 'violet' },
    'h1-multiple': { icon: Heading1, tone: 'violet' },
    thin: { icon: FileText, tone: 'info' },
    'near-duplicates': { icon: Copy, tone: 'neutral' },
    'img-alt': { icon: Image, tone: 'good' },
};

interface Props {
    counts: Record<string, number>;
    active: string;
    onSelect: (id: string) => void;
}

/** One card per issue filter, with its count; the active one is highlighted. */
export function FilterCards({ counts, active, onSelect }: Props) {
    return (
        <div className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 xl:grid-cols-8">
            {FILTERS.filter((f) => f.card !== false).map((f) => {
                const { icon: Icon, tone } = LOOK[f.id] ?? { icon: FileText, tone: 'neutral' };
                const isActive = f.id === active;
                return (
                    <button
                        key={f.id}
                        type="button"
                        onClick={() => onSelect(f.id)}
                        className={`tone-${tone} flex min-w-0 items-center gap-2.5 rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${
                            isActive
                                ? 'glow border-(--tone) bg-(--tone)/10'
                                : 'border-line bg-surface hover:border-(--tone)/60 hover:bg-surface-2'
                        }`}
                    >
                        <Icon size={22} strokeWidth={2.2} className="shrink-0 text-(--tone)" aria-hidden />
                        <span className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate text-[12.5px] text-fg/90" title={f.label}>
                                {f.label}
                            </span>{' '}
                            <span className="text-lg font-semibold tabular-nums text-(--tone)">{counts[f.id]}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
