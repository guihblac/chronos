// ========== CHRONOS BEHAVIOURAL SUITE ==========
// Boots the real index.html + chronos.js under jsdom and asserts on the things
// this round of changes introduced, plus a fuzz pass over every control to
// catch anything the promotion table broke by accident.

import fs from 'fs';
import { JSDOM } from 'jsdom';

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
  recordLap, switchMode, apply, renderLaps, paintLamps, buildTicks
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
ok('the clock tab ships hidden', allTabs.length === 4 && tabs.length === 3,
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
  const DIRECTIONS = ['bahnhof', 'safelight', 'paceclock'];
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
    ['IBM+Plex+Sans','IBM+Plex+Mono','Azeret+Mono','Barlow','Archivo','Doto']
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

  // apply() has to publish the live count, or the CSS can't know a fourth tab
  // appeared — settings.modes isn't visible to a stylesheet.
  const row = $('modeTabs');
  win.__t.settings.modes.clock = false; win.__t.apply();
  ok('the row reports three tabs by default', row.dataset.tabs === '3', row.dataset.tabs);
  win.__t.settings.modes.clock = true; win.__t.apply();
  ok('enabling Clock makes it four', row.dataset.tabs === '4', row.dataset.tabs);
  ok('a four-tab rule exists to tighten the padding',
    /\.mode-tabs\[data-tabs="4"\]/.test(css));
  ok('and a narrow-screen fallback scrolls rather than wrapping',
    /\.mode-tabs\[data-tabs="4"\][^{]*\{[^}]*overflow-x:\s*auto/.test(css));

  // Switching to a hidden-then-shown mode must still place the indicator.
  win.__t.switchMode('clock');
  ok('the clock tab can be selected once enabled',
    doc.querySelector('.mode-tab[data-mode="clock"]').getAttribute('aria-selected') === 'true');
  win.__t.switchMode('stopwatch');
  win.__t.settings.modes.clock = false; win.__t.apply();
  ok('and turning it off returns the row to three', row.dataset.tabs === '3');
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
  '--d', '--time-font-custom', '--i', '--bg-dim', '--bg-blur', '--p', '--x', '--y', '--sp']);
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
