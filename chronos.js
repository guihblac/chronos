// ========== GLOBALS ==========
// Bump on every delivery. Shown in the background diagnostic so we can tell at a
// glance whether the browser is running this file or a cached older one.
const BUILD = 'B14 tab row';
const $ = id => document.getElementById(id);
const CIRC = 2 * Math.PI * 126;

let mode = 'stopwatch';
let running = false;
let startTime = 0;
let elapsed = 0;
let interval = null;
let laps = [];
let lastLapTime = 0;
let timerDuration = 0;
let timerRemaining = 0;
let pomoPhase = 'work';
let pomoRound = 1;
let pomoTotalFocus = 0;
let ambientCtx = null;
let ambientNodes = {};
let ambientGain = null;
let activeAmbient = null;
let wakeLock = null;
let recognition = null;
let voiceActive = false;
let recordingShortcut = null;
let lastSec = -1;
let matrixTimer = null;
let booted = false;
let dashFilter = 'all';
let dashRange = 0;          // days; 0 = all time
let palIndex = 0;
let palMatches = [];
let sessionTag = '';
let dialDragging = false;   // suppresses ring/digit animation under the pointer
let tabPlaced = false;      // first #tabInd placement must not animate
let clockTimer = null;      // clock mode's own loop — the core tick() only runs while `running`
let lastClockLabel = '';    // so the date under the dial isn't rewritten 30x a second
let lastClockSec = -1;

// Rounds has no real ceiling — past PIP_MAX it's a bar, not a dot per round, so
// nothing renders per-round any more and a big count costs nothing. This cap is
// just a sanity backstop against garbage/pasted input, not a UX limit.
const MAX_ROUNDS = 999999;
const PIP_MAX = 12;

// Sub-setting groups that collapse with a parent toggle (see the DEPS.forEach
// in updateUI). One entry drives both which group opens and which toggle owns
// it — a fifth dependent group later is a row here, not a fifth hand-written
// sync line somewhere else that can quietly drift from its CSS/HTML.
const DEPS = [
  ['customPaletteBlock', 'useCustomPalette'],
  ['longBreakDep', 'longBreaks'],
  ['soundDep', 'sound'],
  ['worldDep', 'worldClocks'],
  ['clockDep', 'modes.clock'],
  ['numeralsDep', 'showNumerals']
];

// Reads a settings key, or a dotted path into one. DEPS needs the second form
// now that a dependent group is gated on settings.modes.clock rather than a
// flat boolean.
function setting(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), settings);
}

// Declared order is tab order, and it's also the fallback order: when the mode
// on screen gets hidden, the first enabled one in this list takes over.
const MODES = ['stopwatch', 'timer', 'pomodoro', 'clock'];
const MODE_KEYS = { Digit1: 'stopwatch', Digit2: 'timer', Digit3: 'pomodoro', Digit4: 'clock' };

const modeTab = m => document.querySelector('.mode-tab[data-mode="' + m + '"]');
const enabledModes = () => MODES.filter(m => settings.modes[m]);

// Presentation state
// Live, not a boot-time snapshot: the Motion setting can override the OS at any
// point, and the digit roll and reveal observer both branch on this.
const OS_RM = window.matchMedia('(prefers-reduced-motion: reduce)');
function rm() {
  const m = (typeof settings === 'object' && settings) ? settings.motion : 'auto';
  return m === 'none' || (m !== 'full' && OS_RM.matches);
}
Object.defineProperty(window, 'RM', { get: rm });

// ========== ICONS ==========
// Single stroked set at 24px. Replaces the emoji chrome, which rendered
// differently on every platform and never matched the accent colour.
const ICONS = {
  mic: '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="12" width="8" height="6" rx="1.5"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  collapse: '<path d="M9 3v3a3 3 0 0 1-3 3H3"/><path d="M15 3v3a3 3 0 0 0 3 3h3"/><path d="M9 21v-3a3 3 0 0 0-3-3H3"/><path d="M15 21v-3a3 3 0 0 1 3-3h3"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 5h11l-2 3.5L16 12H5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4"/><path d="M9.5 2.5h5"/>',
  hourglass: '<path d="M6.5 3h11"/><path d="M6.5 21h11"/><path d="M8.5 3v3.8l3.5 4.4 3.5-4.4V3"/><path d="M8.5 21v-3.8l3.5-4.4 3.5 4.4V21"/>',
  tomato: '<circle cx="12" cy="14" r="7.5"/><path d="M8.5 6.5C10 5 14 5 15.5 6.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
  spark: '<path d="M12 3l2.1 6.2L20 11l-5.9 1.8L12 19l-2.1-6.2L4 11l5.9-1.8z"/>',
  sound: '<path d="M11 5L6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  moon: '<path d="M20.5 13.9A8.7 8.7 0 1 1 10.1 3.5a7 7 0 0 0 10.4 10.4z"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18h1.6a1.9 1.9 0 0 0 1.4-3.2 1.9 1.9 0 0 1 1.4-3.2H19A2.9 2.9 0 0 0 21.9 12 9 9 0 0 0 12 3z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17.5l4.8-4.5 3.4 3 3-2.6L20 17"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.4 9h17.2M3.4 15h17.2"/><path d="M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z"/>',
  quote: '<path d="M9.5 6.5C7 7.5 5.5 9.8 5.5 12.6V17h5v-5H8.2c0-1.7.6-3 1.8-3.8z"/><path d="M18 6.5c-2.5 1-4 3.3-4 6.1V17h5v-5h-2.3c0-1.7.6-3 1.8-3.8z"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  type: '<path d="M4 6.5V5h16v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  code: '<path d="M9 17l-5-5 5-5"/><path d="M15 7l5 5-5 5"/>',
  columns: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9 4.5v15M15 4.5v15"/>',
  swap: '<path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  ring: '<circle cx="12" cy="12" r="8.5" opacity=".35"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/>',
  bulb: '<path d="M9.5 17.5h5"/><path d="M10 20.5h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8v.3h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z"/>',
  tag: '<path d="M3.5 11.4V4.5a1 1 0 0 1 1-1h6.9a1 1 0 0 1 .7.3l8.1 8.1a1 1 0 0 1 0 1.4l-6.9 6.9a1 1 0 0 1-1.4 0L3.8 12.1a1 1 0 0 1-.3-.7z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
  tick: '<circle cx="12" cy="12" r="9"/><path d="M12 3v2.5"/><path d="M12 18.5V21"/><path d="M21 12h-2.5"/><path d="M5.5 12H3"/><path d="M18.36 5.64l-1.77 1.77"/><path d="M7.41 16.59l-1.77 1.77"/><path d="M18.36 18.36l-1.77-1.77"/><path d="M7.41 7.41L5.64 5.64"/>',
  volume: '<path d="M4 9.5h3L11.5 6v12L7 14.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.5a7.5 7.5 0 0 1 0 11"/>',
  notifications: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/><circle cx="18" cy="5.5" r="2.6" fill="currentColor" stroke="none"/>',
  resize: '<path d="M4 10V5.5A1.5 1.5 0 0 1 5.5 4H10"/><path d="M20 14v4.5a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M9.5 14.5l-5 5"/><path d="M14.5 9.5l5-5"/>'
};

function icon(name, size) {
  const d = ICONS[name];
  if (!d) return '';
  return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
    '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
}

function paintIcons() {
  document.querySelectorAll('[data-ico]').forEach(el => {
    const size = el.classList.contains('ctrl-btn') ? (el.classList.contains('primary') ? 26 : 20) : 18;
    el.innerHTML = icon(el.dataset.ico, size);
  });
}

// ========== CUSTOM BACKGROUND ==========
// Rewritten. Two hard rules learned the hard way:
//
//  1. Images NEVER use an object URL. Under file:// a blob URL has a null
//     origin and assigning it to img.src hangs silently — no load event, no
//     error event, nothing. Images always go through FileReader -> data URL,
//     which has no origin and always resolves. Video keeps the object URL
//     because <video> handles null-origin blobs fine and streaming a data URL
//     would mean holding the whole file in memory as base64.
//
//  2. Visibility never depends on a load event. The media fades in via a CSS
//     animation that runs the moment it's inserted, so a missed or late event
//     can't leave the screen blank. The spinner and status text are advisory
//     only — they never gate whether you can see the background.

let bgURL = null;        // object URL held for video only
// apply() rebuilds body.className from settings, which would drop has-bg —
// this flag lets it restore the class on every apply cycle.
let bgActive = false;
let bgVideo = null;      // live <video> element, for the sound/seek controls
let bgSeeking = false;   // suppress timeupdate while the user drags the bar
let bgToken = 0;         // invalidates in-flight async work on re-pick / clear
let bgGen = 0;           // invalidates in-flight IndexedDB writes
let bgDBP = null;
const BG_SAVE_LIMIT = 100 * 1024 * 1024;   // above this we skip IndexedDB
const BG_IMG_WARN = 40 * 1024 * 1024;      // base64 of this is ~53MB in memory

function fmtBytes(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  if (n >= 1048576) return Math.round(n / 1048576) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

// The persistence warning and the media status arrive at different times, and
// whichever landed last used to win. Kept separate and composed on write.
let bgLabel = '', bgSaveMsg = '';

function bgNote(msg) {
  bgLabel = msg;
  $('bgName').textContent = msg + (bgSaveMsg ? ' \u00b7 ' + bgSaveMsg : '');
}

function bgSaveNote(msg) {
  bgSaveMsg = msg;
  bgNote(bgLabel);
}

// ---------- storage ----------
function bgDB() {
  if (bgDBP) return bgDBP;
  bgDBP = new Promise((res, rej) => {
    let r;
    // Chrome disables IndexedDB entirely on file:// — this throws, not rejects
    try { r = indexedDB.open('chronos_bg', 1); }
    catch (e) { return rej(e); }
    if (!r) return rej(new Error('no indexedDB'));
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  bgDBP.catch(() => { bgDBP = null; });
  return bgDBP;
}

function bgPut(blob, name) {
  return bgDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ blob, name, type: blob.type, size: blob.size }, 'bg');
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}

function bgGet() {
  return bgDB().then(db => new Promise((res, rej) => {
    const rq = db.transaction('files', 'readonly').objectStore('files').get('bg');
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  })).catch(() => null);
}

function bgDel() {
  return bgDB().then(db => new Promise(res => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete('bg');
    tx.oncomplete = res;
    tx.onerror = res;
  })).catch(() => {});
}

// ---------- rendering ----------
function readDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error || new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

function vidTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}

function bgReset() {
  const host = $('bgMedia');
  bgVideo = null;
  $('bgVideoCtl').style.display = 'none';
  host.innerHTML = '';
  host.classList.remove('loading');
  if (bgURL) { URL.revokeObjectURL(bgURL); bgURL = null; }
}

function renderBg(rec) {
  const token = ++bgToken;
  bgSaveMsg = '';
  bgReset();

  if (!rec || !rec.blob) {
    bgActive = false;
    document.body.classList.remove('has-bg');
    bgNote('No background set');
    $('bgBlurNote').style.display = 'none';
    $('bgBlurSlider').disabled = false;
    return;
  }

  const isVideo = (rec.type || '').indexOf('video') === 0;
  const label = (rec.name || 'Background') + (rec.size ? ' \u00b7 ' + fmtBytes(rec.size) : '');
  bgActive = true;
  document.body.classList.add('has-bg');

  // Blurring video means filtering every frame on the compositor — images only
  $('bgBlurNote').style.display = isVideo && settings.bgBlur > 14 ? '' : 'none';
  $('bgBlurSlider').disabled = false;
  $('bgVideoCtl').style.display = isVideo ? '' : 'none';

  isVideo ? showVideo(rec, label, token) : showImage(rec, label, token);
}

function showImage(rec, label, token) {
  const host = $('bgMedia');
  host.classList.add('loading');
  bgNote(label + ' \u2014 loading\u2026');

  readDataURL(rec.blob).then(src => {
    if (token !== bgToken) return;          // superseded while reading
    const im = document.createElement('img');
    im.className = 'bg-img';
    im.alt = '';
    im.src = src;
    host.appendChild(im);
    host.classList.remove('loading');
    bgNote(label + (rec.blob.size > BG_IMG_WARN ? ' \u00b7 large file' : ''));
    applyBgFilters();
  }).catch(() => {
    if (token !== bgToken) return;
    host.classList.remove('loading');
    bgActive = false;
    document.body.classList.remove('has-bg');
    bgNote('Could not read that image \u2014 try JPEG, PNG or WebP');
  });
}

function showVideo(rec, label, token) {
  const host = $('bgMedia');
  host.classList.add('loading');
  bgNote(label + ' \u2014 loading\u2026');

  bgURL = URL.createObjectURL(rec.blob);
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.loop = true;
  v.autoplay = true;
  v.preload = 'auto';
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');

  const settle = msg => {
    if (token !== bgToken) return;
    host.classList.remove('loading');
    bgNote(msg || label);
    v.play().catch(() => {});
  };

  v.addEventListener('loadeddata', () => settle(), { once: true });
  v.addEventListener('canplay', () => settle(), { once: true });

  v.addEventListener('error', () => {
    if (token !== bgToken) return;
    host.classList.remove('loading');
    bgActive = false;
    document.body.classList.remove('has-bg');
    const code = v.error && v.error.code;
    bgNote(code === 4
      ? 'Browser can\u2019t decode this file \u2014 try MP4 (H.264) or WebM. HEVC, MKV and AVI usually fail.'
      : 'Could not load that video.');
  }, { once: true });

  // Files with the moov atom at the end (phones, cameras, OBS) must be read in
  // full before the first frame. Say so rather than spinning forever.
  setTimeout(() => {
    if (token === bgToken && host.classList.contains('loading'))
      settle(label + ' \u2014 still buffering; large or non-streamable file');
  }, 6000);

  v.src = bgURL;
  host.appendChild(v);
  bgVideo = v;

  v.addEventListener('loadedmetadata', () => {
    if (token !== bgToken) return;
    $('bgTimeDur').textContent = vidTime(v.duration);
    $('bgSeek').value = 0;
  });

  v.addEventListener('timeupdate', () => {
    if (token !== bgToken || bgSeeking || !v.duration) return;
    $('bgSeek').value = Math.round(v.currentTime / v.duration * 1000);
    $('bgTimeCur').textContent = vidTime(v.currentTime);
  });

  applyBgFilters();
  applyBgAudio();
}

// Autoplay is only granted to muted video, so we start muted and unmute after.
// If the browser refuses to keep playing, fall back to muted rather than freeze.
function applyBgAudio() {
  if (!bgVideo) return;
  bgVideo.volume = settings.bgVolume;
  bgVideo.muted = !settings.bgSound;
  if (bgVideo.paused) {
    bgVideo.play().catch(() => {
      bgVideo.muted = true;
      settings.bgSound = false;
      updateUI();
      bgVideo.play().catch(() => {});
    });
  }
}

function applyBgFilters() {
  document.body.style.setProperty('--bg-dim', (settings.bgDim / 100).toFixed(2));
  const media = $('bgMedia').firstElementChild;
  if (!media) return;
  const b = settings.bgBlur;
  media.style.filter = b ? 'blur(' + b + 'px)' : '';
  // Blur samples past the edges, so scale up to hide translucent borders
  media.style.transform = b ? 'scale(' + (1 + b / 90).toFixed(3) + ')' : '';
  // A blurred video is a per-frame convolution over the whole viewport, so it
  // gets promoted to its own layer and the blur is applied once on the GPU
  // rather than recomputed against everything painted behind it.
  if (media.tagName === 'VIDEO') media.style.willChange = b ? 'filter, transform' : '';
}

// ---------- entry points ----------
function loadBg() {
  bgGet().then(rec => { if (rec && rec.blob) renderBg(rec); }).catch(() => {});
}

function pickBg(file) {
  if (!file) return;
  const gen = ++bgGen;
  renderBg({ blob: file, name: file.name, type: file.type, size: file.size });

  // A multi-hundred-MB write saturates the disk, stalls decode, and queues
  // ahead of any later delete so Remove appears to hang. Skip it entirely.
  if (file.size > BG_SAVE_LIMIT) {
    bgSaveNote('too large to save, this session only');
    bgDel();
    return;
  }

  bgPut(file, file.name).then(() => {
    if (gen !== bgGen) bgDel();          // a clear/re-pick landed mid-write
  }).catch(() => {
    if (gen === bgGen) bgSaveNote('can\u2019t be saved here, this session only');
  });
}

function clearBg() {
  bgGen++;
  renderBg(null);
  bgDel();
}

// ========== SETTINGS ==========
const settings = {
  dark: true,
  fullscreen: false,
  showRing: true,
  showTicks: true,
  showNumerals: false,
  numeralStyle: 'quarters',
  tips: true,
  visualTheme: 'default',
  motion: 'auto',
  colorTheme: 'indigo',
  customColor: null,
  clockScale: 100,
  uiScale: 100,
  useCustomPalette: false,
  customPalette: { bg: null, card: null, border: null, text: null, text2: null },
  dialSize: 340,
  ringThickness: 8,
  timeFont: 'mono',
  customFontName: '',
  swapRails: false,
  topBarOrder: ['theme', 'voice', 'dashboard', 'pip', 'fullscreen', 'settings'],
  showAnalytics: true,
  showAmbientBar: true,
  showQuotes: true,
  compact: false,
  wide: true,
  showTagCard: true,
  showSplit: false,
  signature: true,
  bgDim: 35,
  bgBlur: 0,
  bgSound: false,
  bgVolume: 0.5,
  dailyGoal: 120,
  presets: [60, 180, 300, 600, 1500],
  recentTags: [],
  shutSections: [],
  hour12: false,
  clockSeconds: false,
  // Which mode tabs exist. Clock is off by default — three tabs is the shape
  // this app has always had. At least one is always on; see load().
  modes: { stopwatch: true, timer: true, pomodoro: true, clock: false },
  clockTz: '',        // '' = this device. Otherwise a key into tzMap.
  bgRun: true,        // leaving a mode lets its clock carry on
  clockDate: true,
  notifications: false,
  customCSS: '',
  customQuotes: null,
  pomo: { work: 1500, short: 300, long: 900, rounds: 4 },
  pomoVersion: 2,
  sound: true,
  alertSound: 'chime',
  volume: 0.5,
  tick: false,
  confetti: true,
  voice: false,
  wake: true,
  confirm: false,
  worldClocks: true,
  clocks: ['London', 'Tokyo', 'New York'],
  autoBreak: true,
  longBreaks: true,
  keys: { toggle: 'Space', lap: 'KeyL', reset: 'KeyR', fullscreen: 'KeyF', settings: 'KeyS' }
};

