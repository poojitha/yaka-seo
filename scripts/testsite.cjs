// Bundles and starts the local test site (testsite/serve.ts). esbuild comes with Vite, so nothing extra to install.
const { buildSync } = require('esbuild');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const outfile = join(root, 'out', 'testsite', 'serve.mjs');
buildSync({
    entryPoints: [join(root, 'testsite', 'serve.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    alias: { '@shared': join(root, 'src', 'shared') },
    logLevel: 'warning',
});
import(pathToFileURL(outfile).href);
