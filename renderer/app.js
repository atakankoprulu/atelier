import { World } from './scene.js';
import { Director } from './director.js';
import { runDemo } from './demo.js';

const api = window.atolye;
const $ = (id) => document.getElementById(id);

// --- 3D sahne ----------------------------------------------------------------

const world = new World($('stage'), $('overlay'));
const statusEl = $('status');
const director = new Director(world, {
  onStatus: (kind, text) => {
    statusEl.className = `status ${kind}`;
    $('status-text').textContent = text;
  },
});

// --- terminal ----------------------------------------------------------------

const term = new window.Terminal({
  fontFamily: '"SF Mono", Menlo, Monaco, monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorBlink: true,
  allowProposedApi: true,
  macOptionIsMeta: true,
  scrollback: 5000,
  theme: {
    background: '#1b1922', foreground: '#ece6dc', cursor: '#e8875f', cursorAccent: '#1b1922',
    selectionBackground: '#e8875f55',
    black: '#2a2633', red: '#ef6f6c', green: '#7fd18b', yellow: '#f2c35b',
    blue: '#7aa7e8', magenta: '#c99be6', cyan: '#6fd0c8', white: '#d9d2c6',
    brightBlack: '#5c5568', brightRed: '#ff8a86', brightGreen: '#9be3a5', brightYellow: '#ffd77e',
    brightBlue: '#9cc0ff', brightMagenta: '#ddb6f5', brightCyan: '#8fe3dc', brightWhite: '#fbf6ee',
  },
});
const fit = new window.FitAddon.FitAddon();
term.loadAddon(fit);
term.open($('terminal'));
fit.fit();

let alive = false;
function start() {
  alive = true;
  api.startPty(term.cols, term.rows);
}
start();

api.onPtyData((d) => term.write(d));
api.onPtyExit(() => {
  alive = false;
  term.write('\r\n\x1b[2m[kabuk kapandı — yeniden açmak için Enter]\x1b[0m\r\n');
});
term.onData((d) => {
  if (!alive) { if (d === '\r') { term.clear(); start(); } return; }
  api.writePty(d);
  director.userTyped();
});
term.onResize(({ cols, rows }) => api.resizePty(cols, rows));
new ResizeObserver(() => { try { fit.fit(); } catch { /* panel gizliyken */ } }).observe($('terminal'));
term.focus();

$('term-hint').textContent = 'Claude\'u çağırmak için: claude';

// Senin monitörün terminalin görünen son satırlarını gösterir.
let lastScreen = '';
setInterval(() => {
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < term.rows; i++) {
    const ln = buf.getLine(buf.viewportY + i);
    lines.push(ln ? ln.translateToString(true) : '');
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const key = lines.join('\n');
  if (key !== lastScreen) {
    lastScreen = key;
    world.setUserScreenLines(lines);
  }
}, 400);

// --- hook olayları ------------------------------------------------------------

api.onHook((ev) => director.handle(ev));

// --- düğmeler ---------------------------------------------------------------

$('btn-summon').addEventListener('click', () => {
  if (alive) api.writePty('claude\r');
  term.focus();
});

let stopDemo = null;
function demo() {
  if (stopDemo) stopDemo();
  stopDemo = runDemo((ev) => director.handle(ev));
}
$('btn-demo').addEventListener('click', () => { demo(); term.focus(); });
api.onDemo(demo);

world.setView(Number(new URLSearchParams(location.search).get('cam')) || 0);
$('btn-cam').addEventListener('click', () => { world.nextView(); term.focus(); });

// --- panel ayırıcı ----------------------------------------------------------

const divider = $('divider');
const panel = $('terminal-panel');
divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  divider.classList.add('dragging');
  const move = (ev) => {
    const w = Math.max(360, Math.min(window.innerWidth - 320, window.innerWidth - ev.clientX));
    panel.style.flexBasis = `${w}px`;
  };
  const up = () => {
    divider.classList.remove('dragging');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
