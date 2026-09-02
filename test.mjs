// ========== CHRONOS BEHAVIOURAL SUITE ==========
// Boots the real index.html + chronos.js under jsdom and asserts on the things
// this round of changes introduced, plus a fuzz pass over every control to
// catch anything the promotion table broke by accident.

import fs from 'fs';
import { JSDOM } from 'jsdom';
import * as csstree from 'css-tree';

let pass = 0, fail = 0;
const errs = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; }
  else { fail++; errs.push('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
};

// ---------- stubs ----------
// Everything chronos.js touches that jsdom doesn't implement. Each one is a
// no-op that returns the right shape, not a mock that asserts anything.
function installStubs(win) {
  win.matchMedia = q => ({
    matches: false, media: q,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, onchange: null
  });

  const node = () => ({
    connect() {}, disconnect() {}, start() {}, stop() {},
    frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
    Q: { value: 0 }, type: '', buffer: null, loop: false, detune: { value: 0 }
  });
  win.AudioContext = win.webkitAudioContext = class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = node(); this.state = 'running'; }
    createOscillator() { return node(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len, numberOfChannels: ch }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };

  win.HTMLCanvasElement.prototype.getContext = function () {
    const stub = new Proxy({}, {
      get: (t, k) => {
        if (k === 'canvas') return { width: 0, height: 0 };
        if (k === 'createLinearGradient' || k === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set: () => true
    });
    return stub;
  };

  win.indexedDB = {
    open: () => {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
      setTimeout(() => req.onerror && req.onerror({ target: req }), 0);
      return req;
    },
    deleteDatabase: () => ({})
  };

  win.navigator.wakeLock = { request: () => Promise.reject(new Error('stub')) };
  win.navigator.vibrate = () => true;
  win.navigator.serviceWorker = { register: () => Promise.resolve({}), controller: null };
  win.navigator.clipboard = { writeText: () => Promise.resolve() };
  win.Notification = class { static permission = 'default'; static requestPermission() { return Promise.resolve('denied'); } };
  win.URL.createObjectURL = () => 'blob:stub';
  win.URL.revokeObjectURL = () => {};
  win.document.fonts = { ready: Promise.resolve(), load: () => Promise.resolve(), check: () => true };
  win.scrollTo = () => {};
  win.alert = () => {};
  win.confirm = () => true;
  win.prompt = () => null;
  win.HTMLElement.prototype.scrollIntoView = () => {};
  win.HTMLMediaElement.prototype.play = () => Promise.resolve();
  win.HTMLMediaElement.prototype.pause = () => {};
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  if (!win.HTMLElement.prototype.setPointerCapture)
    win.HTMLElement.prototype.setPointerCapture = () => {};
  if (!win.HTMLElement.prototype.releasePointerCapture)
    win.HTMLElement.prototype.releasePointerCapture = () => {};
  // jsdom has no layout, so every getBoundingClientRect is zeroed. The dial
  // maths divides by width; give it a plausible box.
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 280, height: 280, top: 100, left: 100, right: 380, bottom: 380, x: 100, y: 100 };
  };
  Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', {
    get() { return this.parentElement; }, configurable: true
  });
}

// ---------- boot ----------
const css = fs.readFileSync('chronos.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('chronos.js', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://example.test/chronos/'
});
const win = dom.window, doc = win.document;
installStubs(win);

const uncaught = [];
win.addEventListener('error', e => uncaught.push(String(e.error || e.message)));

const BRIDGE = `
;window.__t = {
  get settings() { return settings; },
  get mode() { return mode; },
  set running(v) { running = v; },
  set elapsed(v) { elapsed = v; },
  get laps() { return laps; },
  set laps(v) { laps = v; },
  set lastLapTime(v) { lastLapTime = v; },
  get metroRunning() { return metroRunning; },
  set metroRunning(v) { metroRunning = v; },
  set metroStartTime(v) { metroStartTime = v; },
  get metroElapsed() { return metroElapsed; },
  set metroElapsed(v) { metroElapsed = v; },
  get metroTimer() { return metroTimer; },
  get timerDuration() { return timerDuration; },
  set timerDuration(v) { timerDuration = v; },
  get tapTimes() { return tapTimes; },
  set tapTimes(v) { tapTimes = v; },
  get history() { return history; },
  set history(v) { history = v; },
  get analytics() { return analytics; },
  metroPulseTier, metroPulsesPerMeasure, metroSecondsPerPulse,
  tapTempo, startMetro, stopMetro, updateMetroLabel, lapOrTap,
  paintMetroBeat, paintMetroLamps, sanitiseMetroPresets,
  recordLap, switchMode, apply, renderLaps, paintLamps, buildTicks,
  start, pause, reset, togglePlay, updateDisplay, a11yDial, save
};`;

let bootError = null;
try { win.eval(js + BRIDGE); } catch (e) { bootError = e; }

ok('chronos.js boots without throwing', !bootError, bootError && bootError.message);
if (bootError) { console.log(bootError.stack.split('\n').slice(0, 6).join('\n')); }

const $ = id => doc.getElementById(id);

// ---------- markup integrity ----------
const ids = [...doc.querySelectorAll('[id]')].map(e => e.id);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
ok('no duplicate element ids', dupes.length === 0, dupes.join(','));

// ---------- landmarks & metadata ----------
ok('has banner landmark', !!doc.querySelector('header[role="banner"]'));
ok('has main landmark', !!doc.querySelector('[role="main"]'));
ok('both asides are labelled',
  [...doc.querySelectorAll('aside')].every(a => a.getAttribute('aria-label')));
ok('skip link points at a real target',
  !!doc.querySelector('.skip-link') && !!$(doc.querySelector('.skip-link').getAttribute('href').slice(1)));
ok('meta description present', !!doc.querySelector('meta[name="description"]'));
ok('theme-color for both schemes', doc.querySelectorAll('meta[name="theme-color"]').length === 2);
ok('manifest linked', !!doc.querySelector('link[rel="manifest"]'));
ok('preconnects both font origins', doc.querySelectorAll('link[rel="preconnect"]').length === 2);

// ---------- every interactive control has an accessible name ----------
const unnamed = [...doc.querySelectorAll('button')].filter(b =>
  !b.getAttribute('aria-label') && !b.textContent.trim() && !b.getAttribute('aria-labelledby'));
ok('every button has an accessible name', unnamed.length === 0,
  unnamed.map(b => b.id || b.className).join(', '));

// ---------- promotion table ----------
const toggles = [...doc.querySelectorAll('.toggle')];
ok('toggles exist', toggles.length > 20, String(toggles.length));
ok('every toggle is role=switch', toggles.every(t => t.getAttribute('role') === 'switch'));
ok('every toggle is focusable', toggles.every(t => t.getAttribute('tabindex') === '0'));
ok('every toggle has aria-checked', toggles.every(t => t.hasAttribute('aria-checked')));
const unlabelled = toggles.filter(t => !t.getAttribute('aria-label'));
ok('every toggle has a label from its row', unlabelled.length === 0,
  unlabelled.map(t => t.id).join(', '));

ok('toggle labels exclude the .row-sub explainer',
  !toggles.some(t => (t.getAttribute('aria-label') || '').startsWith('Voice ControlOff')));

ok('theme grid is a radiogroup', $('themeGrid').getAttribute('role') === 'radiogroup');
ok('theme tiles are radios',
  [...doc.querySelectorAll('.theme-opt')].every(t => t.getAttribute('role') === 'radio'));
ok('clock tiles are checkboxes',
  [...doc.querySelectorAll('.clock-opt')].every(t => t.getAttribute('role') === 'checkbox'));
ok('sliders are tied to their labels',
  [...doc.querySelectorAll('.slider-row')].every(r => {
    const i = r.querySelector('.slider'), l = r.querySelector('label');
    return !i || !l || l.getAttribute('for') === i.id;
  }));

// ---------- state mirroring ----------
const dark = $('darkToggle');
const before = dark.getAttribute('aria-checked');
dark.click();
ok('aria-checked follows the toggle class',
  dark.getAttribute('aria-checked') !== before &&
  dark.getAttribute('aria-checked') === String(dark.classList.contains('active')));
dark.click();

const sel = doc.querySelector('.sel');
const head = sel.querySelector('.sel-head');
const expBefore = head.getAttribute('aria-expanded');
head.click();
ok('sel-head aria-expanded tracks .open',
  head.getAttribute('aria-expanded') !== expBefore ||
  head.getAttribute('aria-expanded') === String(sel.classList.contains('open')));

// ---------- tabs ----------
const tabs = [...doc.querySelectorAll('.mode-tab:not(.hidden)')];
const allTabs = [...doc.querySelectorAll('.mode-tab')];
ok('five tabs exist; only Clock ships hidden by default', allTabs.length === 5 && tabs.length === 4,
  allTabs.length + ' tabs, ' + tabs.length + ' visible');
ok('hidden tabs are out of the tab order and the a11y tree',
  allTabs.filter(t => t.classList.contains('hidden'))
         .every(t => t.tabIndex === -1 && t.getAttribute('aria-hidden') === 'true'));
