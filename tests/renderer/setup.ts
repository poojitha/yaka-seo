import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without globals, so Testing Library can't register its own auto-cleanup.
afterEach(cleanup);

// jsdom has no ResizeObserver; ResultsTable only uses it to track viewport height.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