let history = [];
let analytics = { sessions: 0, focus: 0, streak: 0, lastDate: null };

// ========== DATA ==========
const DEFAULT_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Time is what we want most, but what we use worst.", author: "William Penn" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" }
];

const colors = [
  { n: 'indigo', h: '#6366f1' }, { n: 'blue', h: '#3b82f6' }, { n: 'cyan', h: '#06b6d4' },
  { n: 'teal', h: '#14b8a6' }, { n: 'green', h: '#22c55e' }, { n: 'orange', h: '#f97316' },
  { n: 'red', h: '#ef4444' }, { n: 'pink', h: '#ec4899' }, { n: 'purple', h: '#a855f7' },
  { n: 'amber', h: '#f59e0b' }
];

const tzMap = {
  'London': 'Europe/London', 'Dublin': 'Europe/Dublin', 'Lisbon': 'Europe/Lisbon',
  'Paris': 'Europe/Paris', 'Berlin': 'Europe/Berlin', 'Madrid': 'Europe/Madrid',
  'Rome': 'Europe/Rome', 'Athens': 'Europe/Athens', 'Moscow': 'Europe/Moscow',
  'Dubai': 'Asia/Dubai', 'Mumbai': 'Asia/Kolkata', 'Bangkok': 'Asia/Bangkok',
  'Singapore': 'Asia/Singapore', 'Hong Kong': 'Asia/Hong_Kong', 'Shanghai': 'Asia/Shanghai',
  'Seoul': 'Asia/Seoul', 'Tokyo': 'Asia/Tokyo', 'Sydney': 'Australia/Sydney',
  'Auckland': 'Pacific/Auckland', 'Honolulu': 'Pacific/Honolulu',
  'Los Angeles': 'America/Los_Angeles', 'Denver': 'America/Denver',
  'Chicago': 'America/Chicago', 'New York': 'America/New_York',
  'Toronto': 'America/Toronto', 'Mexico City': 'America/Mexico_City',
  'São Paulo': 'America/Sao_Paulo', 'UTC': 'UTC'
};

const MAX_CLOCKS = 6;

// ========== TIME HELPERS ==========
function parseMMSS(str) {
  str = String(str).trim();
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  }
  return parseInt(str) || 60;
}

