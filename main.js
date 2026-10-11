// Atelier — Claude Code için 3D giydirme.
// Ana süreç: gömülü terminal (node-pty), hook olaylarını dinleyen yerel HTTP sunucusu
// ve yalnızca bu uygulamanın içindeki `claude` için geçerli hook ayarları.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const pty = require('node-pty');

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'PermissionRequest', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact',
];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);

let win = null;
let term = null;
let hookPort = 0;

// --- Hook sunucusu -----------------------------------------------------------

function startHookServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(204).end();
        try {
          const ev = JSON.parse(body);
          if (win && !win.isDestroyed()) win.webContents.send('hook', ev);
        } catch { /* bozuk yük: yok say */ }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// --- Bu uygulamaya özel kabuk ortamı ------------------------------------------

// Hook ayarlarını ve zsh başlangıç dosyalarını userData altına yazar.
// Kullanıcının ~/.claude/settings.json dosyasına dokunmaz: `claude` yalnızca
// Atelier terminalinde `--settings` ile bu dosyayı yükleyecek şekilde sarılır.
function prepareShellEnv() {
  const dir = path.join(app.getPath('userData'), 'shell');
  const zdot = path.join(dir, 'zdotdir');
  fs.mkdirSync(zdot, { recursive: true });

  const emit = path.join(__dirname, 'hooks', 'emit.sh');
  fs.chmodSync(emit, 0o755);
  const hook = [{ type: 'command', command: `"${emit}"`, timeout: 5 }];
  const hooks = {};
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [TOOL_EVENTS.has(ev) ? { matcher: '*', hooks: hook } : { hooks: hook }];
  }
  const settingsPath = path.join(dir, 'hooks-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2));

  // zsh: önce kullanıcının kendi dosyaları, sonra `claude` sarmalayıcısı.
  const src = (f) => `[ -f "$HOME/${f}" ] && source "$HOME/${f}"\n`;
  fs.writeFileSync(path.join(zdot, '.zshenv'), src('.zshenv'));
  fs.writeFileSync(path.join(zdot, '.zprofile'), src('.zprofile'));
  fs.writeFileSync(path.join(zdot, '.zlogin'), src('.zlogin'));
  fs.writeFileSync(path.join(zdot, '.zshrc'), [
    'HISTFILE="$HOME/.zsh_history"',
    src('.zshrc').trim(),
    'claude() { command claude --settings "$ATELIER_SETTINGS" "$@"; }',
    '',
  ].join('\n'));

  return { settingsPath, zdot };
}

function startTerminal(cols, rows) {
  if (term) return;
  const { settingsPath, zdot } = prepareShellEnv();
  const shell = process.env.SHELL || '/bin/zsh';
  // Atelier başka bir Claude oturumunun içinden açıldıysa onun izlerini taşıma.
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE' && !k.startsWith('ELECTRON_')));
  const env = {
    ...inherited,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Atelier',
    ATELIER_PORT: String(hookPort),
    ATELIER_SETTINGS: settingsPath,
  };
  if (path.basename(shell) === 'zsh') env.ZDOTDIR = zdot;

  term = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols, rows,
    cwd: os.homedir(),
    env,
  });
  term.onData((d) => win && !win.isDestroyed() && win.webContents.send('pty:data', d));
  term.onExit(({ exitCode }) => {
    term = null;
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', exitCode);
  });
}

// --- Pencere ------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#14121a',
    titleBarStyle: 'hiddenInset',
    title: 'Atelier',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { cam: process.env.ATELIER_CAMERA || '0' } });
  win.on('closed', () => { win = null; });

  if (process.env.ATELIER_SNAPSHOT) scheduleSnapshots();
}

// Geliştirme için: ATELIER_SNAPSHOT=dizin ATELIER_SNAPSHOT_AT=3000,8000 ile
// belirli anlarda ekran görüntüsü alıp çıkar. ATELIER_DEMO=1 demoyu başlatır.
function scheduleSnapshots() {
  const outDir = process.env.ATELIER_SNAPSHOT;
  const times = (process.env.ATELIER_SNAPSHOT_AT || '4000').split(',').map(Number);
  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  win.webContents.once('did-finish-load', () => {
    if (process.env.ATELIER_DEMO) setTimeout(() => win.webContents.send('demo'), 1500);
    times.forEach((t, i) => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `snap-${i}.png`), img.toPNG());
      if (i === times.length - 1) app.quit();
    }, t));
  });
}

ipcMain.on('pty:start', (_e, { cols, rows }) => startTerminal(cols, rows));
ipcMain.on('pty:input', (_e, data) => term && term.write(data));
ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  if (term && cols > 0 && rows > 0) term.resize(cols, rows);
});
ipcMain.handle('info', () => ({ hookPort }));

app.whenReady().then(async () => {
  hookPort = await startHookServer();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  if (term) term.kill();
  app.quit();
});
