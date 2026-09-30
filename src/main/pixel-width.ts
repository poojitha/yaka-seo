import { ARIAL_ADVANCES, ARIAL_UNITS_PER_EM } from './arial-widths';

// Google's desktop results use Arial: 20 px for titles, 14 px for descriptions.
export const TITLE_FONT_PX = 20;
export const DESCRIPTION_FONT_PX = 14;

const ADVANCES = new Map<number, number>();
for (const [first, widths] of ARIAL_ADVANCES) {
    widths.forEach((w, i) => w && ADVANCES.set(first + i, w));
}

// Characters Arial lacks are drawn from a fallback font. CJK, Hangul, full-width forms and emoji are about one em
// wide; for anything else, the width of a digit or a lower-case 'e' is a reasonable middle.
const WIDE = /[ᄀ-ᅟ⺀-〿぀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\p{Extended_Pictographic}]/u;
const AVERAGE_ADVANCE = ADVANCES.get('e'.codePointAt(0)!)!;

/**
 * Width in pixels of `text` rendered in Arial at `fontPx`, as in search results. Each character is rounded to whole
 * pixels, as screen rendering does; this reproduces Screaming Frog's description widths exactly.
 */
export function pixelWidth(text: string, fontPx: number): number {
    let total = 0;
    for (const ch of text) {
        const advance = ADVANCES.get(ch.codePointAt(0)!) ?? (WIDE.test(ch) ? ARIAL_UNITS_PER_EM : AVERAGE_ADVANCE);
        total += Math.round((advance * fontPx) / ARIAL_UNITS_PER_EM);
    }
    return total;
}