function formatMMSS(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatFocus(secs) {
  if (secs >= 3600) return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
  if (secs >= 60) return Math.floor(secs / 60) + 'm';
  return secs + 's';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Reading the clock in another zone means going through Intl, but constructing
// a DateTimeFormat is expensive and the clock loop runs at 30fps — so the
// formatter is built once per zone and reused until the zone changes.
let tzFmt = null, tzFmtFor = null;
function tzTime(d) {
  const tz = settings.clockTz && tzMap[settings.clockTz];
  if (!tz) return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
  try {
    if (tzFmtFor !== tz) {
      // hourCycle h23 rather than hour12:false — the latter reports midnight as
      // hour 24 in some engines, which would render "24:07" for seven minutes
      // past midnight.
      tzFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      tzFmtFor = tz;
    }
    const p = {};
    tzFmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return { h: +p.hour, m: +p.minute, s: +p.second };
  } catch (e) {
    // A zone the engine doesn't carry shouldn't strand the face on a blank.
    return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
  }
}

// Built by hand rather than toLocaleTimeString because the digit-roll in
// updateDisplay() diffs character by character: it needs the string to keep a
// stable shape, and a locale can hand back narrow no-break spaces, dots for
// separators, or a leading zero that comes and goes.
function clockString(d) {
  const t = tzTime(d || new Date());
  let h = t.h;
  const mer = h < 12 ? 'AM' : 'PM';
  if (settings.hour12) { h = h % 12 || 12; }
  let s = (settings.hour12 ? String(h) : String(h).padStart(2, '0')) + ':' +
    String(t.m).padStart(2, '0');
  if (settings.clockSeconds) s += ':' + String(t.s).padStart(2, '0');
  if (settings.hour12) s += ' ' + mer;
  return s;
}

function clockDate(d) {
  d = d || new Date();
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (settings.clockTz && tzMap[settings.clockTz]) opts.timeZone = tzMap[settings.clockTz];
  try {
    return d.toLocaleDateString(undefined, opts);
  } catch (e) {
    return d.toDateString();
  }
}

function lighten(hex, pct) {
  const n = hex.replace('#', '');
  const num = parseInt(n, 16);
  const amt = Math.round(255 * pct / 100);
  const r = Math.min(255, (num >> 16) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ========== INIT ==========
function init() {
  load();
  paintIcons();
  renderPresets();
  loadBg();
  renderColors();
  renderClocks();
  renderQuotes();
  applyCustomCSS();
  apply();
  bindEvents();
  updateDisplay();
  updateWorldClocks();
  updateStats();
  setInterval(updateWorldClocks, 1000);
  if (settings.tips) setTimeout(showQuote, 2000);
  buildTicks();
  boot();
  a11yInit();
  registerSW();
  
  let savedTitle = null;
  try { savedTitle = localStorage.getItem('chronos_title'); } catch (e) {}
  if (savedTitle) $('titleEdit').textContent = '⏱ ' + savedTitle;

  // Launch shortcuts from the installed app's icon (manifest.webmanifest).
  // Checked against settings.modes as well as MODES, so a shortcut can't drop
  // the app into a mode the user has switched off.
  const want = new URLSearchParams(location.search).get('mode');
  if (MODES.includes(want) && settings.modes[want] && want !== mode) switchMode(want);
}

// ========== STORAGE ==========
function load() {
  try {
    const s = localStorage.getItem('chronos_s');
    if (s) {
      const parsed = JSON.parse(s);
      Object.assign(settings, parsed);
      if (parsed.keys) settings.keys = parsed.keys;
      // Migrate old minute-based pomo settings
      if (parsed.pomo && !parsed.pomoVersion) {
        settings.pomo.work = (parsed.pomo.work || 25) * 60;
        settings.pomo.short = (parsed.pomo.short || 5) * 60;
        settings.pomo.long = (parsed.pomo.long || 15) * 60;
        settings.pomoVersion = 2;
        save();
      }
      // Drop any saved city that is no longer in the list
      if (!Array.isArray(settings.clocks)) settings.clocks = ['London', 'Tokyo', 'New York'];
      settings.clocks = settings.clocks.filter(c => tzMap[c]).slice(0, MAX_CLOCKS);
      // B8 shipped clock visibility as a flat `clockTab` boolean before the
      // other three modes became hideable too. Carry the choice across rather
      // than silently resetting it.
      if (!parsed.modes && 'clockTab' in parsed) settings.modes.clock = !!parsed.clockTab;
    }
    if (!Array.isArray(settings.customQuotes) || !settings.customQuotes.length) settings.customQuotes = DEFAULT_QUOTES.slice();
    if (!Array.isArray(settings.recentTags)) settings.recentTags = [];
    if (!Array.isArray(settings.shutSections)) settings.shutSections = [];
    const h = localStorage.getItem('chronos_h');
    if (h) history = JSON.parse(h);
    const a = localStorage.getItem('chronos_a');
    if (a) Object.assign(analytics, JSON.parse(a));
  } catch (e) { console.error('Load error:', e); }
  
  // Outside the try: if localStorage is unavailable (private mode, blocked
  // storage, some file:// contexts) the block above throws part-way through and
  // these defaults never get applied, leaving customQuotes null and crashing
  // init on the first render.
  if (!Array.isArray(settings.customQuotes) || !settings.customQuotes.length) settings.customQuotes = DEFAULT_QUOTES.slice();
  if (!Array.isArray(settings.recentTags)) settings.recentTags = [];
  if (!Array.isArray(settings.shutSections)) settings.shutSections = [];
  if (!Array.isArray(settings.clocks)) settings.clocks = ['London', 'Tokyo', 'New York'];
  const DEFAULT_TOPBAR_ORDER = ['theme', 'voice', 'dashboard', 'pip', 'fullscreen', 'settings'];
  if (!Array.isArray(settings.topBarOrder) || settings.topBarOrder.length !== DEFAULT_TOPBAR_ORDER.length ||
      !DEFAULT_TOPBAR_ORDER.every(k => settings.topBarOrder.includes(k))) {
    settings.topBarOrder = DEFAULT_TOPBAR_ORDER.slice();
  }
  if (!settings.customPalette || typeof settings.customPalette !== 'object') {
    settings.customPalette = { bg: null, card: null, border: null, text: null, text2: null };
  } else {
    ['bg', 'card', 'border', 'text', 'text2'].forEach(k => {
      if (!(k in settings.customPalette)) settings.customPalette[k] = null;
    });
  }
  if (!['auto', 'full', 'none'].includes(settings.motion)) settings.motion = 'auto';
  delete settings.clockTab;
  if (!settings.modes || typeof settings.modes !== 'object') settings.modes = {};
  MODES.forEach(m => {
    settings.modes[m] = m in settings.modes ? !!settings.modes[m] : m !== 'clock';
  });
  // An imported or hand-edited file can turn everything off, which would leave
  // the app with no dial to show and no tab to get one back.
  if (!enabledModes().length) settings.modes.stopwatch = true;
  if (!tzMap[settings.clockTz]) settings.clockTz = '';
  settings.clockDate = !!settings.clockDate;
  settings.bgRun = settings.bgRun !== false;
  const clamp = (v, lo, hi, dflt) => { const n = +v; return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n)); };
  settings.clockScale = clamp(settings.clockScale, 60, 130, 100);
  settings.uiScale = clamp(settings.uiScale, 85, 125, 100);
  // The slider's ceiling moved from 360 to 400; clamp so an imported or stale
  // saved value can't sit outside what the control can express.
  settings.dialSize = Math.round(clamp(settings.dialSize, 200, 400, 340));
  settings.ringThickness = Math.round(clamp(settings.ringThickness, 2, 20, 8));
  // The inline "1/4" editor used to write this unclamped, so a saved file can
  // hold any number at all.
  if (!settings.pomo || typeof settings.pomo !== 'object') settings.pomo = { work: 1500, short: 300, long: 900, rounds: 4 };
  settings.pomo.rounds = Math.round(clamp(settings.pomo.rounds, 1, MAX_ROUNDS, 4));
  if (!Array.isArray(history)) history = [];
  settings.fullscreen = false;
}

function save() {
  // save() runs from nearly every handler; an unavailable or full quota must not
  // take the click with it.
  try {
    localStorage.setItem('chronos_s', JSON.stringify(settings));
    localStorage.setItem('chronos_h', JSON.stringify(history.slice(-500)));
    localStorage.setItem('chronos_a', JSON.stringify(analytics));
  } catch (e) { console.warn('Save failed:', e); }
}

// ========== APPLY SETTINGS ==========
function apply() {
  const b = document.body;
  b.className = '';
  if (!settings.dark) b.classList.add('light');
  $('themeToggleBtn').innerHTML = icon(settings.dark ? 'moon' : 'sun', 18);
  if (settings.fullscreen) b.classList.add('fullscreen');
  if (!settings.tips) b.classList.add('hide-tips');
  if (!settings.showQuotes) b.classList.add('hide-quotes');
  if (settings.compact) b.classList.add('compact');
  if (settings.wide) b.classList.add('wide');
  if (bgActive) b.classList.add('has-bg');   // rebuilt className would drop it
  if (settings.timeFont !== 'mono') b.classList.add('font-' + settings.timeFont);
  if (settings.visualTheme !== 'default') b.classList.add('visual-' + settings.visualTheme);
  // Gates each direction's one big effect (Safelight's pool of light, Pace
  // Clock's 60 lamps, Bahnhof's held second) without touching its palette.
  if (settings.signature) b.classList.add('signature');
  b.classList.add('theme-' + settings.colorTheme);
  b.classList.add('motion-' + settings.motion);
  if (settings.colorTheme === 'custom' && settings.customColor) {
    b.style.setProperty('--accent', settings.customColor);
    b.style.setProperty('--accent2', lighten(settings.customColor, 18));
  } else {
    b.style.removeProperty('--accent');
    b.style.removeProperty('--accent2');
  }
  applyCustomPalette();
  if (settings.timeFont === 'custom') applyCustomFont(settings.customFontName);
  b.classList.toggle('rails-swapped', settings.swapRails);
  b.style.setProperty('--dial-d', settings.dialSize + 'px');
  b.style.setProperty('--ring-w', settings.ringThickness);
  b.style.setProperty('--clock-scale', settings.clockScale / 100);
  b.style.setProperty('--ui-scale', settings.uiScale / 100);
  $('ringProgress').classList.toggle('hidden', !settings.showRing);
  $('ticks').classList.toggle('hidden', !settings.showTicks);
  $('numerals').classList.toggle('hidden', !settings.showNumerals);
  buildNumerals();
  $('worldClocks').style.display = settings.worldClocks ? 'flex' : 'none';
  $('analyticsMini').style.display = settings.showAnalytics ? '' : 'none';
  $('voiceBtn').style.display = settings.voice ? '' : 'none';
  $('tagCard').style.display = settings.showTagCard ? '' : 'none';
  if (!settings.voice && voiceActive) toggleVoice();
  if (!settings.voice) $('voiceIndicator').classList.remove('show');
  $('ambientBar').style.display = settings.showAmbientBar ? '' : 'none';
  const on = enabledModes();
  MODES.forEach(m => modeTab(m).classList.toggle('hidden', !settings.modes[m]));
  // One mode is not a choice, so the row stops being a control and becomes
  // decoration taking up the top of the screen. This is what "just Pomodoro"
  // is supposed to look like.
  $('modeTabs').classList.toggle('solo', on.length < 2);
  // The tab row is proportioned for three; a fourth needs tighter padding. CSS
  // can't see settings.modes, so the count goes onto the element.
  $('modeTabs').dataset.tabs = on.length;
  settings.visualTheme === 'matrix' ? startMatrix() : stopMatrix();
  reorderTopBar();
  // Hiding the mode you're standing in would otherwise leave the dial in a
  // state with no tab to leave it by.
  if (!settings.modes[mode]) switchMode(on[0]);
  syncClockLoop();   // Motion can change here, and the loop's rate is keyed to it
  syncBodyState();
  updateUI();
  requestAnimationFrame(moveTab);
}

// ========== CUSTOM BASE PALETTE ==========
const PALETTE_VARS = { bg: '--bg', card: '--card', border: '--border', text: '--text', text2: '--text2' };

function applyCustomPalette() {
  const b = document.body;
  Object.keys(PALETTE_VARS).forEach(key => {
    const v = settings.customPalette[key];
    if (settings.useCustomPalette && v) b.style.setProperty(PALETTE_VARS[key], v);
    else b.style.removeProperty(PALETTE_VARS[key]);
  });
}

// Seeds the pickers from what's actually on screen so turning the toggle on
// doesn't jump straight to editing an all-null (black) palette.
function seedCustomPaletteIfEmpty() {
  const hasAny = Object.values(settings.customPalette).some(Boolean);
  if (hasAny) return;
  const cs = getComputedStyle(document.body);
  Object.keys(PALETTE_VARS).forEach(key => {
    settings.customPalette[key] = cs.getPropertyValue(PALETTE_VARS[key]).trim() || settings.customPalette[key];
  });
}

// ========== CUSTOM FONT ==========
function applyCustomFont(name) {
  name = (name || '').trim();
  if (!name) return;
  let link = document.getElementById('customFontLink');
  if (!link) {
    link = document.createElement('link');
    link.id = 'customFontLink';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  const family = encodeURIComponent(name).replace(/%20/g, '+');
  link.href = 'https://fonts.googleapis.com/css2?family=' + family + ':wght@200;300;400;500;600;700&display=swap';
  document.body.style.setProperty('--time-font-custom', "'" + name.replace(/'/g, '') + "', 'JetBrains Mono', monospace");
}

// ========== TOP BAR ORDER ==========
const TOPBAR_LABELS = { theme: 'Theme Toggle', voice: 'Voice Control', dashboard: 'Dashboard', pip: 'Picture-in-Picture', fullscreen: 'Fullscreen', settings: 'Settings' };

function reorderTopBar() {
  const host = document.querySelector('.top-actions');
  settings.topBarOrder.forEach(key => {
    const btn = host.querySelector('[data-key="' + key + '"]');
    if (btn) host.appendChild(btn);
  });
}

function renderTopBarOrderList() {
  const order = settings.topBarOrder;
  $('topBarOrderList').innerHTML = order.map((key, i) =>
    '<div class="order-row" data-key="' + key + '">' +
    '<span>' + TOPBAR_LABELS[key] + '</span>' +
    '<span class="order-btns">' +
    '<button class="order-btn" data-dir="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
    '<button class="order-btn" data-dir="down" data-i="' + i + '"' + (i === order.length - 1 ? ' disabled' : '') + '>↓</button>' +
    '</span></div>'
  ).join('');
}

function updateUI() {
  $('darkToggle').classList.toggle('active', settings.dark);
  $('fsToggle').classList.toggle('active', settings.fullscreen);
  $('ringToggle').classList.toggle('active', settings.showRing);
  $('ticksToggle').classList.toggle('active', settings.showTicks);
  $('numeralsToggle').classList.toggle('active', settings.showNumerals);
  $('numeralsDep').classList.toggle('open', settings.showNumerals);
  document.querySelectorAll('#numeralSeg .seg-btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.numerals === settings.numeralStyle));
  $('numeralSeg').style.setProperty('--seg-i',
    ['quarters', 'all', 'minutes'].indexOf(settings.numeralStyle));
  $('tipsToggle').classList.toggle('active', settings.tips);
  $('soundToggle').classList.toggle('active', settings.sound);
  $('tickToggle').classList.toggle('active', settings.tick);
  $('confettiToggle').classList.toggle('active', settings.confetti);
  $('voiceToggle').classList.toggle('active', settings.voice);
  $('wakeToggle').classList.toggle('active', settings.wake);
  $('confirmToggle').classList.toggle('active', settings.confirm);
  $('worldToggle').classList.toggle('active', settings.worldClocks);
  $('autoBreakToggle').classList.toggle('active', settings.autoBreak);
  $('longBreakToggle').classList.toggle('active', settings.longBreaks);
  $('longBreakInput').disabled = !settings.longBreaks;
  $('analyticsToggle').classList.toggle('active', settings.showAnalytics);
  $('ambientBarToggle').classList.toggle('active', settings.showAmbientBar);
  $('quotesToggle').classList.toggle('active', settings.showQuotes);
  $('compactToggle').classList.toggle('active', settings.compact);
  $('hour12Toggle').classList.toggle('active', settings.hour12);
  $('clockSecondsToggle').classList.toggle('active', settings.clockSeconds);
  $('clockDateToggle').classList.toggle('active', settings.clockDate);
  const soleMode = enabledModes().length === 1;
  MODES.forEach(m => {
    const t = $('mode' + m[0].toUpperCase() + m.slice(1) + 'Toggle');
    t.classList.toggle('active', settings.modes[m]);
    // The one remaining mode reads as locked rather than simply not responding
    t.classList.toggle('locked', soleMode && settings.modes[m]);
  });
  $('bgRunToggle').classList.toggle('active', settings.bgRun);
  $('clockOffNote').style.display = settings.modes.clock ? 'none' : '';
  document.querySelectorAll('#tzGrid .clock-opt').forEach(o =>
    o.classList.toggle('active', o.dataset.tz === settings.clockTz));
  $('notifToggle').classList.toggle('active', settings.notifications);

  // Sub-settings that collapse with the toggle governing them. Table-driven so
  // a new dependent group is one entry here, not a second hand-synced spot
  // that can drift from it.
  DEPS.forEach(([id, key]) => $(id).classList.toggle('open', !!setting(key)));

  $('customPaletteToggle').classList.toggle('active', settings.useCustomPalette);
  $('paletteBgPicker').value = settings.customPalette.bg || '#0a0a0f';
  $('paletteCardPicker').value = settings.customPalette.card || '#12121a';
  $('paletteBorderPicker').value = settings.customPalette.border || '#1e1e2e';
  $('paletteTextPicker').value = settings.customPalette.text || '#ffffff';
  $('paletteText2Picker').value = settings.customPalette.text2 || '#888888';

  $('customFontRow').style.display = settings.timeFont === 'custom' ? '' : 'none';
  $('customFontInput').value = settings.customFontName || '';

  $('railsSwapToggle').classList.toggle('active', settings.swapRails);
  renderTopBarOrderList();

  // Update pomo inputs
  $('workInput').value = formatMMSS(settings.pomo.work);
  $('breakInput').value = formatMMSS(settings.pomo.short);
  $('longBreakInput').value = formatMMSS(settings.pomo.long);
  $('roundsInput').value = settings.pomo.rounds;

  $('volSlider').value = settings.volume * 100;
  $('volVal').textContent = Math.round(settings.volume * 100) + '%';

  $('dialSizeSlider').value = settings.dialSize;
  $('dialSizeVal').textContent = settings.dialSize + 'px';
  $('ringThicknessSlider').value = settings.ringThickness;
  $('ringThicknessVal').textContent = settings.ringThickness + 'px';
  $('clockScaleSlider').value = settings.clockScale;
  $('clockScaleVal').textContent = settings.clockScale + '%';
  $('uiScaleSlider').value = settings.uiScale;
  $('uiScaleVal').textContent = settings.uiScale + '%';
  $('customColorPicker').value = settings.customColor || '#6366f1';
  $('customCssInput').value = settings.customCSS || '';
  $('wideToggle').classList.toggle('active', settings.wide);
  $('tagCardToggle').classList.toggle('active', settings.showTagCard);
  $('splitToggle').classList.toggle('active', settings.showSplit);
  $('signatureToggle').classList.toggle('active', settings.signature);
  // Turning it off mid-flash shouldn't leave the overlay stranded on the dial.
  if (!settings.showSplit) $('splitDisplay').classList.remove('show');
  $('bgDimSlider').value = settings.bgDim;
  $('bgDimVal').textContent = settings.bgDim + '%';
  $('bgSoundToggle').classList.toggle('active', settings.bgSound);
  $('bgVolSlider').value = settings.bgVolume * 100;
  $('bgVolVal').textContent = Math.round(settings.bgVolume * 100) + '%';
  $('bgBlurSlider').value = settings.bgBlur;
  $('bgBlurVal').textContent = settings.bgBlur + 'px';
  $('goalSlider').value = settings.dailyGoal;
  $('goalVal').textContent = formatGoal(settings.dailyGoal);
  $('goalCap').textContent = 'of ' + formatGoal(settings.dailyGoal) + ' goal';
  updateGoal();
  renderMiniWeek();
  renderPips();
  renderTagChips();

  document.querySelectorAll('.theme-opt').forEach(t => t.classList.toggle('active', t.dataset.theme === settings.visualTheme));
  document.querySelectorAll('.color-opt').forEach(c => c.classList.toggle('active', c.dataset.color === settings.colorTheme));
  document.querySelectorAll('.font-opt').forEach(f => f.classList.toggle('active', f.dataset.font === settings.timeFont));
  document.querySelectorAll('.sound-opt').forEach(s => s.classList.toggle('active', s.dataset.sound === settings.alertSound));
  // Scoped to #clockGrid. The timezone picker reuses .clock-opt for the same
  // chip look, so a bare '.clock-opt' sweep reaches into that grid too — and
  // since those chips carry data-tz rather than data-city, every one of them
  // reads as "not a selected city" and gets stripped of .active on the next
  // updateUI. That's what was un-highlighting the chosen zone.
  document.querySelectorAll('#clockGrid .clock-opt').forEach(c => {
    const on = settings.clocks.includes(c.dataset.city);
    c.classList.toggle('active', on);
    c.classList.toggle('disabled', !on && settings.clocks.length >= MAX_CLOCKS);
  });
  
  updateShortcutDisplay();
  syncSliders();
  syncSelectors();
  const mi = ['auto', 'full', 'none'].indexOf(settings.motion);
  $('motionSeg').style.setProperty('--seg-i', mi);
  document.querySelectorAll('#motionSeg .seg-btn').forEach(s =>
    s.classList.toggle('is-active', s.dataset.motion === settings.motion));

  // ARIA last, so it mirrors the classes every line above just settled.
  if (typeof a11ySync === 'function') a11ySync();
}

// The selector header is the only thing visible once a section is collapsed,
// so it has to carry the current choice: name plus a swatch that previews it.
function syncSelectors() {
  const t = document.querySelector('.theme-opt.active');
  $('themeStatus').textContent = t ? t.querySelector('.name').textContent : 'Default';
  $('themeSwatch').className = 'sel-swatch sw-' + settings.visualTheme;
  const c = colors.find(c => c.n === settings.colorTheme);
  $('accentStatus').textContent = c ? c.n[0].toUpperCase() + c.n.slice(1) : 'Custom';
  $('accentSwatch').style.background = c ? c.h : (settings.customColor || 'var(--accent)');
}

// Paints the filled portion of every range input. The Leonida panel fills its
// track up to the thumb; a bare <input type=range> can't do that in CSS alone,
// so the percentage rides on --sp and the track gradient reads it.
function syncSliders() {
  document.querySelectorAll('.slider').forEach(s => {
    const mn = +s.min || 0, mx = +s.max || 100;
    s.style.setProperty('--sp', (mx > mn ? (s.value - mn) / (mx - mn) * 100 : 0) + '%');
  });
}

function updateShortcutDisplay() {
  document.querySelectorAll('.shortcut-input').forEach(inp => {
    const action = inp.dataset.action;
    const code = settings.keys[action];
    inp.value = codeToDisplay(code);
  });
}

function codeToDisplay(code) {
  if (!code) return '?';
  if (code === 'Space') return 'Space';
  return code.replace('Key', '').replace('Digit', '');
}

function renderColors() {
  $('colorGrid').innerHTML = colors.map(c =>
    '<div class="color-opt' + (c.n === settings.colorTheme ? ' active' : '') + '" data-color="' + c.n + '" style="background:' + c.h + '"></div>'
  ).join('');
}

function renderClocks() {
  $('clockGrid').innerHTML = Object.keys(tzMap).map(c =>
    '<div class="clock-opt" data-city="' + c + '">' + c + '</div>'
  ).join('');
  // Same chip component as the world-clock picker directly below it, which is
  // the point: one picks the single zone the dial reads, the other picks the
  // handful the strip lists.
  $('tzGrid').innerHTML = '<div class="clock-opt" data-tz="">Local</div>' +
    Object.keys(tzMap).map(c =>
      '<div class="clock-opt" data-tz="' + c + '">' + c + '</div>'
    ).join('');
}

function renderQuotes() {
  $('quotesList').innerHTML = settings.customQuotes.map((q, i) =>
    '<div class="quote-item"><div class="quote-item-text">"' + esc(q.text) + '"<span class="quote-item-author"> — ' + esc(q.author) + '</span></div><button class="quote-del-btn" data-i="' + i + '">✕</button></div>'
  ).join('');
}

function applyCustomCSS() {
  let tag = document.getElementById('userCustomCSS');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'userCustomCSS';
    document.head.appendChild(tag);
  }
  tag.textContent = settings.customCSS || '';
}

// ========== EVENT BINDING ==========
function bindEvents() {
  document.addEventListener('input', e => { if (e.target.classList.contains('slider')) syncSliders(); });
  $('motionSeg').onclick = e => {
    const s = e.target.closest('.seg-btn');
    if (!s) return;
    settings.motion = s.dataset.motion;
    save(); apply();
  };

  $('numeralSeg').onclick = e => {
    const s = e.target.closest('.seg-btn');
    if (!s) return;
    settings.numeralStyle = s.dataset.numerals;
    save(); apply();
  };

  document.querySelectorAll('.sel-head').forEach(h => {
    h.onclick = () => {
      const open = h.parentElement.classList.toggle('open');
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  });
  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(t => t.onclick = () => switchMode(t.dataset.mode));
  
  // Main controls
  $('playBtn').onclick = togglePlay;
  $('resetBtn').onclick = reset;
  $('lapBtn').onclick = recordLap;
  $('timeDisplay').ondblclick = editTime;
  $('pomoRound').onclick = editPomoRound;
  $('pomoTotal').onclick = editPomoFocus;
  $('pomoBreak').onclick = editPomoBreak;
  
  // Presets
  $('presets').onclick = e => {
    const x = e.target.closest('.preset-x');
    if (x) { e.stopPropagation(); return dropPreset(+x.dataset.drop); }
    const b = e.target.closest('.preset-btn');
    if (!b) return;
    const t = +b.dataset.time;
    if (t) return setTimer(t);
    const v = prompt('New preset (MM:SS or minutes):');
    if (!v) return;
    const secs = v.includes(':') ? parseMMSS(v) : Math.round(parseFloat(v) * 60);
    if (secs > 0) { addPreset(secs); setTimer(secs * 1000); }
  };
  
  // Laps
  $('clearLapsBtn').onclick = () => { if (confirm('Clear?')) { laps = []; lastLapTime = 0; renderLaps(); } };
  $('exportLapsBtn').onclick = () => {
    navigator.clipboard.writeText('Lap,Total,Split\n' + laps.map((l, i) => (i + 1) + ',' + fmt(l.total) + ',' + fmt(l.split)).join('\n'))
      .then(() => alert('Copied!'));
  };
  
  // Panels
  $('settingsBtn').onclick = () => {
    $('settingsPanel').classList.add('active');
    $('settingsOverlay').classList.add('active');
    openModal($('settingsPanel'), $('closeSettings'));
    a11ySync();
  };
  $('closeSettings').onclick = $('settingsOverlay').onclick = () => {
    $('settingsPanel').classList.remove('active');
    $('settingsOverlay').classList.remove('active');
    recordingShortcut = null;
    document.querySelectorAll('.shortcut-input').forEach(i => i.classList.remove('recording'));
    closeModal();
    a11ySync();
  };
  $('historyBtn').onclick = openDash;
  $('closeHistory').onclick = $('dashScrim').onclick = closeDash;
  $('historyList').onclick = e => {
    const b = e.target.closest('.hist-del');
    if (b) deleteSession(b.dataset.iso);
  };
  $('dashFilters').onclick = e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    dashFilter = c.dataset.filter;
    document.querySelectorAll('#dashFilters .chip').forEach(x => x.classList.toggle('active', x === c));
    renderHistory();
  };
  $('clearHistoryBtn').onclick = () => {
    if (!history.length) return;
    if (confirm("Clear all session history? Today's stats are kept.")) { history = []; save(); renderDash(); renderMiniWeek(); }
  };
  
  // Top bar buttons
  $('fullscreenBtn').onclick = toggleFS;
  $('fsExit').onclick = () => setFS(false);
  $('pipBtn').onclick = openPiP;
  $('voiceBtn').onclick = toggleVoice;
  $('titleEdit').ondblclick = editTitle;
  
  // Toggles
  const tog = (id, key) => { $(id).onclick = () => { settings[key] = !settings[key]; save(); apply(); }; };
  // Colour transitions in the sheet run from .18s to .7s, so a raw flip retints
  // in waves. themeSwap() forces one duration across everything for the flip,
  // then hands the elements back to their own timings.
  $('darkToggle').onclick = $('themeToggleBtn').onclick = () => {
    settings.dark = !settings.dark;
    themeSwap();
    save();
    apply();
  };
  tog('ringToggle', 'showRing');
  tog('ticksToggle', 'showTicks');
  tog('numeralsToggle', 'showNumerals');
  tog('tipsToggle', 'tips');
  tog('soundToggle', 'sound');
  tog('tickToggle', 'tick');
  tog('confettiToggle', 'confetti');
  tog('voiceToggle', 'voice');
  tog('wakeToggle', 'wake');
  tog('confirmToggle', 'confirm');
  tog('worldToggle', 'worldClocks');
  tog('autoBreakToggle', 'autoBreak');
  tog('analyticsToggle', 'showAnalytics');
  tog('ambientBarToggle', 'showAmbientBar');
  tog('quotesToggle', 'showQuotes');
  tog('compactToggle', 'compact');
  // Format is one preference, read by both the world-clock strip and the dial,
  // so both have to be repainted from it.
  const clockFmt = key => {
    $(key === 'hour12' ? 'hour12Toggle' : 'clockSecondsToggle').onclick = () => {
      settings[key] = !settings[key];
      save();
      updateUI();
      updateWorldClocks();
      if (mode === 'clock') { updateDisplay(); updateRing(); }
    };
  };
  clockFmt('hour12');
  clockFmt('clockSeconds');
  MODES.forEach(m => {
    $('mode' + m[0].toUpperCase() + m.slice(1) + 'Toggle').onclick = () => {
      // Refuse rather than silently re-enable something else: the click that
      // empties the last mode has no sensible outcome, and bouncing back to a
      // mode the user just turned off is worse than doing nothing.
      if (settings.modes[m] && enabledModes().length === 1) return;
      settings.modes[m] = !settings.modes[m];
      save();
      apply();
    };
  });
  $('bgRunToggle').onclick = () => {
    settings.bgRun = !settings.bgRun;
    // Turning it off has to reach the runs already counting in the background,
    // or the setting only governs the next switch and the current ones keep
    // going in defiance of it.
    if (!settings.bgRun) Object.keys(runState).forEach(k => freezeRun(runState[k]));
    save();
    apply();
  };
  $('tzGrid').onclick = e => {
    const o = e.target.closest('.clock-opt');
    if (o) setClockTz(o.dataset.tz);
  };
  $('clockDateToggle').onclick = () => {
    settings.clockDate = !settings.clockDate;
    save();
    updateUI();
    lastClockLabel = '';
    if (mode === 'clock') paintClockLabel();
  };
  $('notifToggle').onclick = async () => {
    if (!settings.notifications) {
      if (!('Notification' in window)) { alert('Notifications are not supported in this browser'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Notification permission denied'); return; }
    }
    settings.notifications = !settings.notifications;
    save();
    updateUI();
  };
  $('fsToggle').onclick = toggleFS;
  $('longBreakToggle').onclick = () => {
    settings.longBreaks = !settings.longBreaks;
    if (!settings.longBreaks && pomoPhase === 'long') pomoPhase = 'short';
    save();
    apply();
    syncPomoTime();
  };
  
  // Pomo time inputs — any edit re-syncs the dial for the current phase
  const pomoInput = (id, key) => {
    $(id).onchange = e => {
      settings.pomo[key] = Math.max(1, parseMMSS(e.target.value));
      e.target.value = formatMMSS(settings.pomo[key]);
      save();
      syncPomoTime();
    };
    $(id).onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  };
  pomoInput('workInput', 'work');
  pomoInput('breakInput', 'short');
  pomoInput('longBreakInput', 'long');
  
  $('roundsInput').onchange = e => {
    // `+value || 4` looked like a NaN guard but also catches literal 0 (falsy
    // in JS), silently turning "0 rounds" into 4 instead of flooring it to 1.
    const n = +e.target.value;
    settings.pomo.rounds = Math.max(1, Math.min(MAX_ROUNDS, isNaN(n) ? 4 : n));
    e.target.value = settings.pomo.rounds;
    if (pomoRound > settings.pomo.rounds) pomoRound = settings.pomo.rounds;
    save();
    syncPomoTime();
  };
  
  $('volSlider').oninput = e => {
    settings.volume = e.target.value / 100;
    $('volVal').textContent = Math.round(settings.volume * 100) + '%';
    if (ambientGain) ambientGain.gain.value = ambientLevel();
    save();
  };
  
  // Theme/color/clock grids
  $('themeGrid').onclick = e => {
    const t = e.target.closest('.theme-opt');
    if (t) {
      settings.visualTheme = t.dataset.theme;
      // A direction can declare which reading it was designed in. Only applied
      // on an explicit pick — never on load, which would fight the dark toggle.
      save(); apply();
    }
  };
  $('colorGrid').onclick = e => {
    if (e.target.classList.contains('color-opt')) {
      settings.colorTheme = e.target.dataset.color;
      save(); apply(); renderColors();
    }
  };
  $('clockGrid').onclick = e => {
    const c = e.target.closest('.clock-opt');
    if (!c) return;
    const i = settings.clocks.indexOf(c.dataset.city);
    if (i > -1) settings.clocks.splice(i, 1);
    else if (settings.clocks.length < MAX_CLOCKS) settings.clocks.push(c.dataset.city);
    else return;
    save(); apply(); updateWorldClocks();
  };
  $('soundGrid').onclick = e => {
    const o = e.target.closest('.sound-opt');
    if (o) { settings.alertSound = o.dataset.sound; save(); updateUI(); if (o.dataset.sound !== 'none') playAlert(); }
  };
  $('fontGrid').onclick = e => {
    const o = e.target.closest('.font-opt');
    if (o) { settings.timeFont = o.dataset.font; save(); apply(); }
  };
  $('customFontInput').onchange = e => {
    settings.customFontName = e.target.value;
    save();
    if (settings.timeFont === 'custom') apply();
  };
  $('customFontInput').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('customColorPicker').oninput = e => {
    settings.customColor = e.target.value;
    settings.colorTheme = 'custom';
    save(); apply(); renderColors();
  };
  $('customPaletteToggle').onclick = () => {
    settings.useCustomPalette = !settings.useCustomPalette;
    if (settings.useCustomPalette) seedCustomPaletteIfEmpty();
    save(); apply();
  };
  const paletteInput = (id, key) => {
    $(id).oninput = e => { settings.customPalette[key] = e.target.value; save(); apply(); };
  };
  paletteInput('paletteBgPicker', 'bg');
  paletteInput('paletteCardPicker', 'card');
  paletteInput('paletteBorderPicker', 'border');
  paletteInput('paletteTextPicker', 'text');
  paletteInput('paletteText2Picker', 'text2');
  $('paletteResetBtn').onclick = () => {
    settings.customPalette = { bg: null, card: null, border: null, text: null, text2: null };
    settings.useCustomPalette = false;
    save(); apply();
  };
  $('topBarOrderList').onclick = e => {
    const b = e.target.closest('.order-btn');
    if (!b || b.disabled) return;
    const i = +b.dataset.i, j = b.dataset.dir === 'up' ? i - 1 : i + 1;
    const order = settings.topBarOrder;
    [order[i], order[j]] = [order[j], order[i]];
    save(); apply();
  };
  // While the thumb is moving, every oninput restarts the dial's .6s size
  // transition, so it trails the slider and the time text (on a faster curve)
  // visibly leads it. `sizing` drops both to instant for the duration.
  let sizingTO = null;
  const sizing = () => {
    document.body.classList.add('dial-sizing');
    clearTimeout(sizingTO);
    sizingTO = setTimeout(() => document.body.classList.remove('dial-sizing'), 200);
  };
  $('dialSizeSlider').oninput = e => {
    settings.dialSize = +e.target.value;
    $('dialSizeVal').textContent = settings.dialSize + 'px';
    sizing();
    document.body.style.setProperty('--dial-d', settings.dialSize + 'px');
    if (mode === 'pomodoro') renderPips();   // pip capacity is dial-width derived
    save();
  };
  $('clockScaleSlider').oninput = e => {
    settings.clockScale = +e.target.value;
    $('clockScaleVal').textContent = settings.clockScale + '%';
    sizing();
    document.body.style.setProperty('--clock-scale', settings.clockScale / 100);
    save();
  };
  $('uiScaleSlider').oninput = e => {
    settings.uiScale = +e.target.value;
    $('uiScaleVal').textContent = settings.uiScale + '%';
    document.body.style.setProperty('--ui-scale', settings.uiScale / 100);
    save();
    moveTab();   // tab widths are text-driven; the pill has to re-measure
  };
  $('ringThicknessSlider').oninput = e => {
    settings.ringThickness = +e.target.value;
    $('ringThicknessVal').textContent = settings.ringThickness + 'px';
    document.body.style.setProperty('--ring-w', settings.ringThickness);
    save();
  };
  $('customCssInput').oninput = e => {
    settings.customCSS = e.target.value;
    applyCustomCSS();
    save();
  };

  // Quotes editor
  $('quotesList').onclick = e => {
    const btn = e.target.closest('.quote-del-btn');
    if (!btn) return;
    settings.customQuotes.splice(+btn.dataset.i, 1);
    save();
    renderQuotes();
  };
  $('addQuoteBtn').onclick = () => {
    const text = $('newQuoteText').value.trim();
    if (!text) return;
    const author = $('newQuoteAuthor').value.trim() || 'Unknown';
    settings.customQuotes.push({ text, author });
    save();
    renderQuotes();
    $('newQuoteText').value = '';
    $('newQuoteAuthor').value = '';
  };

  // Data management
  $('exportSettingsBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({
      v: 1,
      exported: new Date().toISOString(),
      settings, analytics, history,
      title: localStorage.getItem('chronos_title') || ''
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chronos-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  $('importSettingsBtn').onclick = () => $('importFileInput').click();
  $('importFileInput').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.settings) Object.assign(settings, data.settings);
        if (data.analytics) Object.assign(analytics, data.analytics);
        if (Array.isArray(data.history)) history = data.history;
        if (data.title) localStorage.setItem('chronos_title', data.title);
        save();
        apply();
        renderColors();
        renderClocks();
        renderQuotes();
        applyCustomCSS();
        updateStats();
        updateGoal();
        renderMiniWeek();
        renderTagChips();
        alert('Restored ' + (Array.isArray(data.history) ? data.history.length : 0) + ' sessions and your settings.');
      } catch (err) {
        alert('That file could not be read as valid Chronos settings.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  $('exportHistoryBtn').onclick = () => {
    if (!history.length) { alert('No history to export yet'); return; }
    const rows = ['Type,Duration(ms),Laps,Date'];
    history.forEach(h => rows.push([h.type, h.duration, h.laps || 0, h.date].join(',')));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chronos-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  $('viewDataBtn').onclick = () => {
    const view = $('rawDataView');
    view.classList.toggle('hidden');
    if (!view.classList.contains('hidden')) {
      view.value = JSON.stringify({ settings, analytics, historyCount: history.length }, null, 2);
    }
  };

  // Reset all
  $('resetAllBtn').onclick = () => {
    if (!confirm('Reset all?')) return;
    try { localStorage.clear(); } catch (e) {}
    clearBg();
    location.reload();
  };
  
  // Ambient sounds
  document.querySelectorAll('.ambient-btn').forEach(b => b.onclick = () => toggleAmbient(b.dataset.sound));
  
  // Shortcut recording
  document.querySelectorAll('.shortcut-input').forEach(inp => {
    inp.onclick = () => {
      document.querySelectorAll('.shortcut-input').forEach(i => i.classList.remove('recording'));
      inp.classList.add('recording');
      recordingShortcut = inp.dataset.action;
    };
  });
  
  // Keyboard
  document.onkeydown = e => {
    trapFocus(e);
    if (recordingShortcut) {
      e.preventDefault();
      settings.keys[recordingShortcut] = e.code;
      save();
      updateShortcutDisplay();
      document.querySelectorAll('.shortcut-input').forEach(i => i.classList.remove('recording'));
      recordingShortcut = null;
      return;
    }
    
    // Palette opens from anywhere, including a focused field
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') { e.preventDefault(); togglePalette(); return; }
    
    if ($('palette').classList.contains('active')) { paletteKey(e); return; }
    
    if (e.key === 'Escape') {
      const wasOpen = document.querySelector('.panel.active, .keys-overlay.active');
      $('settingsOverlay').classList.remove('active');
      $('settingsPanel').classList.remove('active');
      $('keysOverlay').classList.remove('active');
      // Closing a dialog has to hand focus back, or the user is dropped at the
      // top of the document with no idea where they were.
      if (wasOpen) { closeModal(); a11ySync(); return; }
      if ($('dashboard').classList.contains('active')) return closeDash();
      if (settings.fullscreen) setFS(false);
      return;
    }
    
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key === '?') { e.preventDefault(); toggleKeys(); }
    else if (MODE_KEYS[e.code]) { if (settings.modes[MODE_KEYS[e.code]]) switchMode(MODE_KEYS[e.code]); }
    else if (e.code === settings.keys.toggle) { e.preventDefault(); togglePlay(); }
    else if (e.code === settings.keys.lap) recordLap();
    else if (e.code === settings.keys.reset) reset();
    else if (e.code === settings.keys.fullscreen) toggleFS();
    else if (e.code === settings.keys.settings) $('settingsBtn').click();
  };
  
  tog('wideToggle', 'wide');
  tog('tagCardToggle', 'showTagCard');
  tog('splitToggle', 'showSplit');
  tog('signatureToggle', 'signature');
  tog('railsSwapToggle', 'swapRails');
  
  $('goalSlider').oninput = e => {
    settings.dailyGoal = +e.target.value;
    $('goalVal').textContent = formatGoal(settings.dailyGoal);
    $('goalCap').textContent = 'of ' + formatGoal(settings.dailyGoal) + ' goal';
    updateGoal();
    save();
  };
  
  // Session tag — held in memory, attached to the session when it's logged
  $('tagInput').oninput = e => { sessionTag = e.target.value.trim(); renderTagChips(); };
  $('tagInput').onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTag(); e.target.blur(); }
    if (e.key === 'Escape') { e.target.value = ''; sessionTag = ''; renderTagChips(); e.target.blur(); }
  };
  $('tagInput').onblur = commitTag;
  $('tagRecent').onclick = e => {
    if (e.target.dataset.del !== undefined) { e.stopPropagation(); return forgetTag(e.target.dataset.del); }
    const c = e.target.closest('.tag-chip');
    if (!c) return;
    sessionTag = c.dataset.tag;
    $('tagInput').value = sessionTag;
    renderTagChips();
  };
  
  $('bgPickBtn').onclick = () => $('bgFile').click();
  $('bgFile').onchange = e => { pickBg(e.target.files[0]); e.target.value = ''; };
  $('bgClearBtn').onclick = clearBg;
  $('bgDimSlider').oninput = e => {
    settings.bgDim = +e.target.value;
    $('bgDimVal').textContent = settings.bgDim + '%';
    applyBgFilters(); save();
  };
  $('pomoExtend').onclick = () => extendPhase(300);
  $('pomoSkip').onclick = skipPhase;
  
  $('dashRange').onclick = e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    dashRange = +c.dataset.range;
    document.querySelectorAll('#dashRange .chip').forEach(x => x.classList.toggle('active', x === c));
    renderDash();
  };
  
  $('bgSoundToggle').onclick = () => {
    settings.bgSound = !settings.bgSound;
    save();
    updateUI();
    applyBgAudio();
  };
  
  $('bgVolSlider').oninput = e => {
    settings.bgVolume = e.target.value / 100;
    $('bgVolVal').textContent = Math.round(settings.bgVolume * 100) + '%';
    if (bgVideo) bgVideo.volume = settings.bgVolume;
    save();
  };
  
  const seek = $('bgSeek');
  seek.oninput = e => {
    if (!bgVideo || !bgVideo.duration) return;
    bgSeeking = true;
    const t = e.target.value / 1000 * bgVideo.duration;
    $('bgTimeCur').textContent = vidTime(t);
  };
  seek.onchange = e => {
    if (bgVideo && bgVideo.duration) bgVideo.currentTime = e.target.value / 1000 * bgVideo.duration;
    bgSeeking = false;
  };
  
  $('bgBlurSlider').oninput = e => {
    settings.bgBlur = +e.target.value;
    $('bgBlurVal').textContent = settings.bgBlur + 'px';
    applyBgFilters(); save();
    const m = $('bgMedia').firstElementChild;
    if (m && m.tagName === 'VIDEO') $('bgBlurNote').style.display = settings.bgBlur > 14 ? '' : 'none';
  };
  
  initSections();
  buildKeysList();
  buildPalette();
  
  window.addEventListener('resize', () => { moveTab(); sizeMatrix(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (running) tick();
    // Background throttling stretches the clock loop out to seconds at a time,
    // so the face can come back visibly stale.
    if (mode === 'clock') tickClock();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveTab);
  
  setupDial();
}

// ========== TIMER CORE ==========
function toggleFS() {
  setFS(!settings.fullscreen);
}

// Immersive mode is purely ours — it strips the app's own chrome and does NOT
// ask the browser for fullscreen. Exit is the single button in the corner.
function setFS(on) {
  if (on === settings.fullscreen) return;
  if (!on && !RM) return exitFS();
  settings.fullscreen = on;
  save();
  apply();
}

// Entering reads well: the chrome display:none's instantly while the eye follows
// the dial growing. The reverse did not, because .main drops out of
// position:fixed back into normal flow — an un-animatable jump — in the same
// frame the chrome pops back and the dial starts shrinking.
//
// So exit is a FLIP. .fs-out kills the dial's own size transition, which both
// puts it at its settled geometry for measuring and hands the size change over
// to a transform; the wrap is then pushed back to where the dial was on screen
// and released to identity. Chrome fades in behind it.
let fsOutTO = null;
function exitFS() {
  const dial = $('dial'), wrap = document.querySelector('.dial-wrap');
  const before = dial.getBoundingClientRect();
  
  settings.fullscreen = false;
  save();
  apply();
  document.body.classList.add('fs-out');   // after apply(), which rebuilds className
  
  const after = dial.getBoundingClientRect();
  const dx = (before.left + before.width / 2) - (after.left + after.width / 2);
  const dy = (before.top + before.height / 2) - (after.top + after.height / 2);
  const sc = after.width ? before.width / after.width : 1;
  
  wrap.style.transition = 'none';
  wrap.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';
  void wrap.offsetWidth;
  wrap.style.transition = '';
  wrap.style.transform = '';
  
  clearTimeout(fsOutTO);
  fsOutTO = setTimeout(() => {
    wrap.style.transition = '';
    wrap.style.transform = '';
    document.body.classList.remove('fs-out');
  }, 800);
}

function switchMode(m) {
  // Re-entering the mode you're already in has to be a no-op. The tab is
  // clickable while active, and with Keep Modes Running off the leaving branch
  // below would pause a run the user only meant to click on.
  if (m === mode) return;
  
  if (mode !== 'clock') {
    if (running && !settings.bgRun) pause();
    stashRun(mode);
  }
  // The on-screen loop always stops. A backgrounded run keeps its startTime and
  // is recomputed from the wall clock when it comes back.
  clearInterval(interval);
  
  mode = m;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  
  const s = loadRun(m);
  renderLaps();
  $('splitDisplay').classList.remove('show');
  
  $('lapsContainer').classList.toggle('hidden', m !== 'stopwatch');
  $('presets').classList.toggle('hidden', m !== 'timer');
  $('pomoInfo').classList.toggle('show', m === 'pomodoro');
  $('pomoActions').classList.toggle('show', m === 'pomodoro');
  lastClockLabel = '';   // force the label back to a mode name / a fresh date
  
  const r = $('ringProgress');
  r.classList.remove('countdown', 'pomo-work', 'pomo-break');
  $('dial').classList.remove('countdown-mode', 'pomo-work', 'pomo-break');
  
  if (m === 'timer') {
    r.classList.add('countdown');
    $('dial').classList.add('countdown-mode');
  }
  if (m === 'pomodoro') {
    const brk = pomoPhase !== 'work';
    r.classList.add(brk ? 'pomo-break' : 'pomo-work');
    $('dial').classList.add(brk ? 'pomo-break' : 'pomo-work');
    updatePomo();
  }
  
  $('timeLabel').textContent = m === 'pomodoro'
    ? (pomoPhase === 'work' ? 'Focus Time' : 'Break')
    : { stopwatch: 'Stopwatch', timer: 'Timer', clock: 'Clock' }[m];
  syncPlayBtn();
  say($('timeLabel').textContent + ' mode');
  moveTab();
  syncBodyState();
  syncClockLoop();
  a11ySync();
  updateDisplay();
  updateRing();
  
  // Anything the mode owed from its time in the background is settled here, on
  // its own screen, rather than firing over whatever the user was looking at.
  if (running) {
    interval = setInterval(tick, 16);
    tick();            // fires complete() if the countdown ran out while away
  } else if (s && s.due) {
    s.due = false;
    complete();
  }
}

// ========== PER-MODE RUN STATE ==========
// One set of globals used to be shared by every mode, so leaving a mode didn't
// stop it — it wiped it. Each mode now keeps its own snapshot and the globals
// are simply whichever snapshot is currently on screen.
//
// A mode left running in the background does NOT get a live interval. Every
// value is derived from startTime against the wall clock, so there is nothing
// to keep ticking: the arithmetic on return is the same either way, and one
// loop can't drift from another if there's only ever one.
const runState = {};

function stashRun(m) {
  if (!m || m === 'clock') return;
  // Same reasoning as pause(): recompute instead of copying tick()'s last
  // write, so the snapshot is right even if the loop was running behind.
  const el = running ? Date.now() - startTime : elapsed;
  runState[m] = {
    running, startTime, elapsed: el, timerDuration,
    timerRemaining: timerDuration > 0 ? Math.max(0, timerDuration - el) : timerRemaining,
    laps: laps.slice(), lastLapTime,
    pomoPhase, pomoRound, pomoTotalFocus,
    due: false
  };
}

// Stop a snapshot where it stands. Used when Keep Modes Running is switched off
// underneath something already counting in the background.
function freezeRun(s) {
  if (!s.running) return;
  s.running = false;
  s.elapsed = Date.now() - s.startTime;
  if (s.timerDuration > 0) {
    s.timerRemaining = Math.max(0, s.timerDuration - s.elapsed);
    // It ran out while nobody was watching. Alerting now would fire from a mode
    // that isn't on screen, so the completion is held and spent on return.
    if (s.timerRemaining <= 0) s.due = true;
  }
}

function loadRun(m) {
  const s = runState[m];
  if (!s) {
    running = false; startTime = 0; elapsed = 0;
    laps = []; lastLapTime = 0;
    if (m === 'pomodoro') {
      pomoPhase = 'work'; pomoRound = 1; pomoTotalFocus = 0;
      timerDuration = settings.pomo.work * 1000;
      timerRemaining = timerDuration;
    } else {
      timerDuration = 0; timerRemaining = 0;
    }
    return null;
  }
  running = s.running; startTime = s.startTime; elapsed = s.elapsed;
  timerDuration = s.timerDuration; timerRemaining = s.timerRemaining;
  laps = s.laps; lastLapTime = s.lastLapTime;
  pomoPhase = s.pomoPhase; pomoRound = s.pomoRound; pomoTotalFocus = s.pomoTotalFocus;
  return s;
}

function syncPlayBtn() {
  $('playBtn').innerHTML = icon(running ? 'pause' : 'play', 26);
  $('playBtn').title = running ? 'Pause' : 'Start';
  // The icon is drawn from a path with no text; title alone is a tooltip, not
  // an accessible name on every platform.
  $('playBtn').setAttribute('aria-label', running ? 'Pause' : 'Start');
}

// ========== CLOCK MODE ==========
// The core tick() only runs while the user has started something. A wall clock
// is never "started", so it gets its own loop, alive only while its tab is the
// one on screen.
function syncClockLoop() {
  clearInterval(clockTimer);
  clockTimer = null;
  if (mode !== 'clock') return;
  tickClock();
  // Faster than 1 Hz because the ring head sweeps continuously between seconds.
  // With motion off nothing sweeps, so the digits are the only thing left to
  // repaint and once a second is exactly enough.
  clockTimer = setInterval(tickClock, RM ? 500 : 33);
}

// Shared by the chip grid and the palette. From the palette it also has to make
// the face visible — "Clock: Tokyo" typed into a search box is a request to see
// Tokyo, not to quietly change a setting for later.
function setClockTz(tz, show) {
  settings.clockTz = tzMap[tz] ? tz : '';
  if (show && !settings.modes.clock) settings.modes.clock = true;
  save();
  if (show) apply();
  else updateUI();
  lastClockLabel = '';
  if (show) switchMode('clock');
  else if (mode === 'clock') { updateDisplay(); updateRing(); paintClockLabel(); }
}

function tickClock() {
  updateDisplay();
  updateRing();
  // toLocaleDateString is far too heavy for 30fps and the answer changes once a
  // day, so the label is only reconsidered when the second turns over.
  const s = tzTime(new Date()).s;
  if (s === lastClockSec) return;
  lastClockSec = s;
  paintClockLabel();
}

// With a zone picked, the city has to be on screen — otherwise a face reading
// 03:18 is indistinguishable from a device whose clock is simply wrong, and
// turning the date off would hide the only other cue.
function paintClockLabel() {
  const bits = [];
  if (settings.clockTz) bits.push(settings.clockTz);
  if (settings.clockDate) bits.push(clockDate());
  const label = bits.length ? bits.join(' · ') : 'Clock';
  if (label === lastClockLabel) return;
  lastClockLabel = label;
  $('timeLabel').textContent = label;
}

function togglePlay() {
  if (mode === 'clock') return;   // Space is still bound; there is nothing to start
  $('playBtn').classList.add('pulse');
  setTimeout(() => $('playBtn').classList.remove('pulse'), 300);
  running ? pause() : start();
}

function start() {
  if (mode === 'clock') return;
  if (mode === 'timer' && timerRemaining <= 0) return;
  if (mode === 'pomodoro' && timerRemaining <= 0) {
    timerDuration = settings.pomo.work * 1000;
    timerRemaining = timerDuration;
  }
  running = true;
  startTime = Date.now() - elapsed;
  syncPlayBtn();
  say(mode === 'stopwatch' ? 'Started' : 'Started, ' + spokenTime(timerRemaining) + ' remaining');
  interval = setInterval(tick, 16);
  if (mode === 'pomodoro') showQuote();
  syncBodyState();
  requestWake();
}

function pause() {
  // Derive from the wall clock rather than trusting whatever tick() last wrote.
  // A throttled background tab can leave elapsed hundreds of ms behind, and
  // pausing on the stale value silently loses that time.
  const wasRunning = running;
  if (running) elapsed = Date.now() - startTime;
  running = false;
  clearInterval(interval);
  syncPlayBtn();
  if (wasRunning) say('Paused at ' + spokenTime(mode === 'stopwatch' ? elapsed : timerRemaining));
  syncBodyState();
  releaseWake();
}

function reset() {
  if (mode === 'clock') return;
  if (settings.confirm && (running || elapsed > 0) && !confirm('Reset?')) return;
  pause();
  if (mode === 'stopwatch' && elapsed >= 1000) logSession();
  elapsed = 0;
  timerRemaining = timerDuration;
  laps = [];
  lastLapTime = 0;
  renderLaps();
  $('splitDisplay').classList.remove('show');
  
  if (mode === 'pomodoro') {
    pomoPhase = 'work';
    pomoRound = 1;
    const r = $('ringProgress'), d = $('dial');
    r.classList.remove('pomo-break'); r.classList.add('pomo-work');
    d.classList.remove('pomo-break'); d.classList.add('pomo-work');
    $('timeLabel').textContent = 'Focus Time';
    syncPomoTime();
  }
  
  startTime = Date.now();
  lastSec = -1;
  syncBodyState();
  say('Reset');
  updateDisplay();
  updateRing();
  a11yDial();
  $('dial').classList.remove('timer-complete');
  
  // Visible acknowledgement — the button spins even when the clock was already zero
  const rb = $('resetBtn');
  rb.classList.remove('spun');
  void rb.offsetWidth;
  rb.classList.add('spun');
}

function tick() {
  const now = Date.now();
  elapsed = now - startTime;
  
  if (mode === 'timer' || mode === 'pomodoro') {
    timerRemaining = Math.max(0, timerDuration - elapsed);
    if (timerRemaining <= 0) complete();
  }
  
  // Tick sound
  if (settings.tick && running) {
    const sec = Math.floor((mode === 'stopwatch' ? elapsed : timerRemaining) / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      playTick();
    }
  }
  
  updateDisplay();
  updateRing();
}

function complete() {
  pause();
  logSession();
  if (settings.sound) playAlert();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (settings.confetti) launchConfetti();
  if (settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
    const body = mode === 'pomodoro' ? (pomoPhase === 'work' ? 'Focus session complete — take a break!' : 'Break complete — back to work!') : mode === 'timer' ? 'Timer complete!' : 'Session complete!';
    new Notification('Chronos', { body });
  }
  $('dial').classList.add('timer-complete');
  setTimeout(() => $('dial').classList.remove('timer-complete'), 2000);
  say(mode === 'pomodoro'
    ? (pomoPhase === 'work' ? 'Focus session complete. Time for a break.' : 'Break over. Back to work.')
    : 'Time is up.', true);
  
  if (mode === 'pomodoro') {
    const r = $('ringProgress'), d = $('dial');
    if (pomoPhase === 'work') {
      pomoTotalFocus += settings.pomo.work;
      analytics.focus += settings.pomo.work;
      save();
      updateStats();
      updateGoal();
      pomoPhase = (settings.longBreaks && pomoRound >= settings.pomo.rounds) ? 'long' : 'short';
      $('timeLabel').textContent = pomoPhase === 'long' ? 'Long Break' : 'Short Break';
      r.classList.remove('pomo-work'); r.classList.add('pomo-break');
      d.classList.remove('pomo-work'); d.classList.add('pomo-break');
    } else {
      pomoPhase = 'work';
      pomoRound = pomoRound >= settings.pomo.rounds ? 1 : pomoRound + 1;
      $('timeLabel').textContent = 'Focus Time';
      r.classList.remove('pomo-break'); r.classList.add('pomo-work');
      d.classList.remove('pomo-break'); d.classList.add('pomo-work');
    }
    elapsed = 0;
    syncPomoTime();
    syncBodyState();
    if (settings.autoBreak) start();
  }
}

// ========== DISPLAY ==========
function fmt(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

function fmtH(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

// Characters fall into three buckets: separators, digits, and the 12-hour
// meridiem. Only digits roll.
function charClass(ch) {
  if (ch === ':' || ch === '.') return 'sep';
  return ch >= '0' && ch <= '9' ? 'dg' : 'mer';
}

function updateDisplay() {
  const td = $('timeDisplay');
  let str, dot, rollTo;
  
  if (mode === 'clock') {
    str = clockString();
    dot = str.length;   // no centiseconds, so nothing gets the dimmed treatment
    // Seconds change once a second and the roll runs .52s, so rolling them
    // leaves the fastest field animating more than half the time — busy on
    // something you only glance at. Same reasoning that already keeps the
    // stopwatch's centiseconds still.
    rollTo = settings.clockSeconds ? str.lastIndexOf(':') + 1 : str.length;
  } else {
    const ms = mode === 'stopwatch' ? elapsed : timerRemaining;
    str = ms >= 3600000 ? fmtH(ms) : fmt(ms);
    // lastIndexOf returns -1 when there's no fractional part, and `i >= -1` is
    // true for every index — which would tag the whole string .ms (small and
    // faded) and suppress every roll. Every fmt/fmtH string has a dot today, so
    // this only ever bit the clock, but the fallback belongs here either way.
    dot = str.lastIndexOf('.');
    if (dot < 0) dot = str.length;
    rollTo = dot;
  }
  
  // Rebuild when the SHAPE changes, not just the length. "00:00.00" and
  // "14:32:05" are both eight characters but want different classes on
  // positions 5–7 — diffing text alone would leave a clock rendered with the
  // stopwatch's faded centisecond styling. The count check stays for the
  // separate case of the inline editor having replaced the spans with an input.
  let shape = '';
  for (let i = 0; i < str.length; i++) shape += charClass(str[i]) + (i >= dot ? 'm' : '') + '|';
  
  if (td.childElementCount !== str.length || td.dataset.shape !== shape) {
    td.dataset.shape = shape;
    // .long steps the face down a size so it stays inside the dial. Keyed to
    // rendered width rather than character count, because .ms and .mer set
    // ~0.4em: "00:00.00" is five full-width characters and fits, while the
    // clock's "14:32:05" is eight and does not — both are eight long.
    let w = 0;
    for (let i = 0; i < str.length; i++) w += (i >= dot || charClass(str[i]) === 'mer') ? 0.44 : 1;
    td.classList.toggle('long', w > 7.5);
    let h = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      h += '<span class="' + charClass(ch) + (i >= dot ? ' ms' : '') + '">' +
        (ch === ' ' ? '&nbsp;' : ch) + '</span>';
    }
    td.innerHTML = h;
    return;
  }
  
  // Per-digit diff. Only the slow digits roll.
  const kids = td.children;
  for (let i = 0; i < str.length; i++) {
    const el = kids[i], ch = str[i] === ' ' ? '\u00a0' : str[i];
    if (el.textContent === ch) continue;
    el.textContent = ch;
    if (!RM && !dialDragging && i < rollTo && el.classList.contains('dg')) {
      el.classList.remove('roll');
      void el.offsetWidth;
      el.classList.add('roll');
    }
  }
}

// Pace Clock's signature. Progress is quantised to sixty discrete lamps rather
// than a smooth arc, so the minute advances by one lamp switching on. Only the
// lamps that actually changed are touched — reassigning 60 classes at 60fps is
// how you turn a decoration into a frame-rate problem.
let litCount = -1;
function paintLamps(p) {
  const want = Math.round(Math.max(0, Math.min(1, p)) * 60);
  if (want === litCount) return;
  const ticks = $('ticks').children;
  if (!ticks.length) return;
  // No index rotation here: .ring-svg carries transform: rotate(-90deg), so the
  // ticks and the arc already share one rotated frame and tick 0 is visually at
  // twelve o'clock. Offsetting by a quarter turn double-corrects it.
  for (let i = 0; i < 60; i++) ticks[i].classList.toggle('lit', i < want);
  litCount = want;
}

function updateRing() {
  const p = mode === 'clock' ? clockProgress()
    : mode === 'stopwatch' ? Math.min(elapsed / 3600000, 1)
    : timerDuration > 0 ? (timerDuration - timerRemaining) / timerDuration : 0;
  $('ringProgress').style.strokeDashoffset = CIRC * (1 - p);
  
  const a = p * Math.PI * 2, h = $('ringHead');
  h.setAttribute('cx', (140 + 126 * Math.cos(a)).toFixed(2));
  h.setAttribute('cy', (140 + 126 * Math.sin(a)).toFixed(2));
  // The clock head crosses zero on every wrap; the 0.0015 cutoff exists to stop
  // a parked head sitting at 12 o'clock, which isn't a state a clock has.
  h.style.opacity = settings.showRing && (mode === 'clock' || p > 0.0015) ? '1' : '0';

  // Cheap enough to call unconditionally — paintLamps returns immediately
  // unless the lamp count actually moved, and the CSS only reveals them under
  // .visual-paceclock.signature.
  if (settings.showTicks) paintLamps(p);
}

// The dial has exactly 60 tick marks, so both readings land one tick per step:
// with seconds shown the ring is the current minute, without them it's the
// current hour. Either way a full lap is 60 of something.
function clockProgress() {
  const d = new Date();
  if (settings.clockSeconds) return (d.getSeconds() * 1000 + d.getMilliseconds()) / 60000;
  // Minutes, not seconds, because half- and quarter-hour offsets (Kolkata,
  // Kathmandu, Chatham) put the zone's minute hand somewhere the device's isn't.
  const t = tzTime(d);
  return (t.m * 60 + t.s) / 3600;
}

function updatePomo() {
  renderPips();
  $('pomoRound').textContent = pomoRound + '/' + settings.pomo.rounds;
  $('pomoTotal').textContent = formatFocus(pomoTotalFocus);
  const isLong = settings.longBreaks && (pomoPhase === 'long' || (pomoPhase !== 'short' && pomoRound >= settings.pomo.rounds));
  $('pomoBreak').textContent = formatMMSS(isLong ? settings.pomo.long : settings.pomo.short);
  $('pomoBreakLabel').textContent = isLong ? 'Long Break' : 'Break';
}

function pomoPhaseSecs() {
  if (pomoPhase === 'long' && settings.longBreaks) return settings.pomo.long;
  if (pomoPhase === 'long' || pomoPhase === 'short') return settings.pomo.short;
  return settings.pomo.work;
}

function syncPomoTime() {
  updatePomo();
  if (mode !== 'pomodoro') return;
  timerDuration = pomoPhaseSecs() * 1000;
  if (running) {
    timerRemaining = Math.max(0, timerDuration - elapsed);
  } else {
    timerRemaining = timerDuration;
    elapsed = 0;
    startTime = Date.now();
  }
  updateDisplay();
  updateRing();
}

// ========== POMODORO EDITORS ==========
function editPomoRound() {
  const el = $('pomoRound');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = pomoRound + '/' + settings.pomo.rounds;
  inp.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;text-align:center;width:60px;outline:2px solid var(--accent);border-radius:4px;padding:2px;font-family:inherit;';
  el.textContent = '';
  el.appendChild(inp);
  inp.focus();
  inp.select();
  
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const [r, t] = inp.value.split('/').map(x => parseInt(x.trim()));
    // This editor used to write rounds unclamped while the Settings input caps
    // at MAX_ROUNDS — which is how "1/300" got in and blew out the pip row.
    if (!isNaN(t) && t >= 1) {
      settings.pomo.rounds = Math.min(MAX_ROUNDS, t);
      save();
    }
    if (!isNaN(r) && r >= 1) pomoRound = Math.min(settings.pomo.rounds, r);
    updateUI();
    updatePomo();
  };
  
  inp.onblur = finish;
  inp.onkeydown = e => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') { done = true; updatePomo(); }
  };
}

function editPomoFocus() {
  const el = $('pomoTotal');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = formatMMSS(pomoTotalFocus);
  inp.placeholder = 'MM:SS';
  inp.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;text-align:center;width:70px;outline:2px solid var(--accent);border-radius:4px;padding:2px;font-family:inherit;';
  el.textContent = '';
  el.appendChild(inp);
  inp.focus();
  inp.select();
  
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const val = parseMMSS(inp.value);
    if (val >= 0) pomoTotalFocus = val;
    updatePomo();
  };
  
  inp.onblur = finish;
  inp.onkeydown = e => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') { done = true; updatePomo(); }
  };
}

function editPomoBreak() {
  const el = $('pomoBreak');
  const key = $('pomoBreakLabel').textContent === 'Long Break' ? 'long' : 'short';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = formatMMSS(settings.pomo[key]);
  inp.placeholder = 'MM:SS';
  inp.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;text-align:center;width:70px;outline:2px solid var(--accent);border-radius:4px;padding:2px;font-family:inherit;';
  el.textContent = '';
  el.appendChild(inp);
  inp.focus();
  inp.select();
  
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    settings.pomo[key] = Math.max(1, parseMMSS(inp.value));
    save();
    updateUI();
    syncPomoTime();
  };
  
  inp.onblur = finish;
  inp.onkeydown = e => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') { done = true; updatePomo(); }
  };
}

// ========== LAPS ==========
function recordLap() {
  if (!running || mode !== 'stopwatch') return;
  const split = elapsed - lastLapTime;
  laps.push({ total: elapsed, split });
  lastLapTime = elapsed;
  
  // The split overlay sits on the dial face over the running digits, which is
  // the one place on screen already carrying a number. Off by default; the lap
  // is still recorded and still lands in the laps list either way.
  if (settings.showSplit) {
    $('splitDisplay').classList.add('show');
    $('splitTime').textContent = fmt(split);
    setTimeout(() => $('splitDisplay').classList.remove('show'), 3000);
  }
  
  renderLaps();
}

function renderLaps() {
  const btns = [$('clearLapsBtn'), $('exportLapsBtn')];
  btns.forEach(b => b.disabled = laps.length === 0);
  
  if (laps.length === 0) {
    $('lapsStats').classList.add('hidden');
    $('lapsList').innerHTML = '';
    return;
  }
  
  const splits = laps.map(l => l.split);
  const best = Math.min(...splits), worst = Math.max(...splits);
  const avg = splits.reduce((a, b) => a + b, 0) / splits.length;
  
  $('bestLap').textContent = fmt(best);
  $('avgLap').textContent = fmt(avg);
  $('worstLap').textContent = fmt(worst);
  $('lapsStats').classList.remove('hidden');
  
  $('lapsList').innerHTML = [...laps].reverse().map((l, i) => {
    const n = laps.length - i;
    const isBest = l.split === best && laps.length > 1;
    const isWorst = l.split === worst && laps.length > 1;
    // Bar width is the split relative to the slowest lap, so the shape of the run reads at a glance
    const w = worst > 0 ? Math.max(3, Math.round(l.split / worst * 100)) : 0;
    return '<div class="lap-item' + (isBest ? ' is-best' : isWorst ? ' is-worst' : '') + '">' +
      '<span class="lap-bar" style="width:' + w + '%"></span>' +
      '<span class="lap-num">#' + n + '</span>' +
      '<span class="lap-split' + (isBest ? ' best' : isWorst ? ' worst' : '') + '">' + fmt(l.split) + '</span>' +
      '<span class="lap-total">' + fmt(l.total) + '</span></div>';
  }).join('');
}

// ========== TIMER SETUP ==========
function setTimer(ms) {
  timerDuration = ms;
  timerRemaining = ms;
  elapsed = 0;
  updateDisplay();
  updateRing();
}

function promptCustom() {
  const input = prompt('Enter time (MM:SS or seconds):');
  if (input) {
    const ms = parseTimeInput(input);
    if (ms > 0) setTimer(ms);
  }
}

function parseTimeInput(str) {
  str = str.trim();
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    return ((m || 0) * 60 + (s || 0)) * 1000;
  }
  return (parseInt(str) || 0) * 1000;
}

