import { describe, expect, it } from 'vitest';
import { carbonRating, co2Milligrams } from '../../src/main/carbon';

describe('co2Milligrams', () => {
    it('matches a reference crawler for the same transferred bytes', () => {
        // From a reference crawler export: 8131 bytes transferred, 1.205 mg CO2.
        expect(co2Milligrams(8131)).toBe(1.205);
    });

    it('is 148.2 g per GB (0.3 kWh/GB at 494 g/kWh), and 0 for nothing transferred', () => {
        expect(co2Milligrams(1e9)).toBe(148_200);
        expect(co2Milligrams(0)).toBe(0);
    });
});

describe('carbonRating', () => {
    it.each([
        [0, 'A+'],
        [40, 'A+'],
        [40.001, 'A'],
        [79, 'A'],
        [145, 'B'],
        [209, 'C'],
        [278, 'D'],
        [359, 'E'],
        [359.001, 'F'],
        [5000, 'F'],
    ])('%f mg is %s', (mg, rating) => {
        expect(carbonRating(mg)).toBe(rating);
    });

    it('a typical 2 MB page (296.4 mg) rates E', () => {
        expect(co2Milligrams(2_000_000)).toBe(296.4);
        expect(carbonRating(co2Milligrams(2_000_000))).toBe('E');
    });
});