ok('mode tabs are in a tablist', doc.querySelector('.mode-tabs').getAttribute('role') === 'tablist');
ok('mode tabs are role=tab', allTabs.every(t => t.getAttribute('role') === 'tab'));
tabs[1].click();
ok('aria-selected follows the active tab',
  tabs[1].getAttribute('aria-selected') === 'true' && tabs[0].getAttribute('aria-selected') === 'false');
tabs[0].click();

// ---------- the dial as a slider ----------
const dial = $('dial');
ok('dial is a slider', dial.getAttribute('role') === 'slider');
ok('dial is focusable', dial.getAttribute('tabindex') === '0');
ok('dial has a value range',
  dial.getAttribute('aria-valuemin') === '0' && dial.getAttribute('aria-valuemax') === '3600');

tabs[1].click(); // timer mode, so arrow keys set a duration
const key = (k, opts = {}) => dial.dispatchEvent(new win.KeyboardEvent('keydown',
  { key: k, bubbles: true, cancelable: true, ...opts }));
const v0 = +dial.getAttribute('aria-valuenow');
key('ArrowUp');
const v1 = +dial.getAttribute('aria-valuenow');
ok('ArrowUp adds a second', v1 === v0 + 1, v0 + ' -> ' + v1);
key('ArrowUp', { shiftKey: true });
ok('Shift+ArrowUp adds a minute', +dial.getAttribute('aria-valuenow') === v1 + 60);
key('Home');
ok('Home returns to zero', +dial.getAttribute('aria-valuenow') === 0);
key('End');
ok('End goes to the hour', +dial.getAttribute('aria-valuenow') === 3600);
key('Home');
ok('aria-valuetext is spoken, not digits',
  /second|minute|hour/.test(dial.getAttribute('aria-valuetext')),
  dial.getAttribute('aria-valuetext'));

// ---------- roving tabindex on the tablist ----------
ok('only the selected tab is in the tab order',
  tabs.filter(t => t.tabIndex === 0).length === 1,
  tabs.map(t => t.tabIndex).join(','));