// ========== EDIT TIME (DOUBLE-CLICK) ==========
function editTime() {
  if (running || mode === 'clock') return;
  const display = $('timeDisplay');
  const current = display.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;text-align:center;width:100%;outline:2px solid var(--accent);border-radius:8px;padding:5px;font-family:inherit;';
  display.innerHTML = '';
  display.appendChild(input);
  input.focus();
  input.select();
  
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const ms = parseTime(input.value);
    if (ms !== null && ms >= 0) {
      if (mode === 'stopwatch') {
        elapsed = ms;
      } else if (mode === 'pomodoro') {
        const secs = Math.round(ms / 1000);
        if (pomoPhase === 'work') settings.pomo.work = secs;
        else if (pomoPhase === 'short') settings.pomo.short = secs;
        else settings.pomo.long = secs;
        save();
        updateUI();
        syncPomoTime();
      } else {
        timerDuration = ms;
        timerRemaining = ms;
      }
    }
    updateDisplay();
    updateRing();
  };
  
  input.onblur = finish;
  input.onkeydown = e => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') { done = true; updateDisplay(); }
  };
}

function parseTime(str) {
  str = str.trim().replace(/[^\d:.,]/g, '');
  if (!str) return null;
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;
  const parts = str.split(/[:.]/).map(p => parseInt(p) || 0);
  if (parts.length === 2) {
    if (str.includes('.')) return (parts[0] * 1000) + (parts[1] * 10);
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    if (str.lastIndexOf('.') > str.lastIndexOf(':')) return (parts[0] * 60 + parts[1]) * 1000 + parts[2] * 10;
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  if (parts.length === 4) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 + parts[3] * 10;
  return null;
}

// ========== DIAL DRAG ==========
function setupDial() {
  const d = $('dial');
  let drag = false;
  
  const angle = e => {
    const t = e.touches ? e.touches[0] : e;
    const r = d.getBoundingClientRect();
    const x = t.clientX - (r.left + r.width / 2);
    const y = t.clientY - (r.top + r.height / 2);
    let a = Math.atan2(y, x) * 180 / Math.PI + 90;
    return a < 0 ? a + 360 : a;
  };
  
  const onRing = e => {
    const t = e.touches ? e.touches[0] : e;
    const r = d.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dist = Math.hypot(t.clientX - cx, t.clientY - cy);
    const rad = r.width / 2;
    return dist > rad * 0.7 && dist < rad * 1.1;
  };
  
  const start = e => {
    if (running || mode === 'clock' || !onRing(e)) return;
    drag = true;
    dialDragging = true;
    document.body.classList.add('dragging');
    e.preventDefault();
  };
  const move = e => {
    if (!drag) return;
    e.preventDefault();
    const a = angle(e);
    const ms = Math.round(a / 360 * 3600000 / 1000) * 1000;
    if (mode === 'stopwatch') elapsed = ms;
    else { timerDuration = ms; timerRemaining = ms; }
    updateDisplay();
    updateRing();
    a11yDial();
  };
  const end = () => {
    if (!drag) return;
    drag = false;
    dialDragging = false;
    document.body.classList.remove('dragging');
  };

  // One pointer path instead of a parallel mouse pair and touch pair. Pointer
  // capture means a drag that leaves the dial still tracks, which the old
  // document-level move listeners were emulating, and it picks up pen input
  // that neither branch handled.
  d.addEventListener('pointerdown', e => {
    start(e);
    if (drag && d.setPointerCapture) { try { d.setPointerCapture(e.pointerId); } catch (err) {} }
  });
  d.addEventListener('pointermove', move);
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);

  // Keyboard equivalent of the drag. Arrows nudge, Shift takes a minute,
  // Home/End go to the ends — the same contract as a native range input. Clock
  // mode is a readout, not a control, so it opts out along with a running one.
  d.addEventListener('keydown', e => {
    if (running || mode === 'clock') return;
    const cur = mode === 'stopwatch' ? elapsed : timerDuration;
    const step = e.shiftKey ? 60000 : 1000;
    let next = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = cur + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = cur - step;
    else if (e.key === 'PageUp') next = cur + 60000;
    else if (e.key === 'PageDown') next = cur - 60000;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 3600000;
    if (next === null) return;
    e.preventDefault();
    next = Math.max(0, Math.min(3600000, next));
    if (mode === 'stopwatch') elapsed = next;
    else { timerDuration = next; timerRemaining = next; }
    updateDisplay();
    updateRing();
    a11yDial();
    say(spokenTime(next));
  });
}

