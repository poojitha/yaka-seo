import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'main',
                    include: ['tests/main/**/*.test.ts'],
                    environment: 'node',
                    // Crawler tests run real crawls against a local server (and one Chromium launch).
                    testTimeout: 60_000,
                    hookTimeout: 60_000,
                },
            },
            {
                extends: true,
                test: {
                    name: 'renderer',
                    include: ['tests/renderer/**/*.test.{ts,tsx}'],
                    environment: 'jsdom',
                    setupFiles: ['tests/renderer/setup.ts'],
                },
            },
        ],
    },
});
