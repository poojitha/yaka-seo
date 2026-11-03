// Downloads the Playwright browser into build/ms-playwright for electron-builder to ship as an extra resource.
// Only the headless shell: crawls always run headless, and it's ~160 MB smaller than full Chromium.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const cli = join(__dirname, '..', 'node_modules', 'playwright', 'cli.js');
execFileSync(process.execPath, [cli, 'install', '--only-shell', 'chromium'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(__dirname, '..', 'build', 'ms-playwright') },
});