// ========== EDIT TITLE ==========
function editTitle() {
  const el = $('titleEdit');
  const curr = el.textContent.replace('⏱ ', '');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = curr;
  inp.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;width:150px;outline:2px solid var(--accent);border-radius:4px;padding:2px 8px;';
  el.textContent = '';
  el.appendChild(inp);
  inp.focus();
  inp.select();
  
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const val = inp.value.trim() || 'Chronos';
    el.textContent = '⏱ ' + val;
    try { localStorage.setItem('chronos_title', val); } catch (e) {}
  };
  
  inp.onblur = finish;
  inp.onkeydown = e => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') { done = true; el.textContent = '⏱ ' + curr; }
  };
}

// ========== HISTORY & STATS ==========
function logSession() {
  const today = new Date().toDateString();
  if (analytics.lastDate !== today) {
    analytics.sessions = 0;
    analytics.focus = 0;
    if (analytics.lastDate) {
      const diff = Math.floor((new Date(today) - new Date(analytics.lastDate)) / 86400000);
      analytics.streak = diff === 1 ? analytics.streak + 1 : 1;
    } else analytics.streak = 1;
  }
  analytics.sessions++;
  analytics.lastDate = today;
  const dur = mode === 'stopwatch' ? elapsed : timerDuration;
  // Pomodoro accrues focus in complete() so break phases don't double-count
  if (mode !== 'pomodoro') analytics.focus += Math.round(dur / 1000);
  history.push({ type: mode, duration: dur, laps: laps.length, tag: sessionTag || '', date: new Date().toISOString() });
  if (sessionTag) rememberTag(sessionTag);
  save();
  updateStats();
  updateGoal();
  renderMiniWeek();
}

