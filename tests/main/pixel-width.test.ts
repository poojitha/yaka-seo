import { describe, expect, it } from 'vitest';
import { DESCRIPTION_FONT_PX, pixelWidth, TITLE_FONT_PX } from '../../src/main/pixel-width';

describe('pixelWidth', () => {
    it('matches a reference crawler for a meta description (Arial 14 px)', () => {
        // From a reference crawler export: this description is 270 px.
        expect(pixelWidth('Default description XIbwNE7SSUJciq0/Jyty', DESCRIPTION_FONT_PX)).toBe(270);
    });

    it('is within a pixel of a reference crawler for a title (Arial 20 px)', () => {
        // The reference crawler reports 154 px; the unrounded Arial width is 153.37.
        expect(pixelWidth('Crawler Test Site', TITLE_FONT_PX)).toBe(153);
    });

    it('rounds each character to whole pixels', () => {
        // 'i' is 455/2048 em: 4.44 px at 20 px, so ten of them are 40 px, not 44.
        expect(pixelWidth('iiiiiiiiii', 20)).toBe(40);
        expect(pixelWidth('W', 20)).toBe(19);
        expect(pixelWidth('', 20)).toBe(0);
    });

    it('measures accented Latin, Cyrillic and typographic punctuation from Arial', () => {
        expect(pixelWidth('é', 20)).toBe(pixelWidth('e', 20));
        expect(pixelWidth('Привет', 20)).toBeGreaterThan(50);
        expect(pixelWidth('–', 20)).toBe(11);
        expect(pixelWidth('…', 20)).toBe(20);
    });

    it('counts CJK and emoji as one em, and other unknown characters as an average letter', () => {
        expect(pixelWidth('東京', 20)).toBe(40);
        expect(pixelWidth('😀', 20)).toBe(20);
        // Hebrew isn't in the table.
        expect(pixelWidth('ש', 20)).toBe(pixelWidth('e', 20));
    });
});
