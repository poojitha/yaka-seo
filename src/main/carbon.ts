/**
 * Page-view emissions with the Sustainable Web Design Model v4 (the model behind CO2.js and Website Carbon),
 * for a first-time visitor: no caching discount and the global average grid.
 */

// Energy per GB transferred, in kWh. Operational: electricity to run the hardware.
const DATA_CENTRE_OPERATIONAL = 0.055;
const NETWORK_OPERATIONAL = 0.059;
const USER_DEVICE_OPERATIONAL = 0.08;
// Embodied: energy to manufacture the hardware, spread over the data it handles in its lifetime.
const DATA_CENTRE_EMBODIED = 0.012;
const NETWORK_EMBODIED = 0.013;
const USER_DEVICE_EMBODIED = 0.081;

const KWH_PER_GB =
    DATA_CENTRE_OPERATIONAL + NETWORK_OPERATIONAL + USER_DEVICE_OPERATIONAL + DATA_CENTRE_EMBODIED + NETWORK_EMBODIED + USER_DEVICE_EMBODIED;
// Global average grid carbon intensity, g CO2e per kWh.
const GRID_G_PER_KWH = 494;

/** Upper bounds in grams CO2e per page view for each rating (SWDM v4 digital carbon ratings); above the last is F. */
const RATINGS: [string, number][] = [
    ['A+', 0.04],
    ['A', 0.079],
    ['B', 0.145],
    ['C', 0.209],
    ['D', 0.278],
    ['E', 0.359],
];

/** Milligrams of CO2e to transfer `bytes`, rounded to 3 decimals. */
export function co2Milligrams(bytes: number): number {
    const grams = (bytes / 1e9) * KWH_PER_GB * GRID_G_PER_KWH;
    return Math.round(grams * 1e6) / 1000;
}

/** Letter rating (A+ to F) for a page view's emissions. */
export function carbonRating(mg: number): string {
    const grams = mg / 1000;
    return RATINGS.find(([, max]) => grams <= max)?.[0] ?? 'F';
}