// Typing alone used to do nothing visible — the tag was only saved once a
// session finished logging. Commit on Enter/blur so it lands straight away.
function commitTag() {
  const t = $('tagInput').value.trim();
  sessionTag = t;
  if (t) { rememberTag(t); save(); }
  else renderTagChips();
}

function rememberTag(t) {
  settings.recentTags = [t, ...settings.recentTags.filter(x => x !== t)].slice(0, 6);
  renderTagChips();
}

function renderTagChips() {
  $('tagRecent').innerHTML = settings.recentTags.map(t =>
    '<button class="tag-chip' + (t === sessionTag ? ' on' : '') + '" data-tag="' + esc(t) + '">' +
    '<span class="tag-lbl">' + esc(t) + '</span>' +
    '<i class="tag-x" data-del="' + esc(t) + '" title="Remove">\u00d7</i></button>'
  ).join('');
}

function forgetTag(t) {
  settings.recentTags = settings.recentTags.filter(x => x !== t);
  save();
  renderTagChips();
}

function deleteSession(iso) {
  const i = history.findIndex(h => h.date === iso);
  if (i < 0) return;
  const row = history[i];
  history.splice(i, 1);
  // Roll today's counters back so the header stats stay honest
  if (new Date(row.date).toDateString() === new Date().toDateString()) {
    analytics.sessions = Math.max(0, analytics.sessions - 1);
    if (row.type !== 'pomodoro') analytics.focus = Math.max(0, analytics.focus - Math.round((row.duration || 0) / 1000));
  }
  save();
  updateStats();
  renderDash();
  renderMiniWeek();
  updateGoal();
}

// ========== POMODORO PHASE CONTROLS ==========
// Previously the only mid-session options were "let it run" or "reset the whole
// cycle". These are the two things you actually reach for.
function extendPhase(secs) {
  if (mode !== 'pomodoro') return;
  timerDuration += secs * 1000;
  timerRemaining = Math.max(0, timerDuration - elapsed);
  updateDisplay();
  updateRing();
}

function skipPhase() {
  if (mode !== 'pomodoro') return;
  // Jump to the end and let complete() do the phase routing, so rounds, focus
  // totals and auto-start all behave exactly as a natural finish would.
  const wasRunning = running;
  if (!wasRunning) { running = true; startTime = Date.now() - timerDuration; }
  elapsed = timerDuration;
  timerRemaining = 0;
  complete();
}

// ========== DASHBOARD ==========
const dayKey = d => new Date(d).toDateString();

// History filtered to the active dashboard range
function rangeHistory() {
  if (!dashRange) return history;
  const cut = Date.now() - dashRange * 86400000;
  return history.filter(h => new Date(h.date).getTime() >= cut);
}

// Total focus seconds per tag, biggest first
function focusByTag() {
  const m = {};
  rangeHistory().forEach(h => {
    const k = (h.tag || '').trim() || 'Untagged';
    m[k] = (m[k] || 0) + Math.round((h.duration || 0) / 1000);
  });
  return Object.keys(m).map(k => ({ tag: k, secs: m[k] })).sort((a, b) => b.secs - a.secs);
}

function renderTagBars() {
  const rows = focusByTag();
  if (!rows.length) return $('tagBars').innerHTML = '<div class="history-empty">No sessions in this range</div>';
  const max = rows[0].secs || 1;
  $('tagBars').innerHTML = rows.slice(0, 8).map(r =>
    '<div class="tag-bar"><div class="tag-bar-head"><span>' + esc(r.tag) + '</span><b>' + formatFocus(r.secs) + '</b></div>' +
    '<div class="tag-bar-track"><i style="width:' + Math.max(2, Math.round(r.secs / max * 100)) + '%"></i></div></div>'
  ).join('');
}

// Total focus seconds per day across all history, keyed by toDateString()
function focusByDay() {
  const m = {};
  rangeHistory().forEach(h => {
    const k = dayKey(h.date);
    m[k] = (m[k] || 0) + Math.round((h.duration || 0) / 1000);
  });
  return m;
}

function openDash() {
  renderDash();
  $('dashboard').classList.add('active');
  $('dashScrim').classList.add('active');
  openModal($('dashboard'), $('closeHistory'));
  a11ySync();
}

function closeDash() {
  $('dashboard').classList.remove('active');
  $('dashScrim').classList.remove('active');
  closeModal();
  a11ySync();
}

function renderDash() {
  renderKpis();
  renderTagBars();
  renderWeek();
  renderHeat();
  renderHistory();
}

function renderKpis() {
  const byDay = focusByDay();
  const days = Object.keys(byDay);
  const total = days.reduce((a, k) => a + byDay[k], 0);
  const best = days.reduce((a, k) => Math.max(a, byDay[k]), 0);
  const avg = days.length ? Math.round(total / days.length) : 0;
  
  $('dashSub').textContent = history.length
    ? history.length + ' session' + (history.length === 1 ? '' : 's') + ' across ' + days.length + ' day' + (days.length === 1 ? '' : 's')
    : 'No sessions yet';
  
  const k = (v, l) => '<div class="kpi"><div class="kpi-val">' + v + '</div><div class="kpi-lbl">' + l + '</div></div>';
  $('dashKpis').innerHTML =
    k(formatFocus(total), 'Total Focus') +
    k(history.length, 'Sessions') +
    k(formatFocus(best), 'Best Day') +
    k(formatFocus(avg), 'Daily Average');
}

function renderWeek() {
  const byDay = focusByDay();
  const today = new Date();
  const cols = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    cols.push({ d, secs: byDay[d.toDateString()] || 0 });
  }
  const max = Math.max(1, ...cols.map(c => c.secs));
  
  $('weekChart').innerHTML = cols.map((c, i) => {
    const pct = Math.round(c.secs / max * 100);
    const lbl = c.d.toLocaleDateString([], { weekday: 'short' });
    return '<div class="wc-col' + (i === 6 ? ' today' : '') + '">' +
      '<div class="wc-bar" data-v="' + formatFocus(c.secs) + '" style="height:' + Math.max(pct, 2) + '%"></div>' +
      '<div class="wc-lbl">' + lbl + '</div></div>';
  }).join('');
}

function renderHeat() {
  const byDay = focusByDay();
  const WEEKS = 12;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Wind back to the Monday that starts the earliest visible week
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  
  const vals = Object.values(byDay).filter(v => v > 0);
  const max = vals.length ? Math.max(...vals) : 1;
  
  let h = '';
  const cur = new Date(start);
  while (cur <= today) {
    const secs = byDay[cur.toDateString()] || 0;
    const lvl = secs === 0 ? 0 : Math.min(4, Math.ceil(secs / max * 4));
    h += '<div class="hc l' + lvl + '" title="' + cur.toLocaleDateString() + ' — ' + formatFocus(secs) + '"></div>';
    cur.setDate(cur.getDate() + 1);
  }
  $('heatmap').innerHTML = h;
  $('heatNote').textContent = 'last ' + WEEKS + ' weeks';
}

function renderHistory() {
  $('clearHistoryBtn').disabled = !history.length;
  const rows = [...history].reverse().filter(h => dashFilter === 'all' || h.type === dashFilter);
  $('historyList').innerHTML = rows.length ? rows.slice(0, 60).map(h => {
    const d = new Date(h.date);
    return '<div class="history-item"><div class="history-header">' +
      '<span class="history-type">' + h.type + (h.laps ? ' · ' + h.laps + ' laps' : '') + '</span>' +
      '<span class="history-date">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span></div>' +
      '<div class="history-duration">' + formatDur(h.duration) + '</div>' +
      (h.tag ? '<div class="history-tag">' + esc(h.tag) + '</div>' : '') +
      '<button class="hist-del" data-iso="' + h.date + '" title="Delete session">' + icon('trash', 15) + '</button></div>';
  }).join('') : '<div class="history-empty">No sessions yet</div>';
}

// ========== GOAL & MINI WEEK ==========
// formatFocus gives "2h 0m" for whole hours, which reads badly in a label
function formatGoal(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return h + 'h ' + m + 'm';
  return h ? h + 'h' : m + 'm';
}

function updateGoal() {
  const target = settings.dailyGoal * 60;
  const p = target > 0 ? Math.min(analytics.focus / target, 1) : 0;
  const C = 2 * Math.PI * 52;
  $('goalFg').style.strokeDashoffset = C * (1 - p);
  $('goalPct').textContent = Math.round(p * 100);
  $('goalRing').classList.toggle('hit', p >= 1);
}

function renderMiniWeek() {
  const byDay = focusByDay();
  const today = new Date();
  const cols = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    cols.push({ d, secs: byDay[d.toDateString()] || 0 });
  }
  const max = Math.max(1, ...cols.map(c => c.secs));
  $('miniWeek').innerHTML = cols.map((c, i) =>
    '<div class="mw-bar' + (i === 6 ? ' today' : '') + '" title="' +
    c.d.toLocaleDateString([], { weekday: 'short' }) + ' — ' + formatFocus(c.secs) +
    '" style="height:' + Math.max(Math.round(c.secs / max * 100), 6) + '%"></div>'
  ).join('');
}

// ========== TIMER PRESETS ==========
function renderPresets() {
  const p = [...settings.presets].sort((a, b) => a - b);
  $('presets').innerHTML = p.map(s =>
    '<button class="preset-btn" data-time="' + (s * 1000) + '">' + presetLabel(s) +
    '<i class="preset-x" data-drop="' + s + '" title="Remove">\u00d7</i></button>'
  ).join('') +
  '<button class="preset-btn add" data-time="0">+ Add</button>';
}

