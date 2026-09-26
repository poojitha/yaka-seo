// VS Code's integrated terminal sets ELECTRON_RUN_AS_NODE=1, which makes Electron start as plain
// Node (so `require('electron').app` is undefined). Clear it before handing off to electron-vite.
const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn('electron-vite', process.argv.slice(2), { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