tabs[0].focus();
doc.getElementById('modeTabs').dispatchEvent(
  new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
ok('ArrowRight moves along the tablist', tabs[1].getAttribute('aria-selected') === 'true');
tabs[0].click();

// ---------- sliders announce their units ----------
ok('sliders carry a value text with units',
  [...doc.querySelectorAll('.slider')].every(s => /[a-z%]/i.test(s.getAttribute('aria-valuetext') || '')),
  [...doc.querySelectorAll('.slider')].filter(s => !/[a-z%]/i.test(s.getAttribute('aria-valuetext') || '')).map(s => s.id).join(','));

// ---------- the split flash is gated and off by default ----------
ok('split flash toggle exists', !!$('splitToggle'));
ok('split flash is off by default', $('splitToggle').getAttribute('aria-checked') === 'false');
ok('the split overlay is hidden from the reader',
  $('splitDisplay').getAttribute('aria-hidden') === 'true');
{
  // Recording a lap with the toggle off must not surface the overlay.
  const t1 = allTabs.find(t => t.dataset.mode === 'stopwatch');
  t1.click();
  win.__t.running = true; win.__t.elapsed = 5000; win.__t.recordLap();
  ok('lap with split off leaves the dial face clean',
    !$('splitDisplay').classList.contains('show'));
  // ...and turning it on brings it back rather than deleting the feature.
  $('splitToggle').click();
  win.__t.elapsed = 9000; win.__t.recordLap();
  ok('lap with split on shows the overlay again',
    $('splitDisplay').classList.contains('show'));
  $('splitToggle').click();
  ok('turning it back off clears a flash already on screen',
    !$('splitDisplay').classList.contains('show'));
  win.__t.running = false; win.__t.elapsed = 0; win.__t.laps = []; win.__t.lastLapTime = 0; win.__t.renderLaps();
}

// ---------- clock mode drops the slider role ----------
{
  win.__t.settings.modes.clock = true; win.__t.apply();
  win.__t.switchMode('clock');
  ok('clock mode makes the dial a readout, not a control',
    dial.getAttribute('role') === 'img' && dial.tabIndex === -1,
    dial.getAttribute('role') + ' / ' + dial.tabIndex);
  const vBefore = dial.getAttribute('aria-valuenow');
  key('ArrowUp');
  ok('arrow keys do nothing in clock mode', dial.getAttribute('aria-valuenow') === vBefore);
  win.__t.switchMode('stopwatch');
  win.__t.settings.modes.clock = false; win.__t.apply();
  ok('leaving clock mode restores the slider role', dial.getAttribute('role') === 'slider');
}

// ---------- the three directions ----------
{
  const DIRECTIONS = ['bahnhof', 'safelight', 'paceclock', 'gnomon', 'vane', 'kymograph'];
  const tiles = [...doc.querySelectorAll('.theme-opt')].map(t => t.dataset.theme);
  ok('all three directions have a theme tile',
    DIRECTIONS.every(d => tiles.includes(d)), tiles.join(','));

  ok('every direction has a swatch class',
    DIRECTIONS.every(d => css.includes('.sw-' + d)));

  DIRECTIONS.forEach(d => {
    doc.querySelector('.theme-opt[data-theme="' + d + '"]').click();
    ok(d + ' applies its body class', doc.body.classList.contains('visual-' + d),
      doc.body.className);
    ok(d + ' declares a full palette override',
      ['--bg','--card','--border','--text','--text2','--accent','--font-ui','--font-mono','--font-display']
        .every(v => new RegExp('\\.visual-' + d + '\\s*\\{[^}]*' + v + '\\s*:').test(css)));
    ok(d + ' has a light-mode reading of its own',
      css.includes('.visual-' + d + '.light'));
  });

  // Fonts for all three directions must actually be requested.
  const fontLink = doc.querySelector('link[href*="fonts.googleapis.com/css2"]').getAttribute('href');
  ok('the new type families are loaded',
    ['IBM+Plex+Sans','IBM+Plex+Mono','Azeret+Mono','Barlow','Archivo','Doto',
     'Jost','Spline+Sans+Mono','Space+Grotesk','Oswald','Libre+Franklin']
      .every(f => fontLink.includes(f)),
    fontLink.slice(-90));
}

// ---------- the signature gate ----------
{
  ok('signature toggle exists and is on by default',
    !!$('signatureToggle') && $('signatureToggle').getAttribute('aria-checked') === 'true');
  ok('signature class is on the body', doc.body.classList.contains('signature'));
  $('signatureToggle').click();
  ok('turning the signature off drops the class', !doc.body.classList.contains('signature'));
  ok('but the direction itself survives', doc.body.className.includes('visual-'));
  $('signatureToggle').click();
  ok('and it comes back', doc.body.classList.contains('signature'));
}

// ---------- the 60-lamp ring ----------
{
  doc.querySelector('.theme-opt[data-theme="paceclock"]').click();
  const ticks = () => [...doc.getElementById('ticks').children];
  ok('sixty lamps are rendered', ticks().length === 60, String(ticks().length));
  win.__t.paintLamps(0);
  ok('zero progress lights nothing', ticks().filter(t => t.classList.contains('lit')).length === 0);
  win.__t.paintLamps(0.5);
  ok('half progress lights thirty lamps',
    ticks().filter(t => t.classList.contains('lit')).length === 30,
    String(ticks().filter(t => t.classList.contains('lit')).length));
  win.__t.paintLamps(1);
  ok('full progress lights all sixty',
    ticks().filter(t => t.classList.contains('lit')).length === 60);
  // The first lamp must be at twelve o'clock, not at three where the ticks start.
  win.__t.paintLamps(1 / 60);
  const lit = ticks().findIndex(t => t.classList.contains('lit'));
  // Tick 0 is visually at twelve because .ring-svg is rotated -90deg.
  ok('the first lamp sits at twelve o\'clock', lit === 0, 'index ' + lit);
  // Rebuilding ticks wipes the classes; the cache must not think it's current.
  win.__t.paintLamps(0.5);
  win.__t.buildTicks();
  win.__t.paintLamps(0.5);
  ok('rebuilding the ticks does not leave the lamps stale',
    ticks().filter(t => t.classList.contains('lit')).length === 30,
    String(ticks().filter(t => t.classList.contains('lit')).length));
  doc.querySelector('.theme-opt[data-theme="default"]').click();
}

// ---------- Bahnhof contrast: the paper palette must ride .light ----------
{
  doc.querySelector('.theme-opt[data-theme="bahnhof"]').click();
  // Picking a theme no longer touches the dark setting, so which reading you
  // land in is whatever the user already had. What still has to hold is that
  // each reading is internally correct.
  // The paper tokens must be declared on the .light compound, not the bare
  // class — 37 component rules and a stack of color:#fff depend on .light
  // being present whenever the background is light.
  const bare = /\.visual-bahnhof\s*\{[^}]*--bg:\s*(#[0-9A-Fa-f]{6})/.exec(css);
  const lit = /\.visual-bahnhof\.light\s*\{[^}]*--bg:\s*(#[0-9A-Fa-f]{6})/.exec(css);
  const lum = h => {
    const v = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
  };
  ok('Bahnhof dark-mode background is actually dark', bare && lum(bare[1]) < 0.3,
    bare && bare[1]);
  ok('Bahnhof light-mode background is the paper stock', lit && lum(lit[1]) > 0.8,
    lit && lit[1]);
  ok('Bahnhof takes back the active tab colour the base sheet whitens',
    /\.visual-bahnhof \.mode-tab\.active\s*\{[^}]*color:\s*var\(--text\)/.test(css));
  doc.querySelector('.theme-opt[data-theme="default"]').click();
}

// ---------- ticks, numerals and the ring are independent ----------
{
  ok('ticks have their own toggle', !!$('ticksToggle'));
  ok('numerals have their own toggle', !!$('numeralsToggle'));

  // Turning the ring off must no longer take the ticks with it.
  $('ringToggle').click();
  ok('hiding the ring leaves the ticks alone',
    $('ringProgress').classList.contains('hidden') && !$('ticks').classList.contains('hidden'));
  $('ringToggle').click();

  $('ticksToggle').click();
  ok('hiding the ticks leaves the ring alone',
    $('ticks').classList.contains('hidden') && !$('ringProgress').classList.contains('hidden'));
  $('ticksToggle').click();

  ok('numerals are off by default', $('numerals').classList.contains('hidden'));
  ok('the numeral style row is collapsed while numerals are off',
    !$('numeralsDep').classList.contains('open'));

  $('numeralsToggle').click();
  ok('turning numerals on opens the style row', $('numeralsDep').classList.contains('open'));
  const texts = () => [...$('numerals').querySelectorAll('text')];
  ok('quarters draws four numerals', texts().length === 4, String(texts().length));
  ok('twelve is at the top of the face', texts()[0].textContent === '12');
  // Every glyph is counter-rotated so it stands up inside the rotated SVG.
  ok('numerals are counter-rotated to read upright',
    texts().every(t => /rotate\(90 /.test(t.getAttribute('transform'))));

  doc.querySelector('#numeralSeg .seg-btn[data-numerals="all"]').click();
  ok('the 12 style draws twelve numerals', texts().length === 12, String(texts().length));
  doc.querySelector('#numeralSeg .seg-btn[data-numerals="minutes"]').click();
  ok('the 60 style draws minute numbers', texts().length === 12 && texts()[1].textContent === '5');
  doc.querySelector('#numeralSeg .seg-btn[data-numerals="quarters"]').click();
  $('numeralsToggle').click();
  ok('turning numerals off clears them', $('numerals').innerHTML === '');
}

// ---------- no unguarded white text on light surfaces ----------
// The Bahnhof white-on-white came from a literal rgba(255,255,255,.5) that only
// worked because the base theme is dark. A hardcoded white is only safe when it
// sits on the accent fill; anywhere else it has to derive from --text.
{
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const WHITE = /color:\s*(#fff\b|#ffffff\b|rgba\(\s*255,\s*255,\s*255)/i;
  // Selectors whose background is var(--accent), where white text is correct.
  const ON_ACCENT = /\.(active|is-active)\b|:hover|\.primary\b/;
  const bad = [];
  for (const [, sel, body] of rules) {
    const s2 = sel.trim();
    if (!s2 || s2.startsWith('@')) continue;
    for (const decl of body.split(';')) {
      const d = decl.trim();
      if (!/^color\s*:/i.test(d) || !WHITE.test(d)) continue;
      if (ON_ACCENT.test(s2)) continue;
      if (/^\.visual-/.test(s2)) continue;   // a direction may own its own value
      bad.push(s2.split(',')[0].trim());
    }
  }
  ok('no unguarded literal-white text outside accent fills', bad.length === 0, bad.join(' | '));
}

// ---------- every direction resolves text against its own surface ----------
{
  // Not a contrast calculation — just that neither token is left at a literal
  // white while the other is also light, which is the shape of the bug.
  const near = h => {
    const v = h.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map(x => x + x).join('') : v, 16);
    return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
  };
  ['bahnhof', 'safelight', 'paceclock'].forEach(d => {
    [['', 'dark'], ['.light', 'light']].forEach(([suffix, label]) => {
      const m = css.match(new RegExp('\\.visual-' + d + suffix + '\\s*\\{([^}]*)\\}'));
      if (!m) return;
      const bg = (m[1].match(/--bg:\s*(#[0-9a-f]{3,8})/i) || [])[1];
      const tx = (m[1].match(/--text:\s*(#[0-9a-f]{3,8})/i) || [])[1];
      if (!bg || !tx) return;
      ok(d + ' ' + label + ' separates text from background',
        Math.abs(near(bg) - near(tx)) > 80, bg + ' vs ' + tx);
    });
  });
}

// ---------- default settings should look right untouched ----------
{
  const slider = $('dialSizeSlider');
  ok('the dial size default sits inside the slider range',
    +slider.value >= +slider.min && +slider.value <= +slider.max,
    slider.min + '-' + slider.max + ' value ' + slider.value);
  ok('the readout is proportionally smaller than the dial',
    /--dial-d\) \* 0\.1[0-9]+ \* var\(--clock-scale\)/.test(css));
}

// ---------- every dependent group collapses to nothing ----------
{
  // numeralsDep shipped without the .dep-in wrapper, so grid-template-rows:0fr
  // had no overflow:hidden child to collapse into and left a blank row behind.
  const deps = [...doc.querySelectorAll('.dep')];
  ok('there are dependent groups to check', deps.length >= 5, String(deps.length));
  const noWrap = deps.filter(d => !d.querySelector(':scope > .dep-in'));
  ok('every .dep has a .dep-in wrapper', noWrap.length === 0, noWrap.map(d => d.id).join(','));
  const alsoRow = deps.filter(d => d.classList.contains('setting-row'));
  ok('no .dep is also a .setting-row', alsoRow.length === 0, alsoRow.map(d => d.id).join(','));
}

// ---------- no two setting rows share an icon within a section ----------
{
  const dupes = [];
  doc.querySelectorAll('.panel-section').forEach(sec => {
    const seen = {};
    sec.querySelectorAll('.row-ico[data-ico]').forEach(i => {
      const k = i.dataset.ico;
      if (seen[k]) dupes.push((sec.id || '?') + ':' + k);
      seen[k] = 1;
    });
  });
  ok('setting rows in a section do not reuse an icon', dupes.length === 0, dupes.join(' | '));
}

// ---------- every theme has a signature ----------
{
  const themes = [...doc.querySelectorAll('.theme-opt')].map(t => t.dataset.theme);
  const missing = themes.filter(t =>
    t !== 'default' && !new RegExp('\\.visual-' + t + '[.\\s][^{]*\\.signature|\\.visual-' + t + '\\.signature').test(css));
  ok('every theme has a gated signature', missing.length === 0, missing.join(', '));
  ok('the default theme has one too', /visual-\"\]\)\.signature|:not\(\[class\*="visual-"\]\)\.signature/.test(css));
}

// ---------- picking a theme must not move the dark/light setting ----------
{
  const jsSrc = fs.readFileSync('chronos.js', 'utf8');
  ok('no theme rewrites the dark preference', !/THEME_PREF/.test(jsSrc));
  const wasDark = win.__t.settings.dark;
  doc.querySelector('.theme-opt[data-theme="bahnhof"]').click();
  ok('selecting Bahnhof leaves dark mode alone',
    win.__t.settings.dark === wasDark, 'was ' + wasDark + ', now ' + win.__t.settings.dark);
  doc.querySelector('.theme-opt[data-theme="default"]').click();
  ok('and so does switching back', win.__t.settings.dark === wasDark);
}

// ---------- every data-ico names a real icon ----------
{
  const jsSrc = fs.readFileSync('chronos.js', 'utf8');
  const map = jsSrc.match(/const ICONS = \{([\s\S]*?)\n\};/);
  const names = [...map[1].matchAll(/^\s{2}([a-zA-Z0-9]+)\s*:/gm)].map(m => m[1]);
  const used = [...new Set([...doc.querySelectorAll('[data-ico]')].map(e => e.dataset.ico))];
  const missing = used.filter(u => !names.includes(u));
  ok('no data-ico points at an icon that does not exist', missing.length === 0, missing.join(', '));
}

// ---------- the theme-swap class actually does something ----------
{
  ok('body.theme-swap has rules behind it', /body\.theme-swap/.test(css));
  // Strip comments first — the rule carries a note explaining why box-shadow
  // was removed, and matching on that would be the test reading its own excuse.
  const universal = ((css.match(/\n\* \{([^}]*)\}/) || [])[1] || '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the universal transition does not animate box-shadow',
    !/box-shadow/.test(universal), universal.slice(-90).replace(/\s+/g, ' '));
}

// ---------- Minimal covers the Focus On card ----------
{
  const block = css.match(/\.visual-minimal[^{]*\.tag-card[^{]*\{[^}]*\}/g) || [];
  ok('Minimal restyles the Focus On card', block.length > 0);
  ok('...and flattens it like the rest of its chrome',
    block.join(' ').includes('border-radius: 0'));
}

// ---------- the mode tab row survives a fourth tab ----------
{
  ok('mode tabs never wrap their label',
    /\.mode-tab \{[^}]*white-space:\s*nowrap/.test(css));

  // apply() has to publish the live count, or the CSS can't know how many
  // tabs are on screen — settings.modes isn't visible to a stylesheet.
  // Metronome ships enabled by default (unlike Clock), so the true three-tab
  // baseline needs both switched off explicitly.
  const row = $('modeTabs');
  win.__t.settings.modes.clock = false; win.__t.settings.modes.metronome = false; win.__t.apply();
  ok('the row reports three tabs with Clock and Metronome both off', row.dataset.tabs === '3', row.dataset.tabs);
  win.__t.settings.modes.clock = true; win.__t.apply();
  ok('enabling Clock on top makes it four', row.dataset.tabs === '4', row.dataset.tabs);
  win.__t.settings.modes.metronome = true; win.__t.apply();
  ok('enabling Metronome too makes it five', row.dataset.tabs === '5', row.dataset.tabs);
  ok('a four-tab rule exists to tighten the padding',
    /\.mode-tabs\[data-tabs="4"\]/.test(css));
  ok('a five-tab rule exists too', /\.mode-tabs\[data-tabs="5"\]/.test(css));
  ok('and a narrow-screen fallback scrolls rather than wrapping',
    /\.mode-tabs\[data-tabs="4"\][^{]*\{[^}]*overflow-x:\s*auto/.test(css) &&
    /\.mode-tabs\[data-tabs="5"\][\s\S]{0,120}overflow-x:\s*auto|data-tabs="5"\][^{]*,[\s\S]{0,80}overflow-x:\s*auto/.test(css));

  // Switching to a hidden-then-shown mode must still place the indicator.
  win.__t.switchMode('clock');
  ok('the clock tab can be selected once enabled',
    doc.querySelector('.mode-tab[data-mode="clock"]').getAttribute('aria-selected') === 'true');
  win.__t.switchMode('stopwatch');
  win.__t.settings.modes.clock = false; win.__t.settings.modes.metronome = false; win.__t.apply();
  ok('and turning both back off returns the row to three', row.dataset.tabs === '3');
  win.__t.settings.modes.metronome = true; win.__t.apply();   // restore the default for later tests
}

// ---------- round two signatures (rebuilt to match the mockups) ----------
{
  const jsSrc = fs.readFileSync('chronos.js', 'utf8');

  // Vane: the split-flap cards are the existing per-digit spans, restyled —
  // no second digit pipeline, no markup change. The fall still rides the
  // .roll class updateDisplay() already applies; if that class stops being
  // set, the flap silently dies, so pin both ends of the dependency.
  ok('updateDisplay still tags changed digits with .roll',
    /classList\.add\('roll'\)/.test(jsSrc));
  ok('Vane turns each digit span into a physical flap card',
    /\.visual-vane\.signature \.time \.dg \{[^}]*background:\s*var\(--card\)/.test(css));
  ok('...with a hinge rule across it',
    /\.visual-vane\.signature \.time \.dg::after/.test(css));
  ok('...and redefines the roll animation as a fall',
    /\.visual-vane\.signature \.time \.dg\.roll/.test(css) && /@keyframes vane-flap/.test(css));
  ok('the flap duration is a named exception, not a magic number',
    /--t-flap:\s*120ms/.test(css) && /animation: vane-flap var\(--t-flap\)/.test(css));
  ok('Vane replaces the icon transport buttons with labelled plates',
    /\.visual-vane #resetBtn::after \{ content: 'Reset'/.test(css));

  // Kymograph: the grid is anchored to the viewport (body), not to individual
  // cards, or it restarts at every panel edge instead of reading as one sheet.
  ok('the Kymograph grid lives on body, not per-card',
    /body\.visual-kymograph \{[\s\S]{0,300}background-attachment:\s*fixed/.test(css));
  ok('...and coarsens rather than vanishing on a narrow screen',
    /max-width:\s*460px\)\s*\{\s*\.visual-kymograph \{ --grid-pitch: 16px/.test(css));
  ok('Kymograph has a literal stylus: a pin and an arm on the dial',
    /\.visual-kymograph\.signature \.dial::before/.test(css) &&
    /\.visual-kymograph\.signature \.dial::after/.test(css));
  ok('Kymograph frames the viewport like an instrument bezel',
    /\.visual-kymograph::before \{[\s\S]{0,200}border:\s*3px solid var\(--text\)/.test(css));

  // Gnomon: the blade is a real clipped triangle, not a diffuse glow, and the
  // arc underneath it is never allowed to fade — that's the accessible signal.
  ok('Gnomon casts a real triangular blade, not a blur-only haze',
    /\.visual-gnomon\.signature \.dial::before \{[\s\S]{0,300}clip-path:\s*polygon/.test(css));
  ok('Gnomon keeps a solid arc under the shadow',
    /\.visual-gnomon \.ring-progress \{[^}]*opacity:\s*1/.test(css));
  ok('Gnomon moves the readout down onto the blade\'s base as its signature',
    /\.visual-gnomon\.signature \.time,[\s\S]{0,200}transform:\s*translateY/.test(css));
  ok('Gnomon replaces the icon transport buttons with labelled pills',
    /\.visual-gnomon\.time \.sep|visual-gnomon \.ctrl-btn/.test(css));

  // All three animated signatures respect the motion setting.
  ok('round two signatures honour reduced motion',
    /motion-none[^{]*visual-kymograph\.signature \.dial::before/.test(css) &&
    /prefers-reduced-motion[\s\S]{0,500}visual-vane\.signature/.test(css));
}

// ---------- every icon-hiding theme keeps the reset-spin feedback ----------
// resetSpin targets .ctrl-btn.spun svg. Any theme that hides that svg to show
// a text label instead has to supply a substitute, or reset silently loses its
// click feedback in that theme — exactly the bug this check exists to catch.
{
  const iconHidingThemes = [...css.matchAll(/\.(visual-[a-z]+) \.ctrl-btn svg \{ display: none/g)]
    .map(m => m[1]);
  ok('at least the three text-button themes hide the icon', iconHidingThemes.length >= 3,
    iconHidingThemes.join(', '));
  const missing = iconHidingThemes.filter(t =>
    !new RegExp('\\.' + t + ' \\.ctrl-btn\\.spun[,\\s]').test(css) &&
    !new RegExp('\\.' + t + ' \\.ctrl-btn\\.spun \\{').test(css));
  ok('every one of them supplies a substitute for the hidden spin',
    missing.length === 0, missing.join(', '));
}

// ---------- state-change transitions actually have somewhere to run ----------
// A rule that changes box-shadow or opacity on a state selector (:hover,
// .active, .signature, etc.) needs a transition declared SOMEWHERE on one of
// its own selector tokens — the shorthand, transition-property, or `all` all
// count. This is exactly the shape of bug that made the reset-spin issue and
// a handful of focus rings snap instead of ease after the universal `*`
// transition was scoped down to colour-only. Static, not rendered — it can't
// tell whether a snap is a big deal, only that the transition path is absent.
{
  const ast = csstree.parse(css, { positions: true });
  const rules = [];
  csstree.walk(ast, node => {
    if (node.type === 'Rule') {
      const sel = csstree.generate(node.prelude);
      const decls = {};
      node.block.children.forEach(d => {
        if (d.type !== 'Declaration' || !d.value) return;
        try { decls[d.property] = (decls[d.property] ? decls[d.property] + ' ' : '') + csstree.generate(d.value); } catch (e) {}
      });
      rules.push({ sel, decls });
    }
  });
  const transitionsByToken = {};
  for (const r of rules) {
    const combined = (r.decls['transition'] || '') + ' ' + (r.decls['transition-property'] || '');
    if (!combined.trim()) continue;
    for (const t of [...r.sel.matchAll(/[.#][a-zA-Z0-9_-]+/g)].map(m => m[0]))
      transitionsByToken[t] = (transitionsByToken[t] || '') + ' ' + combined;
  }
  const covers = (val, prop) => /\ball\b/.test(val) || val.includes(prop);
  const STATE = /(:hover|:active|:focus|\.active\b|\.open\b|\.running\b|\.checked\b|\.is-active\b|\.primary\b|\.lit\b|\.signature\b|\.selected\b|\.roll\b|\.recording\b)/;
  // Known, deliberately-accepted gaps: theme-specific static values that only
  // ever pop on a theme switch (already a wholesale visual change), not during
  // normal interaction. Documented here so a NEW gap can't hide among them.
  const ACCEPTED = new Set([
    '.visual-glass.signature::before',
    '.visual-paceclock.signature .tick',
    '.visual-minimal.signature .tick:first-child',
    '.visual-vane.signature .time .dg',
    '.visual-vane.signature .time .sep',
    '.shortcut-input:focus,.shortcut-input.recording',
    '.time-input:focus,.shortcut-input:focus,.tag-input:focus,.quote-input:focus'
  ]);
  let unexplained = [];
  for (const r of rules) {
    if (!STATE.test(r.sel)) continue;
    if (!('box-shadow' in r.decls) && !('opacity' in r.decls)) continue;
    const tokens = [...r.sel.matchAll(/[.#][a-zA-Z0-9_-]+/g)].map(m => m[0]);
    let coversBS = false, coversOp = false;
    for (const t of tokens) {
      const val = transitionsByToken[t] || '';
      if (covers(val, 'box-shadow')) coversBS = true;
      if (covers(val, 'opacity')) coversOp = true;
    }
    const needsBS = 'box-shadow' in r.decls, needsOp = 'opacity' in r.decls;
    if ((needsBS && !coversBS) || (needsOp && !coversOp)) {
      const key = r.sel.replace(/\s+/g, '');
      if (![...ACCEPTED].some(a => key.includes(a.replace(/\s+/g, '')))) unexplained.push(r.sel.slice(0, 60));
    }
  }
  ok('no new state-change transition gaps beyond the documented, accepted ones',
    unexplained.length === 0, unexplained.join(' | '));
}

// ---------- text-button themes: Play/Pause matches Reset/Lap ----------
// The base .ctrl-btn.primary rule sizes its font for a 72px icon (24px) and
// adds an accent glow — both meant for the default circular buttons. Any theme
// that turns .ctrl-btn into a flat text button has to explicitly override both
// on .primary too, or Play/Pause silently inherits mismatched sizing while
// Reset/Lap don't.
{
  const textButtonThemes = [...css.matchAll(/\.(visual-[a-z]+) \.ctrl-btn svg \{ display: none/g)].map(m => m[1]);
  for (const th of textButtonThemes) {
    const base = new RegExp('\\.' + th + ' \\.ctrl-btn \\{([\\s\\S]*?)\\}');
    const primary = new RegExp('\\.' + th + ' \\.ctrl-btn\\.primary \\{([\\s\\S]*?)\\}');
    const baseFont = (css.match(base) || [])[1] || '';
    const primFont = (css.match(primary) || [])[1] || '';
    ok(th + ' sets its own font-size on .ctrl-btn (a baseline to match)',
      /font-size/.test(baseFont), th);
    ok(th + ' explicitly sets font-size on .primary too, not inherited from the base component',
      /font-size/.test(primFont), th);
    ok(th + ' explicitly resets box-shadow on .primary, not inheriting the base accent glow',
      /box-shadow:\s*none/.test(primFont), th);
  }
  ok('at least the three text-button themes were checked', textButtonThemes.length >= 3);
}

// ---------- every text-button theme fully commits to its own button material ----------
// Vane's Reset/Lap buttons had no background or border of their own, so they
// fell through to the generic, theme-agnostic chip fill shared by every other
// theme instead of Vane's own cabinet-plate look — while Gnomon (bordered
// outline) and Kymograph (filled plate) were both fully themed. That mismatch
// is what read as "not as uniform as the other themes." Pinned per theme so a
// future button treatment can't be added half-finished the same way.
{
  ['gnomon', 'vane', 'kymograph'].forEach(th => {
    const m = css.match(new RegExp('\\.visual-' + th + ' \\.ctrl-btn \\{([^}]*)\\}'));
    ok(th + ' ctrl-btn rule exists', !!m);
    if (!m) return;
    const body = m[1];
    ok(th + ' sets its own background (or is deliberately transparent)',
      /background\s*:/.test(body), body.slice(0, 40));
  });
}

// ---------- round two: accessible names survive the icon-to-text swap ----------
{
  ['gnomon', 'vane', 'kymograph'].forEach(d => {
    doc.querySelector('.theme-opt[data-theme="' + d + '"]').click();
    ok(d + ' keeps aria-label on the transport buttons with icons hidden',
      $('resetBtn').getAttribute('aria-label') === 'Reset' &&
      $('lapBtn').getAttribute('aria-label') === 'Record lap' &&
      !!$('playBtn').getAttribute('aria-label'));
  });
  doc.querySelector('.theme-opt[data-theme="default"]').click();
}

// ---------- METRONOME ----------
{
  const T = win.__t;

  // ----- pure pulse math -----
  T.settings.metronome.num = 4; T.settings.metronome.den = 4;
  T.settings.metronome.subdivision = 1; T.settings.metronome.bpm = 120;
  ok('pulse 0 is always the accent', T.metroPulseTier(0) === 'accent');
  ok('with no subdivision every other pulse is a beat',
    T.metroPulseTier(1) === 'beat' && T.metroPulseTier(2) === 'beat');
  ok('4/4 with no subdivision has four pulses per measure', T.metroPulsesPerMeasure() === 4);
  T.settings.metronome.subdivision = 2;
  ok('subdivision 2 makes odd pulses "sub"',
    T.metroPulseTier(1) === 'sub' && T.metroPulseTier(2) === 'beat' && T.metroPulseTier(3) === 'sub');
  ok('subdivision doubles the pulses per measure', T.metroPulsesPerMeasure() === 8);
  T.settings.metronome.num = 6; T.settings.metronome.den = 8; T.settings.metronome.subdivision = 1;
  ok('compound meters need no special-casing — 6/8 is just six beat pulses',
    T.metroPulsesPerMeasure() === 6 &&
    [0, 1, 2, 3, 4, 5].every(i => T.metroPulseTier(i) === (i === 0 ? 'accent' : 'beat')));
  T.settings.metronome.bpm = 120; T.settings.metronome.subdivision = 1;
  ok('120 BPM with no subdivision is half a second per pulse',
    Math.abs(T.metroSecondsPerPulse() - 0.5) < 1e-9);
  T.settings.metronome.subdivision = 2;
  ok('a subdivision halves the time between pulses, not the tempo',
    Math.abs(T.metroSecondsPerPulse() - 0.25) < 1e-9);
  T.settings.metronome.num = 4; T.settings.metronome.den = 4; T.settings.metronome.subdivision = 1;

  // ----- the main screen stays tidy -----
  // Signature chips, the custom numerator/denominator fields, and the
  // subdivision/sound controls all moved off the dial screen entirely —
  // tempo and signature are set from the dial or a preset, subdivision and
  // sound live in Settings. Nothing metronome-specific should still be
  // sitting in the main control area.
  ok('the old inline signature-chip cluster is gone', !doc.querySelector('.metro-sig-chip'));
  ok('the old inline custom-signature fields are gone', !$('metroCustomNum') && !$('metroCustomSig'));
  ok('subdivision now lives in Settings, not on the dial screen',
    !!$('metroSubSeg') && !!$('metroSubSeg').closest('.panel-section'));
  ok('the sound toggle now lives in Settings too',
    !!$('metroSoundToggle') && !!$('metroSoundToggle').closest('.panel-section'));
  ok('Settings has its own Metronome section',
    [...doc.querySelectorAll('.panel-section h3')].some(h => h.textContent.trim() === 'Metronome'));

  // ----- entering the mode -----
  T.switchMode('metronome');
  ok('the dial drops its normal duration role for a tempo slider',
    !$('dial').getAttribute('aria-label').startsWith('Duration') &&
    $('dial').getAttribute('aria-label').toLowerCase().includes('tempo'));
  ok('aria-valuemin/max cover the real BPM range', $('dial').getAttribute('aria-valuemin') === '30' &&
    $('dial').getAttribute('aria-valuemax') === '300');
  ok('the ring adopts metro-mode, hiding the normal progress arc',
    $('dial').classList.contains('metro-mode'));
  ok('the tempo/signature presets are shown in the rail', !$('metroPresets').classList.contains('hidden'));
  // Toggling a class only matters if CSS actually reacts to it — jsdom has no
  // layout engine to catch a missing .metro-presets.hidden rule by itself, so
  // this checks the class state across every OTHER mode too, and the static
  // CSS block below checks the rule that makes the class mean something
  // actually exists.
  ['stopwatch', 'timer', 'pomodoro', 'clock'].forEach(m => {
    T.switchMode(m);
    ok(m + ' mode hides the metronome preset rail',
      $('metroPresets').classList.contains('hidden'), m);
  });
  T.switchMode('metronome');
  ok('Timer presets and the laps rail both stay hidden',
    $('presets').classList.contains('hidden') && $('lapsContainer').classList.contains('hidden'));
  ok('the time label reads the signature, not a generic mode name',
    $('timeLabel').textContent === '4/4');
  ok('the readout shows BPM through the ordinary digit pipeline',
    $('timeDisplay').textContent === '120');

  // ----- Lap becomes Tap -----
  ok('the Lap button repaints as Tap entering metronome mode',
    $('lapBtn').dataset.ico === 'tap' && $('lapBtn').getAttribute('aria-label') === 'Tap tempo');

  // ----- independent play-state -----
  ok('metronome starts stopped', !T.metroRunning);
  T.start();
  ok('start() flips metroRunning, not the shared running flag',
    T.metroRunning === true);
  ok('a scheduler interval exists once started', T.metroTimer !== null);
  ok('the play button reflects metroRunning while on this tab',
    $('playBtn').getAttribute('aria-label') === 'Pause');

  // The whole point of background click-along: switching to another mode
  // must not touch metroRunning, and that other mode's own running state is
  // untouched by ever having had the metronome on.
  T.switchMode('pomodoro');
  ok('leaving the metronome tab while it plays leaves metroRunning true',
    T.metroRunning === true);
  ok('a scheduler interval is still alive in the background', T.metroTimer !== null);
  ok('the OTHER mode is not accidentally marked running',
    T.mode === 'pomodoro' && doc.body.classList.contains('running') === false);
  T.switchMode('metronome');
  ok('coming back finds the click still going, still reflected in the UI',
    T.metroRunning === true && $('playBtn').getAttribute('aria-label') === 'Pause');

  // pause() must actually silence it.
  T.pause();
  ok('pause() stops metroRunning', T.metroRunning === false);
  ok('and clears the scheduler interval', T.metroTimer === null);
  ok('the play button flips back to Start', $('playBtn').getAttribute('aria-label') === 'Start');

  // reset() rewinds position but must never touch the user's tempo/signature.
  T.settings.metronome.bpm = 140; T.settings.metronome.num = 3; T.settings.metronome.den = 4;
  T.reset();
  ok('reset in metronome mode leaves BPM alone', T.settings.metronome.bpm === 140);
  ok('reset in metronome mode leaves the time signature alone',
    T.settings.metronome.num === 3 && T.settings.metronome.den === 4);
  T.settings.metronome.num = 4; T.settings.metronome.den = 4; T.settings.metronome.bpm = 120;
  T.apply();

  // togglePlay() must consult metroRunning, not the shared flag, when deciding.
  T.togglePlay();
  ok('togglePlay starts the metronome from stopped', T.metroRunning === true);
  T.togglePlay();
  ok('togglePlay stops it again', T.metroRunning === false);

  // ----- session logging -----
  T.history = []; T.analytics.sessions = 0; T.analytics.focus = 0; T.analytics.lastDate = '';
  T.metroStartTime = Date.now() - 200; // under 5s — should not log
  T.metroRunning = true;
  T.pause();
  ok('a too-short tap does not get logged as a practice session', T.history.length === 0);
  T.metroStartTime = Date.now() - 8000; // over the 5s floor
  T.metroRunning = true;
  T.pause();
  ok('a real practice segment gets logged', T.history.length === 1 &&
    T.history[0].type === 'metronome', JSON.stringify(T.history));
  ok('the logged tag carries the signature and tempo',
    T.history[0].tag.includes('4/4') && T.history[0].tag.includes('120'));
  ok('practice time counts toward the daily focus total, same as any mode',
    T.analytics.focus >= 8);

  // ----- Lap/Tap redirect -----
  T.laps = []; T.tapTimes = [];
  T.lapOrTap();
  ok('the reused Lap button taps tempo in metronome mode, not a lap',
    T.laps.length === 0 && T.tapTimes.length === 1);
  T.switchMode('stopwatch');
  T.running = true; T.elapsed = 5000;
  T.lapOrTap();
  ok('...and still records a real lap everywhere else', T.laps.length === 1);
  T.running = false; T.elapsed = 0; T.laps = [];
  T.switchMode('metronome');

  // tap tempo itself: tapTempo() always reads a fresh performance.now() for
  // the tap that's happening right now — it can't be handed two timestamps
  // and told to trust them both. So the first real tap is taken normally,
  // then backdated by exactly 500ms to stand in for "the previous tap landed
  // half a second ago," and the second real tap measures the gap against that.
  T.tapTimes = [];
  T.tapTempo();
  T.tapTimes[0] -= 500;
  T.tapTempo();
  ok('two taps ~500ms apart land near 120 BPM', Math.abs(T.settings.metronome.bpm - 120) <= 3,
    T.settings.metronome.bpm);
  T.settings.metronome.bpm = 120; T.apply();

  // ----- dial keyboard control sets BPM, not duration -----
  T.metroRunning = false;
  const dial = $('dial');
  const before = T.settings.metronome.bpm;
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  ok('ArrowUp on the dial raises BPM by one in metronome mode',
    T.settings.metronome.bpm === before + 1, before + ' -> ' + T.settings.metronome.bpm);
  T.timerDuration = 777000;
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  ok("the old bug is gone: adjusting tempo does not touch Timer's saved duration",
    T.timerDuration === 777000);
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  ok('End sets the ceiling of the real range', T.settings.metronome.bpm === 300);
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  ok('Home sets the floor of the real range', T.settings.metronome.bpm === 30);
  T.settings.metronome.bpm = 120; T.apply();

  // Dial control must lock out while playing, same contract as duration modes.
  T.metroRunning = true; T.apply();
  const lockedBpm = T.settings.metronome.bpm;
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  ok('the dial ignores keyboard input while the metronome is playing',
    T.settings.metronome.bpm === lockedBpm);
  T.metroRunning = false; T.apply();

  // ----- subdivision / sound controls, now in Settings -----
  doc.querySelector('#metroSubSeg .seg-btn[data-sub="3"]').click();
  ok('the subdivision control (in Settings) sets triplets', T.settings.metronome.subdivision === 3);
  ok('its active state reflects the choice',
    doc.querySelector('#metroSubSeg .seg-btn[data-sub="3"]').classList.contains('is-active'));
  ok('changing subdivision does not touch tempo or signature',
    T.settings.metronome.bpm === 120 && T.settings.metronome.num === 4);
  doc.querySelector('#metroSubSeg .seg-btn[data-sub="1"]').click();

  const soundBefore = T.settings.metronome.distinctSounds;
  $('metroSoundToggle').click();
  ok('the distinct-sounds toggle (in Settings) actually flips the setting',
    T.settings.metronome.distinctSounds === !soundBefore);
  $('metroSoundToggle').click();

  // ----- preset list: select, add, remove — mirroring Timer's own presets -----
  ok('metronome presets ship with a default set, same idea as Largo/Adagio/etc',
    T.settings.metronomePresets.length >= 5);
  const presetCountStart = T.settings.metronomePresets.length;
  const firstMark = doc.querySelector('.metro-mark');
  ok('a preset button carries a name, tempo, and signature', /\d+\s*·\s*\d+\/\d+/.test(firstMark.textContent));

  firstMark.click();
  const p0 = T.settings.metronomePresets[0];
  ok('clicking a preset loads its bpm and signature onto the live metronome',
    T.settings.metronome.bpm === p0.bpm && T.settings.metronome.num === p0.num &&
    T.settings.metronome.den === p0.den);
  ok('the label updates to match the loaded signature',
    $('timeLabel').textContent === p0.num + '/' + p0.den);
  T.settings.metronome.bpm = 120; T.settings.metronome.num = 4; T.settings.metronome.den = 4; T.apply();

  // Add: three chained prompts (name, bpm, signature), same shape as Timer's
  // single MM:SS prompt, just one field per prompt instead of one field total.
  const origPrompt = win.prompt;
  let promptCalls = 0;
  win.prompt = () => { promptCalls++; return ['Practice', '100', '7/8'][promptCalls - 1]; };
  $('metroPresets').querySelector('.preset-btn.add').click();
  win.prompt = origPrompt;
  ok('adding a preset walks through name / bpm / signature', promptCalls === 3);
  ok('the new preset lands in settings', T.settings.metronomePresets.length === presetCountStart + 1);
  const added = T.settings.metronomePresets[T.settings.metronomePresets.length - 1];
  ok('...with the values from the prompts', added.name === 'Practice' && added.bpm === 100 &&
    added.num === 7 && added.den === 8, JSON.stringify(added));

  // Remove: the × on the preset we just added.
  const addedIdx = T.settings.metronomePresets.length - 1;
  doc.querySelector('.preset-x[data-drop="' + addedIdx + '"]').click();
  ok('the × removes exactly that preset', T.settings.metronomePresets.length === presetCountStart &&
    !T.settings.metronomePresets.some(p => p.name === 'Practice'));

  // A malformed saved preset must not crash rendering. This only ever gets
  // sanitised at two real entry points — load() on startup, and right after
  // a settings import, since that's arbitrary untrusted JSON — not on every
  // apply(), which would mean re-validating the array on every settings
  // change for no reason. So the test calls the actual guard directly rather
  // than expecting apply() to trigger something it was never meant to.
  T.settings.metronomePresets = [{ name: 'Bad' }, { name: 'Good', bpm: 90, num: 4, den: 4 }];
  T.sanitiseMetroPresets();
  ok('a malformed preset entry is dropped rather than crashing the render',
    T.settings.metronomePresets.length === 1 && T.settings.metronomePresets[0].name === 'Good');
  T.apply();
  ok('and the render itself does not throw on the now-clean array', !!$('metroPresets').innerHTML);

  // ----- leaving the mode restores the ordinary duration dial -----
  T.switchMode('stopwatch');
  ok('leaving metronome restores the normal Lap icon/label',
    $('lapBtn').dataset.ico === 'flag' && $('lapBtn').getAttribute('aria-label') === 'Record lap');
  ok('and the duration slider role', $('dial').getAttribute('aria-label').includes('Duration'));
  ok('metro-mode comes off the dial', !$('dial').classList.contains('metro-mode'));

  // ----- static wiring guards -----
  ok('MODE_ICONS has an entry for every mode (no broken palette icon)',
    /MODE_ICONS = \{[^}]*metronome:/.test(js));
  ok('the tap icon is a real entry in the icon map', /^\s*tap:/m.test(js));
  ok('no metro function is left checking the shared running flag instead of metroRunning', (() => {
    const block = js.slice(js.indexOf('// ========== METRONOME =========='), js.indexOf('function togglePlay'));
    return !/\bif \(running\)/.test(block) && !/\brunning &&/.test(block.replace(/metroRunning/g, ''));
  })());
  ok('switchMode excludes metronome from the shared stash/pause cycle',
    /mode !== 'clock' && mode !== 'metronome'/.test(js));
  ok('no leftover reference to the removed inline signature UI anywhere in the JS',
    !/metroSigRow|metroCustomNum|metroDenSeg|metroSigCustomBtn|applyMetroChange/.test(js));

  // The real gap this whole guard exists for: importFileInput merges an
  // arbitrary uploaded JSON file straight into live settings via
  // Object.assign, completely unvalidated. If that call path stops calling
  // the sanitiser, a corrupted or hand-crafted backup file becomes a crash
  // the moment the metronome rail tries to render it — worth pinning
  // structurally, not just testing the function works when called directly.
  ok('importing settings actually runs the metronome-preset sanitiser',
    /Object\.assign\(settings, data\.settings\)[\s\S]{0,700}sanitiseMetroPresets\(\)/.test(js));
}

// ---------- transport buttons don't rely on wrapping to fit their label ----------
// .controls is three flex:1 buttons in a fixed-width row, not a wrapping list
// like .presets — a flex item's default min-width:auto refuses to shrink
// below its own text width, so without an explicit override, a button whose
// allotted share of the row came in narrower than "REWIND" (or "PAUSE" at a
// higher UI scale) had nowhere to put the overflow but wrap, inside a box
// only padded for one line. Checked structurally since jsdom can't measure
// actual rendered text width.
{
  ['gnomon', 'vane', 'kymograph'].forEach(t => {
    const m = css.match(new RegExp('\\.visual-' + t + ' \\.ctrl-btn \\{([^}]*)\\}'));
    ok(t + ' ctrl-btn rule exists', !!m);
    if (!m) return;
    const body = m[1];
    ok(t + ' forces a single line rather than letting the label wrap',
      /white-space:\s*nowrap/.test(body));
    ok(t + ' can actually shrink below its content width if squeezed',
      /min-width:\s*0/.test(body));
    ok(t + ' degrades by truncating, not by overflowing its own box',
      /overflow:\s*hidden/.test(body) && /text-overflow:\s*ellipsis/.test(body));
    ok(t + ' has some horizontal breathing room, not text jammed to the border',
      /padding:\s*\d+px\s+[1-9]/.test(body));
  });
}

// ---------- computed contrast: every theme, both readings ----------
// Real WCAG relative-luminance math, not a visual impression — this is
// something that can be checked with full confidence from here with no
// browser, unlike almost everything else about how a theme looks. Runs
// against every theme's actual token values, so a future palette tweak that
// accidentally narrows a gap gets caught the same way the Pace Clock digit
// failure was.
{
  const hexToRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const relLum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; const [R, G, B] = [f(r), f(g), f(b)]; return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
  const contrast = (h1, h2) => { const L1 = relLum(hexToRgb(h1)), L2 = relLum(hexToRgb(h2)); const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1]; return (a + 0.05) / (b + 0.05); };
  const extractVars = block => { const out = {}; for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]] = m[2]; return out; };

  const THEMES = ['minimal', 'aurora', 'matrix', 'sunset', 'neon', 'glass', 'retro', 'cosmic', 'vivaldi',
    'bahnhof', 'safelight', 'paceclock', 'gnomon', 'vane', 'kymograph'];
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  const rootVars = extractVars(rootMatch[1]);
  const rootLight = css.match(/body\.light\s*\{([\s\S]*?)\n\}/) || css.match(/\n\.light\s*\{([\s\S]*?)\n\}/);

  const states = [];
  states.push({ theme: 'default', label: 'dark', vars: rootVars });
  if (rootLight) states.push({ theme: 'default', label: 'light', vars: { ...rootVars, ...extractVars(rootLight[1]) } });
  for (const t of THEMES) {
    const b = css.match(new RegExp('\\.visual-' + t + '\\s*\\{([^}]*)\\}'));
    if (!b) continue;
    const base = { ...rootVars, ...extractVars(b[1]) };
    states.push({ theme: t, label: 'base', vars: base });
    const l = css.match(new RegExp('\\.visual-' + t + '\\.light\\s*\\{([^}]*)\\}'));
    if (l) states.push({ theme: t, label: 'light', vars: { ...base, ...extractVars(l[1]) } });
  }

  let failures = [];
  for (const s of states) {
    const v = s.vars;
    if (!v.text || !v.bg || !v.card) continue;
    if (contrast(v.text, v.bg) < 4.5) failures.push(s.theme + ' ' + s.label + ' text/bg ' + contrast(v.text, v.bg).toFixed(2));
    if (contrast(v.text, v.card) < 4.5) failures.push(s.theme + ' ' + s.label + ' text/card ' + contrast(v.text, v.card).toFixed(2));
    if (v.text2 && contrast(v.text2, v.card) < 3.0) failures.push(s.theme + ' ' + s.label + ' text2/card ' + contrast(v.text2, v.card).toFixed(2));
  }
  ok('every theme clears WCAG AA on text/bg, text/card, and text2/card in both readings',
    failures.length === 0, failures.join(' | '));

  // The specific failure this suite exists to catch: Pace Clock's light
  // reading rendered its accent-coloured digits directly against a window
  // background close enough in luminance to be nearly unreadable (1.13:1).
  const pc = states.find(s => s.theme === 'paceclock' && s.label === 'light');
  ok('Pace Clock light: the fixed window colour actually clears AA against the (unchanged) accent',
    contrast(pc.vars.accent, '#26231D') >= 4.5, contrast(pc.vars.accent, '#26231D').toFixed(2));
  ok('the fix kept the original accent colour rather than darkening it into a different hue',
    pc.vars.accent === '#C8901A');
  ok('Pace Clock\'s dial background is corrected in CSS, not just verified in the abstract',
    /\.visual-paceclock\.light \.dial \{\s*background:\s*#26231D/.test(css));
  ok('the on-window caption colour is corrected for both readings, not just light',
    /--window-text:\s*#8C8D96/.test(css) && /\.visual-paceclock\.light \{ --window-text: #A19E93/.test(css));
}

// ---------- Gnomon & Kymograph light/dark polarity ----------
// Every other theme's bright reading is body.light; Gnomon and Kymograph are
// light-first, so their bright reading is the bare class and .light is their
// dark one — backward relative to the shared toggle, and backward relative to
// a whole family of settings-panel chrome that hardcodes a light-tint default
// corrected to a dark-tint under .light. Both states of both themes inherited
// the wrong half of that fix. This is the check that would have caught it,
// generalized rather than re-litigated by hand for each of the nine
// properties: for every OTHER theme, .light really does mean "this state is
// the bright one" (--text should read dark, meaning the theme's own bright
// surface is showing). For Gnomon and Kymograph specifically it's inverted.
{
  const other = ['minimal', 'aurora', 'matrix', 'sunset', 'neon', 'glass', 'retro', 'cosmic', 'vivaldi',
    'bahnhof', 'safelight', 'paceclock', 'vane'];
  const luminance = hex => {
    const v = hex.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
    return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
  };
  other.forEach(t => {
    const base = css.match(new RegExp('\\.visual-' + t + '\\s*\\{([^}]*)\\}'));
    const light = css.match(new RegExp('\\.visual-' + t + '\\.light\\s*\\{([^}]*)\\}'));
    if (!base || !light) return;
    const baseBg = (base[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
    const lightBg = (light[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
    if (!baseBg || !lightBg) return;
    ok(t + ': .light really is the brighter of its two readings',
      luminance(lightBg) > luminance(baseBg), t + ' base=' + baseBg + ' light=' + lightBg);
  });
  // Gnomon and Kymograph fail that same check — confirmed inverted, not a
  // false alarm — which is exactly why they needed the standalone correction
  // rather than a shared assumption everyone could rely on.
  ['gnomon', 'kymograph'].forEach(t => {
    const base = css.match(new RegExp('\\.visual-' + t + '\\s*\\{([^}]*)\\}'));
    const light = css.match(new RegExp('\\.visual-' + t + '\\.light\\s*\\{([^}]*)\\}'));
    const baseBg = (base[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
    const lightBg = (light[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
    ok(t + ' is confirmed inverted (documents why the fix exists)',
      luminance(lightBg) < luminance(baseBg), t + ' base=' + baseBg + ' light=' + lightBg);
  });

  // The fix itself: nine chrome components corrected for both themes, all via
  // color-mix(var(--text)) rather than a second hardcoded guess — the whole
  // point is that this can't invert regardless of which state is showing.
  const fixed = ['.toggle', '.close-panel', '.panel-content::-webkit-scrollbar-thumb',
    '.panel-btn:not\\(:disabled\\):hover', '.slider', '.sel-arrow', '.sel-body',
    '.ambient-bar', '.sel-swatch'];
  ['gnomon', 'kymograph'].forEach(t => {
    fixed.forEach(sel => {
      ok(t + ' corrects ' + sel + ' with color-mix, not another hardcoded literal',
        new RegExp('\\.visual-' + t + ' ' + sel + '[^{]*\\{[^}]*color-mix\\(in srgb, var\\(--text\\)').test(css) ||
        new RegExp('\\.visual-' + t + '[^{,]*,[\\s\\S]{0,30}' + sel + '[^{]*\\{[^}]*color-mix\\(in srgb, var\\(--text\\)').test(css),
        sel);
    });
  });

  // Specificity tie-break: .light .toggle and .visual-gnomon .toggle are both
  // two classes, so which one wins when BOTH are present (Gnomon's dark state)
  // comes down to source order. The fix has to be the last thing in the file.
  const lightToggleIdx = css.indexOf('.light .toggle {');
  const gnomonToggleFixIdx = css.indexOf('.visual-gnomon .toggle,');
  ok('the correction block appears after .light .toggle, so it wins the specificity tie',
    gnomonToggleFixIdx > lightToggleIdx && lightToggleIdx > -1);
}

// ---------- METRONOME: CSS ----------
{
  // The exact bug this pins: there is no generic .hidden utility class in
  // this stylesheet — .presets, .laps-container, .laps-stats and every other
  // hideable element each carry their own "<selector>.hidden { display: none }"
  // rule. .metro-presets was missing its, so toggling the class in JS did
  // nothing at all and the rail stayed visible in every mode.
  ok('.metro-presets.hidden actually hides the element',
    /\.metro-presets\.hidden\s*\{[^}]*display:\s*none/.test(css));
  ok('the pendulum only renders in metronome mode',
    /\.mode-metronome \.metro-pendulum \{ display: block/.test(css));
  ok('its swing duration is driven by --beat-ms, set live from BPM', /var\(--beat-ms/.test(css));
  ok('beat one gets a flash distinct from the swing itself', /@keyframes metro-flash/.test(css));
  ok('the beat lamps reuse the tick marks, scoped to metro-mode',
    /\.dial\.metro-mode \.tick\.metro-lit/.test(css));
  ok('the normal progress ring is hidden in metro-mode',
    /\.dial\.metro-mode \.ring-progress,[\s\S]{0,40}\.ring-head \{[\s\S]*?opacity:\s*0/.test(css));
  ok('the old inline-cluster CSS (signature chips, custom fields) is gone',
    !/\.metro-sig-chip|\.metro-custom-sig|\.metro-controls\b/.test(css));
  ok('the relocated subdivision segment still avoids the mismatched three-item pill',
    /#metroSubSeg::before \{ content: none/.test(css));
  ok('the preset list reuses Timer\'s own preset/add/remove component, not a new one',
    !/\.metro-mark\s*\{[^}]*background:/.test(css));   // no bespoke fill — .preset-btn already supplies it
  ok('the reused Lap button is relabelled Tap on all three text-button themes', [
    'gnomon', 'vane', 'kymograph'
  ].every(th => new RegExp('mode-metronome\\.visual-' + th + ' #lapBtn::after').test(css)));
  ok('the tap-flash animation exists for tap-tempo feedback', /@keyframes metro-tap-flash/.test(css));
  ok('the pendulum and accent flash both have a motion-none / reduced-motion escape hatch',
    /\.motion-none \.metro-pendulum-arm,\s*\n\.motion-none \.metro-accent/.test(css) ||
    /motion-none[\s\S]{0,60}metro-pendulum-arm[\s\S]{0,80}metro-accent/.test(css));
}

// ---------- live regions ----------
ok('polite live region exists', $('a11yLive') && $('a11yLive').getAttribute('aria-live') === 'polite');
ok('assertive live region exists', $('a11yAlert') && $('a11yAlert').getAttribute('role') === 'alert');
ok('time display is hidden from the reader', $('timeDisplay').getAttribute('aria-hidden') === 'true');

// ---------- modals ----------
$('settingsBtn').click();
ok('settings panel is a modal dialog',
  $('settingsPanel').getAttribute('role') === 'dialog' &&
  $('settingsPanel').getAttribute('aria-modal') === 'true');
ok('settings has an accessible name via its heading',
  !!$($('settingsPanel').getAttribute('aria-labelledby')));
ok('trigger reports expanded', $('settingsBtn').getAttribute('aria-expanded') === 'true');
$('closeSettings').click();
ok('trigger reports collapsed after close', $('settingsBtn').getAttribute('aria-expanded') === 'false');

$('historyBtn').click();
ok('dashboard is a modal dialog', $('dashboard').getAttribute('aria-modal') === 'true');
$('closeHistory').click();
ok('dashboard closes', !$('dashboard').classList.contains('active'));

// ---------- keyboard activation of promoted divs ----------
const themeTile = doc.querySelector('.theme-opt:not(.active)');
const wanted = themeTile.dataset.theme;
themeTile.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
ok('Enter activates a promoted tile', doc.body.className.includes('visual-' + wanted),
  doc.body.className);
doc.querySelector('.theme-opt[data-theme="default"]').click();

// ---------- fuzz: touch everything ----------
const errCount = () => uncaught.length;
const startErrs = errCount();

doc.querySelectorAll('.toggle').forEach(t => { t.click(); t.click(); });
doc.querySelectorAll('.theme-opt, .color-opt, .font-opt, .sound-opt, .clock-opt, .chip, .seg-btn')
   .forEach(o => o.click());
doc.querySelectorAll('.slider').forEach(s => {
  s.value = s.max;
  s.dispatchEvent(new win.Event('input', { bubbles: true }));
  s.value = s.min;
  s.dispatchEvent(new win.Event('input', { bubbles: true }));
});
doc.querySelectorAll('.ambient-btn').forEach(b => b.click());
doc.querySelectorAll('.mode-tab').forEach(t => t.click());
['Space', 'KeyL', 'KeyR', 'KeyS', 'Digit1', 'Digit2', 'Digit3'].forEach(code =>
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { code, key: code, bubbles: true })));
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

ok('fuzz pass raises no uncaught errors', errCount() === startErrs,
  uncaught.slice(startErrs).join(' | '));

// ---------- ARIA stays consistent after the fuzz ----------
ok('aria-checked still matches classes after fuzz',
  [...doc.querySelectorAll('.toggle')].every(t =>
    t.getAttribute('aria-checked') === String(t.classList.contains('active'))));
ok('ambient aria-pressed matches classes',
  [...doc.querySelectorAll('.ambient-btn')].every(b =>
    b.getAttribute('aria-pressed') === String(b.classList.contains('active'))));

// ---------- static asset checks ----------
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
ok('manifest has required fields',
  manifest.name && manifest.start_url && manifest.display && manifest.icons.length >= 2);
ok('manifest has a maskable icon',
  manifest.icons.some(i => (i.purpose || '').includes('maskable')));
ok('manifest paths are relative (works under a project path)',
  manifest.icons.every(i => !i.src.startsWith('/')) && !manifest.start_url.startsWith('/'));

const sw = fs.readFileSync('sw.js', 'utf8');
ok('service worker precaches the shell',
  ['index.html', 'chronos.css', 'chronos.js'].every(f => sw.includes("'" + f + "'")));
ok('service worker caches the font origins',
  sw.includes('fonts.gstatic.com') && sw.includes('fonts.googleapis.com'));
ok('service worker evicts old cache versions', /caches\.delete/.test(sw));

ok('css braces balance',
  (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);
const usedVars = [...new Set((css.match(/var\(\s*(--[a-z0-9-]+)/gi) || [])
  .map(m => m.replace(/var\(\s*/, '')))];
const declared = new Set((css.match(/^\s*(--[a-z0-9-]+)\s*:/gim) || [])
  .map(m => m.trim().replace(/\s*:$/, '')));
// Vars set from JS via style.setProperty aren't declared in the sheet.
const fromJs = new Set(['--dial-d', '--ring-w', '--ui-scale', '--clock-scale', '--seg-i',
  '--d', '--time-font-custom', '--i', '--bg-dim', '--bg-blur', '--p', '--x', '--y', '--sp',
  '--beat-ms']);
const undeclared = usedVars.filter(v => !declared.has(v) && !fromJs.has(v) &&
  !new RegExp('\\' + v + '\\s*:', 'i').test(css));
ok('no undeclared custom properties', undeclared.length === 0, undeclared.join(', '));

const tokenised = (css.match(/var\(--t[1-4]\)/g) || []).length;
ok('transitions run on the duration scale', tokenised > 120, String(tokenised));
const strayBlur = (css.match(/(?<!-webkit-)backdrop-filter:\s*blur\(/g) || []).length;
ok('blur is tokenised except for theme-owned cases', strayBlur <= 5, String(strayBlur));

// ---------- report ----------
console.log('\n' + errs.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