function presetLabel(s) {
  if (s % 3600 === 0) return (s / 3600) + 'h';
  if (s % 60 === 0) return (s / 60) + 'm';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

function addPreset(secs) {
  if (!secs || settings.presets.includes(secs)) return;
  settings.presets = [...settings.presets, secs].sort((a, b) => a - b).slice(0, 10);
  save();
  renderPresets();
}

function dropPreset(secs) {
  settings.presets = settings.presets.filter(x => x !== secs);
  save();
  renderPresets();
}

// ========== POMODORO PIPS ==========
// A 9px dot plus a 10px gap (--s2) each. Twelve of them overflow a 200px dial,
// so the ceiling is whichever is smaller: what's legible, or what actually fits.
function pipCapacity() {
  return Math.max(4, Math.min(PIP_MAX, Math.floor((settings.dialSize + 10) / 19)));
}

function renderPips() {
  const n = settings.pomo.rounds, host = $('pomoPips');
  const bar = n > pipCapacity();
  host.classList.toggle('as-bar', bar);
  
  // A dot per round stops fitting the dial — and stops being countable — well
  // before the 20-round ceiling, so past PIP_MAX it becomes a bar and a readout.
  if (bar) {
    let fill = host.querySelector('.pip-fill');
    if (!fill) {   // rebuild only on the pips → bar switch, so width can animate
      host.innerHTML = '<span class="pip-bar"><span class="pip-fill"></span></span><span class="pip-count"></span>';
      fill = host.querySelector('.pip-fill');
    }
    fill.style.width = (Math.max(0, Math.min(1, (pomoRound - 1) / n)) * 100).toFixed(2) + '%';
    host.querySelector('.pip-count').textContent = pomoRound + ' / ' + n;
    return;
  }
  
  let h = '';
  for (let i = 1; i <= n; i++) {
    const cls = i < pomoRound ? ' done' : i === pomoRound ? ' current' : '';
    h += '<span class="pip' + cls + '" title="Round ' + i + ' of ' + n + '"></span>';
  }
  host.innerHTML = h;
}

function formatDur(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + s + 's' : s + 's';
}

function updateStats() {
  $('statSessions').textContent = analytics.sessions;
  $('statFocus').textContent = formatFocus(analytics.focus);
  $('statStreak').textContent = analytics.streak + 'd';
}

function updateWorldClocks() {
  if (!settings.worldClocks) return;
  $('worldClocks').innerHTML = settings.clocks.map(c => {
    try {
      const opts = { timeZone: tzMap[c], hour: '2-digit', minute: '2-digit', hour12: settings.hour12 };
      if (settings.clockSeconds) opts.second = '2-digit';
      const t = new Date().toLocaleTimeString('en-US', opts);
      return '<div class="world-clock"><div class="world-clock-city">' + c + '</div><div class="world-clock-time">' + t + '</div></div>';
    } catch { return ''; }
  }).join('');
}

// ========== SOUNDS ==========
function actx() {
  if (!ambientCtx) ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (ambientCtx.state === 'suspended') ambientCtx.resume();
  return ambientCtx;
}

function playAlert() {
  if (settings.alertSound === 'none') return;
  const ctx = actx();
  const play = (f, t, d, type) => {
    type = type || 'sine';
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = f; o.type = type;
    g.gain.setValueAtTime(settings.volume * 0.3, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + d);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + d);
  };
  
  if (settings.alertSound === 'chime') { play(523, 0, 0.3); play(659, 0.15, 0.3); play(784, 0.3, 0.4); }
  else if (settings.alertSound === 'beep') { play(880, 0, 0.15); play(880, 0.2, 0.15); play(880, 0.4, 0.15); }
  else if (settings.alertSound === 'bell') { play(440, 0, 0.8); play(554, 0, 0.6); play(659, 0, 0.4); }
  else if (settings.alertSound === 'alarm') { for (let i = 0; i < 6; i++) play(800, i * 0.15, 0.1, 'square'); }
  else if (settings.alertSound === 'gong') { play(130, 0, 2); play(260, 0, 1.5); play(390, 0, 1); }
}

function playTick() {
  const ctx = actx();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.frequency.value = 800; o.type = 'sine';
  g.gain.setValueAtTime(Math.max(0.0001, settings.volume * 0.1), ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
  o.start(); o.stop(ctx.currentTime + 0.05);
}

// ========== AMBIENT SOUNDS ==========
// Each bed gets its own noise colour and filter. Previously all five were the
// same white-noise buffer at a hardcoded gain, so they sounded identical and
// ignored the volume slider entirely.
const AMBIENT = {
  rain:   { filter: 'highpass', freq: 900,  q: 0.6, gain: 0.55 },
  fire:   { filter: 'lowpass',  freq: 800,  q: 0.8, gain: 0.65 },
  waves:  { filter: 'lowpass',  freq: 520,  q: 0.5, gain: 0.85 },
  forest: { filter: 'bandpass', freq: 2400, q: 0.7, gain: 0.60 },
  cafe:   { filter: 'lowpass',  freq: 320,  q: 0.5, gain: 0.75 }
};

function ambientLevel() {
  return activeAmbient ? settings.volume * 0.6 * AMBIENT[activeAmbient].gain : 0;
}

function ambientBuffer(sound, ctx) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 8);
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  let br = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, w = Math.random() * 2 - 1;
    br = (br + w * 0.02) / 1.02;                 // brown noise integrator
    if (sound === 'rain') d[i] = w * 0.5 * (0.85 + 0.15 * Math.sin(t * Math.PI / 2));
    else if (sound === 'fire') d[i] = br * 4;
    else if (sound === 'waves') d[i] = br * 7 * (0.15 + 0.85 * Math.pow(Math.sin(t * Math.PI / 4), 2));
    else if (sound === 'forest') d[i] = w * 0.12 + br * 2;
    else d[i] = br * 5 + w * 0.04;
  }
  if (sound === 'fire') for (let k = 0; k < 260; k++) {          // crackles
    const p = Math.floor(Math.random() * (len - 600)), a = Math.random() * 0.5 + 0.15;
    for (let j = 0; j < 400; j++) d[p + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 45);
  }
  if (sound === 'forest') for (let k = 0; k < 12; k++) {         // birdsong
    const p = Math.floor(Math.random() * (len - sr)), f = 2200 + Math.random() * 1800, n = Math.floor(sr * 0.11);
    for (let j = 0; j < n; j++) d[p + j] += Math.sin(2 * Math.PI * (f + j / sr * 800) * j / sr) * 0.16 * Math.sin(Math.PI * j / n);
  }
  if (sound === 'cafe') for (let i = 0; i < len; i++) d[i] *= 0.75 + 0.25 * Math.sin(i / sr * Math.PI / 2 + 1);
  // Match endpoints so the loop seam doesn't click
  const drift = d[len - 1] - d[0];
  for (let i = 0; i < len; i++) d[i] -= drift * i / (len - 1);
  return buf;
}

function stopAmbient() {
  Object.keys(ambientNodes).forEach(k => {
    try { ambientNodes[k].stop(); ambientNodes[k].disconnect(); } catch (e) {}
    delete ambientNodes[k];
  });
  ambientGain = null;
  activeAmbient = null;
}

function toggleAmbient(sound) {
  const prev = activeAmbient;
  stopAmbient();
  document.querySelectorAll('.ambient-btn').forEach(b => b.classList.remove('active'));
  if (prev === sound || !AMBIENT[sound]) return;

  const ctx = actx(), cfg = AMBIENT[sound];
  const node = ctx.createBufferSource();
  node.buffer = ambientBuffer(sound, ctx);
  node.loop = true;

  const filt = ctx.createBiquadFilter();
  filt.type = cfg.filter;
  filt.frequency.value = cfg.freq;
  filt.Q.value = cfg.q;

  const g = ctx.createGain();
  node.connect(filt); filt.connect(g); g.connect(ctx.destination);

  ambientNodes[sound] = node;
  ambientGain = g;
  activeAmbient = sound;
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(ambientLevel(), ctx.currentTime + 0.6);
  node.start();

  document.querySelector('.ambient-btn[data-sound="' + sound + '"]').classList.add('active');
  say(sound.charAt(0).toUpperCase() + sound.slice(1) + ' sound on');
}

// ========== QUOTES ==========
function showQuote() {
  if (!settings.tips || !settings.showQuotes || !settings.customQuotes.length) return;
  const q = settings.customQuotes[Math.floor(Math.random() * settings.customQuotes.length)];
  $('quoteText').textContent = '"' + q.text + '"';
  $('quoteAuthor').textContent = '— ' + q.author;
  $('quoteBox').classList.add('show');
  setTimeout(() => $('quoteBox').classList.remove('show'), 8000);
}

// ========== CONFETTI ==========
function launchConfetti() {
  const canvas = $('particles'), ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.opacity = '1';
  
  const cs = getComputedStyle(document.body);
  const pal = ['--accent', '--accent2', '--text', '--accent'].map(v => cs.getPropertyValue(v).trim()).filter(Boolean);
  const r = $('dial').getBoundingClientRect();
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  const ps = [];
  
  for (let i = 0; i < 150; i++) {
    const a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 14;
    ps.push({
      x: ox, y: oy,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5,
      c: pal[i % pal.length],
      w: 2 + Math.random() * 7, h: 2 + Math.random() * 10,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.45,
      a: 1
    });
  }
  
  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ps.forEach(p => {
      p.vy += 0.34;
      p.vx *= 0.986; p.vy *= 0.986;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vr;
      p.a = Math.max(0, 1 - frame / 150);
      ctx.save();
      ctx.globalAlpha = p.a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (frame < 150) requestAnimationFrame(animate);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.opacity = '0'; }
  };
  animate();
}

// ========== WAKE LOCK ==========
async function requestWake() {
  if (!settings.wake || !navigator.wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}

function releaseWake() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// ========== VOICE ==========
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Speech recognition not supported');
    return;
  }
  
  if (voiceActive) {
    if (recognition) recognition.stop();
    voiceActive = false;
    $('voiceIndicator').classList.remove('show');
    return;
  }
  
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  
  recognition.onresult = e => {
    const transcript = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
    $('voiceText').textContent = transcript;
    if (transcript.includes('start') || transcript.includes('go')) start();
    else if (transcript.includes('stop') || transcript.includes('pause')) pause();
    else if (transcript.includes('lap')) recordLap();
    else if (transcript.includes('reset')) reset();
  };
  
  recognition.onerror = () => { voiceActive = false; $('voiceIndicator').classList.remove('show'); };
  recognition.onend = () => { if (voiceActive) recognition.start(); };
  
  recognition.start();
  voiceActive = true;
  $('voiceIndicator').classList.add('show');
}

// ========== MATRIX EFFECT ==========
let mCanvas = null, mCtx = null, mDrops = [];
const M_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';

function sizeMatrix() {
  if (!mCanvas) return;
  mCanvas.width = window.innerWidth;
  mCanvas.height = window.innerHeight;
  mDrops = Array(Math.floor(mCanvas.width / 20)).fill(1);
}

function startMatrix() {
  if (matrixTimer) return;
  if (!mCanvas) { mCanvas = $('matrix'); mCtx = mCanvas.getContext('2d'); }
  sizeMatrix();
  matrixTimer = setInterval(drawMatrix, 50);
}

function stopMatrix() {
  if (matrixTimer) { clearInterval(matrixTimer); matrixTimer = null; }
}

function drawMatrix() {
  mCtx.fillStyle = 'rgba(0,0,0,0.05)';
  mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height);
  mCtx.fillStyle = '#0f0';
  mCtx.font = '15px monospace';
  
  for (let i = 0; i < mDrops.length; i++) {
    mCtx.fillText(M_CHARS[Math.floor(Math.random() * M_CHARS.length)], i * 20, mDrops[i] * 20);
    if (mDrops[i] * 20 > mCanvas.height && Math.random() > 0.975) mDrops[i] = 0;
    mDrops[i]++;
  }
}

// ========== PIP ==========
async function openPiP() {
  if (!('documentPictureInPicture' in window)) { alert('PiP requires Chrome 116+'); return; }
  try {
    const cs = getComputedStyle(document.body);
    const v = n => cs.getPropertyValue(n).trim();
    const pw = await documentPictureInPicture.requestWindow({ width: 320, height: 190 });
    pw.document.body.innerHTML =
      '<style>' +
      '*{margin:0;box-sizing:border-box}' +
      'body{background:' + v('--bg') + ';color:' + v('--text') + ';font-family:Inter,system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}' +
      '.t{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:42px;font-weight:700;letter-spacing:-2px;font-variant-numeric:tabular-nums}' +
      '.l{font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:' + v('--text2') + '}' +
      '.b{display:flex;gap:10px;margin-top:10px}' +
      '.b button{width:36px;height:36px;border-radius:50%;border:1px solid ' + v('--border') + ';background:' + v('--card') + ';color:' + v('--text') + ';font-size:14px;cursor:pointer}' +
      '.b .p{background:' + v('--accent') + ';border-color:' + v('--accent') + ';color:#fff}' +
      '</style>' +
      '<div class="t" id="t">' + $('timeDisplay').textContent + '</div>' +
      '<div class="l">' + $('timeLabel').textContent + '</div>' +
      '<div class="b"><button class="p" id="pp">' + (running ? '⏸' : '▶') + '</button><button id="pr">↺</button></div>';
    const sync = setInterval(() => {
      if (pw.closed) return clearInterval(sync);
      pw.document.getElementById('t').textContent = $('timeDisplay').textContent;
      pw.document.getElementById('pp').textContent = running ? '⏸' : '▶';
    }, 50);
    pw.document.getElementById('pp').onclick = togglePlay;
    pw.document.getElementById('pr').onclick = reset;
  } catch (e) { console.error(e); }
}

// ========== THEME SWAP ==========
// apply() clears body.className and rebuilds it, so this can't just be a class
// added at the call site — it has to be state that syncBodyState() re-asserts.
let themeSwapping = false;
let themeSwapTO = null;
function themeSwap() {
  if (RM) return;
  themeSwapping = true;
  syncBodyState();
  clearTimeout(themeSwapTO);
  themeSwapTO = setTimeout(() => { themeSwapping = false; syncBodyState(); }, 460);
}

// ========== BODY STATE ==========
function syncBodyState() {
  const b = document.body;
  b.classList.toggle('theme-swap', themeSwapping);
  b.classList.toggle('ready', booted);
  b.classList.toggle('running', running);
  b.classList.toggle('mode-stopwatch', mode === 'stopwatch');
  b.classList.toggle('mode-timer', mode === 'timer');
  b.classList.toggle('mode-pomodoro', mode === 'pomodoro');
  b.classList.toggle('mode-clock', mode === 'clock');
  b.classList.toggle('phase-break', mode === 'pomodoro' && pomoPhase !== 'work');
}

// ========== BOOT SEQUENCE ==========
function boot() {
  const el = $('boot');
  let seen = false;
  try { seen = !!sessionStorage.getItem('chronos_boot'); sessionStorage.setItem('chronos_boot', '1'); } catch (e) {}
  
  const done = () => { booted = true; syncBodyState(); moveTab(); };
  
  if (RM || seen) { el.remove(); done(); return; }
  
  requestAnimationFrame(() => el.classList.add('go'));
  setTimeout(() => { el.classList.add('out'); done(); setTimeout(() => el.remove(), 900); }, 780);
}

// ========== DIAL TICKS ==========
// Hour numerals on the face. Drawn into the same rotated frame as the ticks —
// .ring-svg carries rotate(-90deg), so a numeral placed at raw angle n*30
// lands where you'd expect (12 at the top) but arrives lying on its side. Each
// glyph is counter-rotated about its own centre to stand back up.
const NUMERAL_SETS = {
  quarters: [12, 3, 6, 9],
  all: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  minutes: [60, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
};

function buildNumerals() {
  const g = $('numerals');
  if (!g) return;
  if (!settings.showNumerals) { g.innerHTML = ''; return; }
  const set = NUMERAL_SETS[settings.numeralStyle] || NUMERAL_SETS.quarters;
  const step = 360 / set.length;
  const r = 84;
  g.innerHTML = set.map((label, i) => {
    const deg = i * step;
    const a = deg * Math.PI / 180;
    const x = (140 + r * Math.cos(a)).toFixed(2);
    const y = (140 + r * Math.sin(a)).toFixed(2);
    return '<text class="numeral" x="' + x + '" y="' + y + '"' +
      ' transform="rotate(90 ' + x + ' ' + y + ')"' +
      ' text-anchor="middle" dominant-baseline="central">' + label + '</text>';
  }).join('');
}

function buildTicks() {
  let h = '';
  for (let i = 0; i < 60; i++) {
    const a = i * 6 * Math.PI / 180, maj = i % 5 === 0;
    const r1 = maj ? 99 : 105, r2 = 112;
    h += '<line class="tick' + (maj ? ' maj' : '') + '"' +
      ' x1="' + (140 + r1 * Math.cos(a)).toFixed(2) + '" y1="' + (140 + r1 * Math.sin(a)).toFixed(2) + '"' +
      ' x2="' + (140 + r2 * Math.cos(a)).toFixed(2) + '" y2="' + (140 + r2 * Math.sin(a)).toFixed(2) + '"/>';
  }
  $('ticks').innerHTML = h;
  litCount = -1;   // classes just got wiped; force the next paintLamps to redraw
}

// ========== TAB INDICATOR ==========
function moveTab() {
  const a = document.querySelector('.mode-tab.active'), ind = $('tabInd');
  if (!a || !ind) return;
  // Hidden (immersive mode, panel closed before layout) — measuring now would
  // burn the first-run flag on a zero-size box.
  if (!a.offsetWidth) return;
  
  // The pill ships as a 0×0 box at the origin with a .6s spring on transform
  // and width. Animating the very first placement flies it in from the top-left
  // corner; every placement after that is a real tab-to-tab move and should.
  const first = !tabPlaced;
  if (first) { tabPlaced = true; ind.style.transition = 'none'; }
  
  ind.style.top = a.offsetTop + 'px';
  ind.style.height = a.offsetHeight + 'px';
  ind.style.width = a.offsetWidth + 'px';
  ind.style.transform = 'translateX(' + a.offsetLeft + 'px)';

  // With four tabs on a narrow screen the row scrolls; keep the active tab in
  // view so a keyboard or shortcut switch doesn't move it somewhere off-screen.
  const row = a.parentElement;
  if (row.scrollWidth > row.clientWidth) {
    const left = a.offsetLeft - (row.clientWidth - a.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: first ? 'auto' : 'smooth' });
  }

  if (first) { void ind.offsetWidth; ind.style.transition = ''; }
}

// ========== COLLAPSIBLE SETTINGS SECTIONS ==========
// Wraps everything after each <h3> in an animatable grid box. Done in JS so
// new sections added to the HTML get this for free with no extra markup.
function initSections() {
  document.querySelectorAll('#settingsPanel .panel-section').forEach((sec, i) => {
    const head = sec.querySelector('h3');
    if (!head || sec.querySelector('.sec-body')) return;
    const name = head.textContent.trim();
    
    const outer = document.createElement('div');
    outer.className = 'sec-body';
    const inner = document.createElement('div');
    while (head.nextSibling) inner.appendChild(head.nextSibling);
    outer.appendChild(inner);
    sec.appendChild(outer);
    
    // First section stays open on a fresh install; the rest remember their state
    // Their panel has no collapse at all — createSection() builds a header with
    // an icon and a label and nothing else, and every section is open. Chronos
    // keeps the collapse, but a fresh install now starts fully open to match;
    // shutting one still sticks.
    const shut = settings.shutSections.length > 0 && settings.shutSections.includes(name);
    sec.classList.toggle('shut', shut);
    
    head.onclick = () => {
      sec.classList.toggle('shut');
      settings.shutSections = [...document.querySelectorAll('#settingsPanel .panel-section.shut')]
        .map(s => s.querySelector('h3').textContent.trim());
      save();
    };
  });
}

// ========== SHORTCUT OVERLAY ==========
const EXTRA_KEYS = [
  ['?', 'This overlay'],
  ['Ctrl / ⌘ K', 'Command palette'],
  ['Esc', 'Close panels'],
  ['Double-click time', 'Edit directly'],
  ['Drag ring', 'Scrub duration']
];

function buildKeysList() {
  const labels = { toggle: 'Start / Pause', lap: 'Lap', reset: 'Reset', fullscreen: 'Fullscreen', settings: 'Settings' };
  const row = (k, l) => '<div class="keys-row"><span>' + l + '</span><kbd>' + k + '</kbd></div>';
  // Only the digits that go somewhere. With a single mode enabled there's
  // nothing to switch to, so the row goes entirely.
  const digits = MODES.map((m, i) => settings.modes[m] ? String(i + 1) : null).filter(Boolean);
  $('keysGrid').innerHTML =
    Object.keys(labels).map(a => row(codeToDisplay(settings.keys[a]), labels[a])).join('') +
    (digits.length > 1 ? row(digits.join(' / '), 'Switch mode') : '') +
    EXTRA_KEYS.map(p => row(p[0], p[1])).join('');
}

function toggleKeys() {
  buildKeysList();
  const on = $('keysOverlay').classList.toggle('active');
  if (on) openModal($('keysOverlay')); else closeModal();
}

// ========== COMMAND PALETTE ==========
let COMMANDS = [];

function buildPalette() {
  const cmd = (ico, name, cat, run) => ({ ico: icon(ico, 16), name, cat, run });
  COMMANDS = [
    cmd('play', 'Start / Pause', 'Control', togglePlay),
    cmd('reset', 'Reset', 'Control', reset),
    cmd('flag', 'Record lap', 'Control', recordLap),
    cmd('expand', 'Toggle fullscreen', 'View', toggleFS),
    cmd('chart', 'Open dashboard', 'View', openDash),
    cmd('cog', 'Open settings', 'View', () => $('settingsBtn').click()),
    cmd('keyboard', 'Keyboard shortcuts', 'View', toggleKeys),
    cmd('pip', 'Picture-in-Picture', 'View', openPiP),
    cmd('layers', 'Toggle dark mode', 'View', () => { settings.dark = !settings.dark; themeSwap(); save(); apply(); }),
    cmd('layers', 'Toggle wide layout', 'View', () => { settings.wide = !settings.wide; save(); apply(); }),
    cmd('timer', 'Pomodoro: skip phase', 'Control', skipPhase),
    cmd('timer', 'Pomodoro: add 5 minutes', 'Control', () => extendPhase(300)),
    cmd('chart', 'Export backup', 'Data', () => $('exportSettingsBtn').click()),
    cmd('trash', 'Clear session history', 'Data', () => $('clearHistoryBtn').click()),
    cmd('expand', 'Toggle Focus On card', 'View', () => { settings.showTagCard = !settings.showTagCard; save(); apply(); }),
    cmd('clock', 'Toggle 12-hour format', 'View', () => $('hour12Toggle').click()),
    cmd('clock', 'Toggle clock seconds', 'View', () => $('clockSecondsToggle').click())
  ];
  
  [[60000, '1 minute'], [180000, '3 minutes'], [300000, '5 minutes'], [600000, '10 minutes'], [1500000, '25 minutes']]
    .forEach(p => COMMANDS.push(cmd('timer', 'Timer: ' + p[1], 'Preset', () => { switchMode('timer'); setTimer(p[0]); })));
  
  // Every mode is reachable here whether or not its tab is showing — selecting
  // one turns the tab back on, which is what someone who searched for it wants.
  // It's also the only way back if all the tabs but one are hidden.
  // The stopwatch glyph (crown button on top) goes to Stopwatch and the wall
  // clock to Clock — they were the other way round, which only became wrong
  // once there was a fourth mode that actually is a wall clock.
  const MODE_ICONS = { stopwatch: 'timer', timer: 'hourglass', pomodoro: 'tomato', clock: 'clock' };
  MODES.forEach(m => COMMANDS.push(cmd(MODE_ICONS[m], m[0].toUpperCase() + m.slice(1) + ' mode', 'Mode', () => {
    if (!settings.modes[m]) { settings.modes[m] = true; save(); apply(); }
    switchMode(m);
  })));
  
  COMMANDS.push(cmd('clock', 'Clock: local time', 'Clock', () => setClockTz('', true)));
  Object.keys(tzMap).forEach(c => COMMANDS.push(cmd('globe', 'Clock: ' + c, 'Clock', () => setClockTz(c, true))));
  
  // Sourced from the theme grid rather than a second hardcoded list — adding a
  // direction is a tile in index.html and nothing else.
  [...document.querySelectorAll('.theme-opt')].forEach(el => {
    const t = el.dataset.theme;
    const name = el.querySelector('.name') ? el.querySelector('.name').textContent : t;
    COMMANDS.push(cmd('layers', 'Theme: ' + name, 'Theme', () => { settings.visualTheme = t; save(); apply(); }));
  });
  
  colors.forEach(c => COMMANDS.push(cmd('spark', 'Accent: ' + c.n, 'Colour', () => { settings.colorTheme = c.n; save(); apply(); renderColors(); })));
  
  document.querySelectorAll('.ambient-btn').forEach(b => {
    const s = b.dataset.sound;
    COMMANDS.push(cmd('sound', 'Ambient: ' + s, 'Sound', () => toggleAmbient(s)));
  });
  
  $('paletteInput').oninput = () => renderPalette();
  $('paletteList').onclick = e => {
    const it = e.target.closest('.pal-item');
    if (it) runCommand(+it.dataset.i);
  };
}

function togglePalette() {
  const p = $('palette');
  const on = p.classList.toggle('active');
  if (!on) { closeModal(); return; }
  focusReturn = document.activeElement;
  $('paletteInput').value = '';
  renderPalette();
  setTimeout(() => $('paletteInput').focus(), 40);
}

// Subsequence match, so "tmr5" finds "Timer: 5 minutes"
function fuzzy(q, s) {
  if (!q) return true;
  s = s.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = s.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

function renderPalette() {
  const q = $('paletteInput').value.trim();
  palMatches = COMMANDS.filter(c => fuzzy(q, c.name + ' ' + c.cat));
  palIndex = 0;
  $('paletteList').innerHTML = palMatches.length
    ? palMatches.map((c, i) =>
        '<div class="pal-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="pal-ico">' + c.ico + '</span><span>' + esc(c.name) + '</span>' +
        '<span class="pal-cat">' + c.cat + '</span></div>').join('')
    : '<div class="pal-empty">No matching command</div>';
}

function paletteKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); $('palette').classList.remove('active'); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!palMatches.length) return;
    palIndex = (palIndex + (e.key === 'ArrowDown' ? 1 : -1) + palMatches.length) % palMatches.length;
    const items = [...$('paletteList').children];
    items.forEach((el, i) => el.classList.toggle('sel', i === palIndex));
    items[palIndex].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); runCommand(palIndex); }
}

function runCommand(i) {
  const c = palMatches[i];
  $('palette').classList.remove('active');
  if (c) setTimeout(c.run, 60);
}

// ========== ACCESSIBILITY ==========
// The UI is built out of divs that carry meaning in a class (.toggle.active,
// .theme-opt.active, .sel.open). That's fine to look at and invisible to
// anything that isn't looking — a screen reader sees an unlabelled group of
// divs. Rather than hand-write ~60 sets of attributes into the markup and then
// hand-sync them in updateUI(), one table below says which class maps to which
// role, and a11ySync() mirrors the class state onto ARIA in a single pass at
// the end of the existing apply cycle. A new toggle picks all this up for free.

// [selector, role, the class that means "on", the ARIA attribute it maps to]
const A11Y_ROLES = [
  ['.toggle',     'switch',   'active',    'aria-checked'],
  ['.theme-opt',  'radio',    'active',    'aria-checked'],
  ['.color-opt',  'radio',    'active',    'aria-checked'],
  ['.font-opt',   'radio',    'active',    'aria-checked'],
  ['.sound-opt',  'radio',    'active',    'aria-checked'],
  ['.clock-opt',  'checkbox', 'active',    'aria-checked'],
  ['.seg-btn',    null,       'is-active', 'aria-pressed'],
  ['.chip',       null,       'active',    'aria-pressed'],
  ['.mode-tab',   null,       'active',    'aria-selected']
];

const A11Y_GROUPS = [
  ['themeGrid', 'radiogroup', 'Visual theme'],
  ['colorGrid', 'radiogroup', 'Accent colour'],
  ['fontGrid',  'radiogroup', 'Display font'],
  ['soundGrid', 'radiogroup', 'Alert sound'],
  ['clockGrid', 'group',      'World clock cities'],
  ['tzGrid',    'radiogroup', 'Clock timezone']
];

// Reads the visible label out of the row a control sits in, so the accessible
// name is the same string on screen and can't drift from it.
function rowLabel(el) {
  const row = el.closest('.setting-row, .slider-row');
  if (!row) return ['', ''];
  const lab = row.querySelector('.setting-label, label');
  if (!lab) return ['', ''];
  // .row-sub is the small explanatory line; it belongs in the description, not
  // the name, or every switch announces a paragraph.
  const sub = lab.querySelector('.row-sub');
  const subText = sub ? sub.textContent.trim() : '';
  const clone = lab.cloneNode(true);
  clone.querySelectorAll('.row-sub').forEach(n => n.remove());
  return [clone.textContent.trim(), subText];
}

function a11yInit() {
  A11Y_ROLES.forEach(([sel, role, , attr]) => {
    document.querySelectorAll(sel).forEach(el => {
      if (role && !el.getAttribute('role')) el.setAttribute('role', role);
      // Native <button> is already in the tab order; a div is not.
      if (el.tagName !== 'BUTTON' && !el.hasAttribute('tabindex')) el.tabIndex = 0;
      if (!el.hasAttribute(attr)) el.setAttribute(attr, 'false');
    });
  });

  document.querySelectorAll('.toggle').forEach(t => {
    const [name, desc] = rowLabel(t);
    if (name) t.setAttribute('aria-label', desc ? name + '. ' + desc : name);
  });

  A11Y_GROUPS.forEach(([id, role, label]) => {
    const g = $(id);
    if (!g) return;
    g.setAttribute('role', role);
    g.setAttribute('aria-label', label);
  });

  // Sliders are native <input type="range"> already — they just have no label
  // tied to them, and their value reads as a bare number ("280") rather than
  // the "280px" sitting next to it.
  document.querySelectorAll('.slider-row').forEach(row => {
    const inp = row.querySelector('.slider'), lab = row.querySelector('label');
    if (inp && lab && !lab.htmlFor) lab.htmlFor = inp.id;
  });

  document.querySelectorAll('.sel-head').forEach(h => {
    h.setAttribute('role', 'button');
    if (!h.hasAttribute('tabindex')) h.tabIndex = 0;
    const body = h.parentElement.querySelector('.sel-body');
    const lab = h.querySelector('.sel-label');
    if (lab) h.setAttribute('aria-label', lab.textContent.trim());
    if (body) {
      if (!body.id) body.id = h.parentElement.id + 'Body';
      h.setAttribute('aria-controls', body.id);
    }
  });

  // Enter and Space activate a native button for free. Promoted divs get the
  // same contract here, once, by delegation — so it also covers tiles rendered
  // later (colours, clocks, timezones, tag chips).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const el = e.target;
    if (!el.matches || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    if (!el.matches('.toggle, .theme-opt, .color-opt, .font-opt, .sound-opt, .clock-opt, .sel-head, .tag-chip, .logo[role="button"], .pomo-stat-value[role="button"]')) return;
    e.preventDefault();
    // #titleEdit is wired to ondblclick, which a synthetic click won't fire.
    if (el.id === 'titleEdit') editTitle(); else el.click();
  });

  // A tablist is expected to behave as one control: Tab reaches it once, then
  // arrows move between the tabs. Hidden tabs are skipped — the Clock mode ships
  // off, and arrowing onto a tab that isn't on screen would be a dead stop.
  const tablist = $('modeTabs');
  if (tablist) tablist.addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('.mode-tab:not(.hidden)')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    tabs[j].focus();
    tabs[j].click();
  });

  a11ySync();
}

// Mirrors class state onto ARIA. Called at the end of updateUI(), so it runs on
// exactly the same cadence as every other bit of UI sync.
function a11ySync() {
  A11Y_ROLES.forEach(([sel, , onClass, attr]) => {
    document.querySelectorAll(sel).forEach(el =>
      el.setAttribute(attr, el.classList.contains(onClass) ? 'true' : 'false'));
  });

  // Roving tabindex: only the selected, visible tab is in the tab order.
  document.querySelectorAll('.mode-tab').forEach(t => {
    const hidden = t.classList.contains('hidden');
    t.tabIndex = (!hidden && t.classList.contains('active')) ? 0 : -1;
    // A hidden tab is display:none, but say so explicitly — .hidden is a class
    // here, and nothing guarantees the reader agrees about what it means.
    t.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  });

  document.querySelectorAll('.sel').forEach(s => {
    const h = s.querySelector('.sel-head');
    if (h) h.setAttribute('aria-expanded', s.classList.contains('open') ? 'true' : 'false');
  });

  DEPS.forEach(([id]) => {
    const d = $(id);
    if (d) d.setAttribute('aria-hidden', d.classList.contains('open') ? 'false' : 'true');
  });

  document.querySelectorAll('.clock-opt').forEach(c =>
    c.setAttribute('aria-disabled', c.classList.contains('disabled') ? 'true' : 'false'));

  document.querySelectorAll('.slider-row').forEach(row => {
    const inp = row.querySelector('.slider'), val = row.querySelector('.slider-val');
    if (inp && val) inp.setAttribute('aria-valuetext', val.textContent.trim());
  });

  // The video seek bar sits outside .slider-row and reads out through .bg-time.
  const seekEl = $('bgSeek');
  if (seekEl) {
    seekEl.setAttribute('aria-label', 'Background video position');
    seekEl.setAttribute('aria-valuetext',
      ($('bgTimeCur').textContent || '0:00') + ' of ' + ($('bgTimeDur').textContent || '0:00'));
  }

  document.querySelectorAll('.ambient-btn').forEach(b =>
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'));

  $('voiceBtn').setAttribute('aria-pressed', voiceActive ? 'true' : 'false');
  $('fullscreenBtn').setAttribute('aria-pressed', settings.fullscreen ? 'true' : 'false');
  $('settingsBtn').setAttribute('aria-expanded', $('settingsPanel').classList.contains('active') ? 'true' : 'false');
  $('historyBtn').setAttribute('aria-expanded', $('dashboard').classList.contains('active') ? 'true' : 'false');
  $('playBtn').setAttribute('aria-label', running ? 'Pause' : 'Start');

  a11yDial();
}

// The dial is a slider while it's settable. In Clock mode it isn't a control at
// all — it's a readout — so it drops the slider role rather than claiming a
// value range nothing can change.
function a11yDial() {
  const d = $('dial');
  if (!d) return;
  if (mode === 'clock') {
    d.setAttribute('role', 'img');
    d.removeAttribute('aria-valuenow');
    d.removeAttribute('aria-valuetext');
    d.setAttribute('aria-label', 'Clock face showing ' + ($('timeDisplay').textContent || 'the current time'));
    d.tabIndex = -1;
    return;
  }
  d.setAttribute('role', 'slider');
  d.tabIndex = 0;
  d.setAttribute('aria-label', 'Duration. Drag the ring, or use the arrow keys, to set the time.');
  const ms = mode === 'stopwatch' ? elapsed : timerRemaining;
  d.setAttribute('aria-valuenow', Math.round(ms / 1000));
  d.setAttribute('aria-valuetext', spokenTime(ms));
  // Dragging only sets a time while stopped; while running the ring is output.
  d.setAttribute('aria-readonly', running ? 'true' : 'false');
}

// "01:30.00" is read out character by character. This isn't.
function spokenTime(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const bits = [];
  if (h) bits.push(h + (h === 1 ? ' hour' : ' hours'));
  if (m) bits.push(m + (m === 1 ? ' minute' : ' minutes'));
  if (s || !bits.length) bits.push(s + (s === 1 ? ' second' : ' seconds'));
  return bits.join(' ');
}

// Announcements. Two channels: `polite` waits for a pause in speech and is used
// for anything the user just did; `assertive` interrupts and is reserved for a
// timer actually reaching zero, which is the one event they may not be looking
// at the screen for.
let lastSaid = '';
function say(msg, assertive) {
  const el = $(assertive ? 'a11yAlert' : 'a11yLive');
  if (!el || msg === lastSaid) return;
  lastSaid = msg;
  // Clearing first forces a re-announcement when the same string repeats.
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}

// ========== FOCUS MANAGEMENT ==========
// A dialog that doesn't trap focus isn't modal — Tab moves out of it, into the
// page behind, and the reader carries on narrating a UI the user can't see.
let focusReturn = null;

function focusables(root) {
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, ' +
    '[tabindex]:not([tabindex="-1"]), .toggle, .theme-opt, .color-opt, .font-opt, .sound-opt, .clock-opt, .sel-head'
  )].filter(el => el.offsetParent !== null || el === document.activeElement);
}

function trapFocus(e) {
  const root = document.querySelector('.panel.active, .dash.active, .palette.active, .keys-overlay.active');
  if (!root || e.key !== 'Tab') return;
  const items = focusables(root);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

// Remembers where focus was so closing a dialog returns it there, rather than
// dumping the user back at the top of the document.
function openModal(el, focusFirst) {
  focusReturn = document.activeElement;
  document.body.classList.add('modal-open');
  setTimeout(() => {
    const target = focusFirst || focusables(el)[0];
    if (target) target.focus();
  }, 60);
}

function closeModal() {
  document.body.classList.remove('modal-open');
  if (focusReturn && document.contains(focusReturn)) focusReturn.focus();
  focusReturn = null;
}

// ========== SERVICE WORKER ==========
// Registered late and guarded, because this is a genuinely optional layer: the
// app has to keep working from file:// (where registration throws) and over
// plain http on a LAN (where it's simply unavailable).
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // A failed registration costs nothing here — everything still runs from
      // the network. Not worth surfacing to the user.
    });
  });
}

// ========== START ==========
init();
