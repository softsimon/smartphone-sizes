'use strict';

/* ------------------------------------------------------------------ *
 *  Smartphone Sizes — true-to-scale smartphone comparison
 * ------------------------------------------------------------------ */

// CSS reference: 96 CSS pixels per inch, 25.4 mm per inch.
// At 100% zoom this renders phones at (approximately) their real
// physical size on a standard-density display.
const CSS_PX_PER_MM = 96 / 25.4; // ≈ 3.7795
const MM_PER_INCH = 25.4;

const state = {
  zoom: 100, // percent
  unit: 'cm', // 'cm' | 'in'
  // Show two phones initially; the database may grow large.
  selected: new Set(PHONES.slice(0, 2).map((p) => p.id)),
};

/* ----------------------- URL state (shareable) -------------------- *
 * The current view is mirrored into the query string so a URL can be
 * copied and shared to reproduce the same comparison, e.g.
 *   ?phones=iphone-17-pro,find-x9-ultra&zoom=120&unit=in
 * ------------------------------------------------------------------ */

const VALID_IDS = new Set(PHONES.map((p) => p.id));

/** Read selection / zoom / unit from the query string into `state`. */
function readStateFromUrl() {
  const params = new URLSearchParams(location.search);

  const raw = params.get('phones');
  if (raw !== null) {
    // Keep order, drop unknown ids and duplicates.
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((id) => VALID_IDS.has(id));
    state.selected = new Set(ids);
  }

  const zoom = Number(params.get('zoom'));
  if (Number.isFinite(zoom) && zoom >= 20 && zoom <= 300) {
    state.zoom = Math.round(zoom);
  }

  const unit = params.get('unit');
  if (unit === 'cm' || unit === 'in') {
    state.unit = unit;
  }
}

/** Mirror `state` back into the URL without adding history entries. */
function writeStateToUrl() {
  const params = new URLSearchParams();
  params.set('phones', [...state.selected].join(','));
  if (state.zoom !== 100) params.set('zoom', String(state.zoom));
  if (state.unit !== 'cm') params.set('unit', state.unit);

  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  history.replaceState(null, '', url);
}

/** Effective pixels-per-mm for the current zoom level. */
function pxPerMm() {
  return CSS_PX_PER_MM * (state.zoom / 100);
}

/* ----------------------- Real-size calibration -------------------- *
 * Browsers don't expose physical screen size, so the user supplies
 * their monitor's diagonal once. Combined with the screen's pixel
 * resolution this gives the monitor's true CSS-pixels-per-mm, from
 * which we derive the zoom that makes 1mm on screen == 1mm in reality.
 * ------------------------------------------------------------------ */

const MONITOR_KEY = 'phonesize.monitorInch';

/** Native screen diagonal in CSS pixels (the dimension our SVGs use). */
function screenDiagonalCssPx() {
  return Math.hypot(window.screen.width, window.screen.height);
}

/**
 * Best-effort guess of the monitor's physical diagonal in inches,
 * assuming a typical ~96 device-DPI desktop panel. Only a starting
 * point — the user can correct it.
 */
function guessMonitorInch() {
  const dpr = window.devicePixelRatio || 1;
  const diagDevicePx = screenDiagonalCssPx() * dpr;
  const ASSUMED_DEVICE_DPI = 96 * dpr; // ~110 on a "retina"-ish panel
  return diagDevicePx / ASSUMED_DEVICE_DPI;
}

/** The stored monitor size, the guess, or null if unset. */
function getMonitorInch() {
  const saved = Number(localStorage.getItem(MONITOR_KEY));
  if (Number.isFinite(saved) && saved >= 4 && saved <= 120) return saved;
  return null;
}

function setMonitorInch(inch) {
  if (Number.isFinite(inch) && inch >= 4 && inch <= 120) {
    localStorage.setItem(MONITOR_KEY, String(inch));
  }
}

/**
 * Zoom percentage at which the phones render at true physical size for
 * the given monitor diagonal. Returns null if the value is unusable.
 *
 * realCssPxPerMm = screenDiagonalCssPx / (monitorInch * 25.4)
 * fitZoom = realCssPxPerMm / CSS_PX_PER_MM * 100
 */
function realSizeZoom(monitorInch) {
  if (!Number.isFinite(monitorInch) || monitorInch < 4) return null;
  const realCssPxPerMm = screenDiagonalCssPx() / (monitorInch * MM_PER_INCH);
  return (realCssPxPerMm / CSS_PX_PER_MM) * 100;
}

/* ----------------------------- Formatting ------------------------- */

function mmToCm(mm) {
  return mm / 10;
}
function mmToInch(mm) {
  return mm / MM_PER_INCH;
}

/* ---------------------------- Geometry ---------------------------- */

/**
 * Physical screen size in mm, derived from the official diagonal
 * (`screenInch`) and the native pixel aspect ratio (`screenRes`).
 *
 * For a diagonal D and aspect ratio w:h, the sides are
 *   width  = D * w / hypot(w, h)
 *   height = D * h / hypot(w, h)
 *
 * Falls back to a typical ~9.5%-bezel estimate if data is missing.
 */
function screenSizeMm(phone) {
  const diagMm = (phone.screenInch || 0) * MM_PER_INCH;
  const res = phone.screenRes;
  if (diagMm && Array.isArray(res) && res[0] && res[1]) {
    const [pw, ph] = res;
    const diagPx = Math.hypot(pw, ph);
    return {
      wMm: (diagMm * pw) / diagPx,
      hMm: (diagMm * ph) / diagPx,
    };
  }
  // Fallback: assume the screen fills ~95% of width, keep body aspect.
  const wMm = phone.widthMm * 0.95;
  return { wMm, hMm: wMm * (phone.heightMm / phone.widthMm) * 0.95 };
}

/** Human-readable dimension in the active unit. */
function fmtLength(mm) {
  if (state.unit === 'in') {
    return mmToInch(mm).toFixed(2) + '″';
  }
  return mmToCm(mm).toFixed(2) + ' cm';
}

/* --------------------------- Phone rendering ---------------------- */

// Largest battery in the database, so fill levels are comparable.
const MAX_BATTERY = Math.max(...PHONES.map((p) => p.batteryMah || 0), 1);

/**
 * A little battery-shaped indicator: a body with a terminal nub and a
 * green fill level proportional to the phone's capacity (relative to
 * the biggest battery on hand), plus the mAh figure.
 */
function batteryMarkup(phone) {
  if (!phone.batteryMah) return '';
  const pct = Math.round((phone.batteryMah / MAX_BATTERY) * 100);
  const mah = phone.batteryMah.toLocaleString('en-US');
  return `
    <span class="battery" title="${mah} mAh battery">
      <span class="battery__body">
        <span class="battery__fill" style="width:${pct}%"></span>
      </span>
      <span class="battery__cap"></span>
      <span class="battery__label">${mah} mAh</span>
    </span>
  `;
}

/**
 * Build an SVG silhouette for a phone, sized in CSS pixels to the
 * current scale. The SVG viewBox uses millimetres so all geometry is
 * expressed in real-world units.
 */
function renderPhone(phone) {
  const scale = pxPerMm();
  const wPx = phone.widthMm * scale;
  const hPx = phone.heightMm * scale;

  const card = document.createElement('figure');
  card.className = 'phone';

  // --- the drawing ---
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'phone__svg');
  svg.setAttribute('width', wPx);
  svg.setAttribute('height', hPx);
  svg.setAttribute('viewBox', `0 0 ${phone.widthMm} ${phone.heightMm}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `${phone.brand} ${phone.name}, ${fmtLength(phone.heightMm)} tall by ` +
      `${fmtLength(phone.widthMm)} wide`
  );

  const r = phone.cornerMm;

  // Real screen size in mm from the official diagonal + pixel aspect
  // ratio, so the drawn bezel reflects the true screen-to-body ratio.
  const { wMm: screenWmm, hMm: screenHmm } = screenSizeMm(phone);
  const sideBezel = (phone.widthMm - screenWmm) / 2;
  const vBezel = (phone.heightMm - screenHmm) / 2;
  // Screen corners follow the body radius, inset by the side bezel.
  const screenR = Math.max(1, r - sideBezel);

  // Outer body
  const body = document.createElementNS(svgNS, 'rect');
  body.setAttribute('x', 0);
  body.setAttribute('y', 0);
  body.setAttribute('width', phone.widthMm);
  body.setAttribute('height', phone.heightMm);
  body.setAttribute('rx', r);
  body.setAttribute('ry', r);
  body.setAttribute('fill', phone.accent);
  body.setAttribute('stroke', 'rgba(0,0,0,0.35)');
  body.setAttribute('stroke-width', 0.4);
  svg.appendChild(body);

  // Screen — centered, so the (usually larger) bottom/top bezel shows.
  const screen = document.createElementNS(svgNS, 'rect');
  screen.setAttribute('x', sideBezel);
  screen.setAttribute('y', vBezel);
  screen.setAttribute('width', screenWmm);
  screen.setAttribute('height', screenHmm);
  screen.setAttribute('rx', screenR);
  screen.setAttribute('ry', screenR);
  screen.setAttribute('fill', 'rgba(0,0,0,0.55)');
  svg.appendChild(screen);

  // Punch-hole camera, sitting just inside the top of the screen
  const cam = document.createElementNS(svgNS, 'circle');
  cam.setAttribute('cx', phone.widthMm / 2);
  cam.setAttribute('cy', vBezel + 4);
  cam.setAttribute('r', 1.1);
  cam.setAttribute('fill', 'rgba(255,255,255,0.4)');
  svg.appendChild(cam);

  // Wrap the SVG so the spec overlay can be positioned over the screen.
  const frame = document.createElement('div');
  frame.className = 'phone__frame';
  frame.style.width = wPx + 'px';
  frame.style.height = hPx + 'px';
  frame.appendChild(svg);

  // --- spec overlay, centered on top of the phone's screen ---
  const overlay = document.createElement('div');
  overlay.className = 'phone__overlay';
  overlay.innerHTML = `
    <span class="phone__screen">${phone.screenInch.toFixed(2)}&Prime;</span>
    <span class="phone__name">${phone.brand} ${phone.name}</span>
    <span class="phone__dims">
      ${fmtLength(phone.heightMm)} &times; ${fmtLength(phone.widthMm)}
    </span>
    <span class="phone__meta">
      ${phone.thicknessMm.toFixed(2)} mm thick &middot; ${phone.weightG} g
    </span>
    <span class="phone__color" style="--swatch:${phone.accent}">
      ${phone.accentName}
    </span>
    ${batteryMarkup(phone)}
  `;
  frame.appendChild(overlay);

  card.appendChild(frame);

  // --- remove button below the phone ---
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'phone__remove';
  remove.setAttribute('aria-label', `Remove ${phone.brand} ${phone.name}`);
  remove.title = `Remove ${phone.brand} ${phone.name}`;
  remove.innerHTML = '&times;';
  remove.addEventListener('click', () => removePhone(phone.id));
  card.appendChild(remove);

  return card;
}

/* ----------------------------- Rulers ----------------------------- */

const STAGE_GAP_MM = 12; // gap between phones, in mm of real space

const PHONE_BY_ID = new Map(PHONES.map((p) => [p.id, p]));

/** Selected phones in the order they were added (used by the chip bar). */
function selectedPhones() {
  return [...state.selected].map((id) => PHONE_BY_ID.get(id));
}

/**
 * Selected phones sorted largest-first (biggest on the left) for the
 * comparison view. Sorts by height, then width as a tiebreaker.
 */
function displayPhones() {
  return selectedPhones().sort(
    (a, b) => b.heightMm - a.heightMm || b.widthMm - a.widthMm
  );
}

/**
 * Choose a "nice" tick step (in mm) so the ruler stays readable
 * regardless of zoom: aim for a tick roughly every 48px.
 */
function tickStepMm() {
  const targetPx = 48;
  const rawMm = targetPx / pxPerMm();
  if (state.unit === 'in') {
    // steps in inches: 0.25, 0.5, 1, 2 ...
    const inch = rawMm / MM_PER_INCH;
    const steps = [0.25, 0.5, 1, 2, 5];
    const pick = steps.find((s) => s >= inch) || steps[steps.length - 1];
    return pick * MM_PER_INCH;
  }
  // steps in cm: 0.5, 1, 2, 5 ...
  const cm = rawMm / 10;
  const steps = [0.5, 1, 2, 5, 10];
  const pick = steps.find((s) => s >= cm) || steps[steps.length - 1];
  return pick * 10;
}

function tickLabel(mm) {
  if (state.unit === 'in') {
    const v = mmToInch(mm);
    return (Number.isInteger(v) ? v.toString() : v.toFixed(2)) + '″';
  }
  const v = mmToCm(mm);
  return (Number.isInteger(v) ? v.toString() : v.toFixed(1));
}

/** Vertical ruler spanning the tallest selected phone. */
function renderVerticalRuler() {
  const el = document.getElementById('rulerV');
  el.innerHTML = '';
  const phones = displayPhones();
  if (!phones.length) return;

  const scale = pxPerMm();
  const maxHmm = Math.max(...phones.map((p) => p.heightMm));
  const heightPx = maxHmm * scale;
  el.style.height = heightPx + 'px';

  const step = tickStepMm();
  for (let mm = 0; mm <= maxHmm + 0.001; mm += step) {
    const tick = document.createElement('div');
    tick.className = 'tick tick--v';
    tick.style.top = mm * scale + 'px';
    tick.innerHTML = `<span class="tick__label">${tickLabel(mm)}</span>`;
    el.appendChild(tick);
  }

  // unit cap at top
  const unitCap = document.createElement('div');
  unitCap.className = 'ruler__unit';
  unitCap.textContent = state.unit === 'in' ? 'inches' : 'cm';
  el.appendChild(unitCap);
}

/** Horizontal ruler spanning total combined width of the row. */
function renderHorizontalRuler() {
  const el = document.getElementById('rulerH');
  el.innerHTML = '';
  const phones = displayPhones();
  if (!phones.length) return;

  const scale = pxPerMm();
  const totalWmm =
    phones.reduce((sum, p) => sum + p.widthMm, 0) +
    STAGE_GAP_MM * (phones.length - 1);
  const widthPx = totalWmm * scale;
  el.style.width = widthPx + 'px';

  const step = tickStepMm();
  for (let mm = 0; mm <= totalWmm + 0.001; mm += step) {
    const tick = document.createElement('div');
    tick.className = 'tick tick--h';
    tick.style.left = mm * scale + 'px';
    tick.innerHTML = `<span class="tick__label">${tickLabel(mm)}</span>`;
    el.appendChild(tick);
  }

  const unitCap = document.createElement('div');
  unitCap.className = 'ruler__unit ruler__unit--h';
  unitCap.textContent = state.unit === 'in' ? 'inches' : 'cm';
  el.appendChild(unitCap);
}

/* ----------------------------- Stage ------------------------------ */

function renderStage() {
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  const phones = displayPhones();

  if (!phones.length) {
    const empty = document.createElement('p');
    empty.className = 'stage__empty';
    empty.textContent = 'Select at least one phone to compare.';
    stage.appendChild(empty);
    return;
  }

  stage.style.gap = STAGE_GAP_MM * pxPerMm() + 'px';
  phones.forEach((p) => stage.appendChild(renderPhone(p)));
}

function renderAll() {
  renderStage();
  renderVerticalRuler();
  renderHorizontalRuler();
}

/* --------------------- Phone search + chip bar -------------------- */

const searchState = { query: '', active: -1 }; // active = highlighted result index

function addPhone(id) {
  state.selected.add(id);
  closeResults();
  document.getElementById('phoneSearch').value = '';
  searchState.query = '';
  renderAll();
  writeStateToUrl();
}

function removePhone(id) {
  state.selected.delete(id);
  renderAll();
  writeStateToUrl();
}

/** Phones matching the current query that aren't already selected. */
function searchMatches() {
  const q = searchState.query.trim().toLowerCase();
  return PHONES.filter((p) => {
    if (state.selected.has(p.id)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      `${p.brand} ${p.name}`.toLowerCase().includes(q)
    );
  });
}

function closeResults() {
  const list = document.getElementById('searchResults');
  const input = document.getElementById('phoneSearch');
  list.hidden = true;
  list.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
  searchState.active = -1;
}

function renderResults() {
  const list = document.getElementById('searchResults');
  const input = document.getElementById('phoneSearch');
  const matches = searchMatches();

  list.innerHTML = '';
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'search-results__empty';
    li.textContent = state.selected.size
      ? 'No more phones match.'
      : 'No phones match.';
    list.appendChild(li);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    return;
  }

  matches.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'search-results__item' + (i === searchState.active ? ' is-active' : '');
    li.setAttribute('role', 'option');
    li.id = `result-${p.id}`;
    li.innerHTML = `
      <span class="result__swatch" style="background:${p.accent}"></span>
      <span class="result__name">${p.brand} ${p.name}</span>
      <span class="result__dim">${p.screenInch.toFixed(2)}&Prime;</span>
    `;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus; don't blur before click
      addPhone(p.id);
    });
    list.appendChild(li);
  });

  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function wireSearch() {
  const input = document.getElementById('phoneSearch');
  const list = document.getElementById('searchResults');

  input.addEventListener('input', () => {
    searchState.query = input.value;
    searchState.active = -1;
    renderResults();
  });

  input.addEventListener('focus', () => renderResults());

  input.addEventListener('keydown', (e) => {
    const matches = searchMatches();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) return renderResults();
      searchState.active = Math.min(searchState.active + 1, matches.length - 1);
      renderResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchState.active = Math.max(searchState.active - 1, 0);
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = searchState.active >= 0 ? matches[searchState.active] : matches[0];
      if (pick) addPhone(pick.id);
    } else if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });

  // Close the dropdown when focus/click leaves the search area.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.phone-search')) closeResults();
  });
}

/* ----------------------------- Controls --------------------------- */

/** Set the zoom level, sync the slider + label, re-render and persist. */
function setZoom(percent) {
  const zoom = document.getElementById('zoom');
  const zoomValue = document.getElementById('zoomValue');
  const min = Number(zoom.min);
  const max = Number(zoom.max);
  state.zoom = Math.round(Math.min(max, Math.max(min, percent)));
  zoom.value = state.zoom;
  zoomValue.textContent = state.zoom + '%';
  renderAll();
  writeStateToUrl();
}

function wireControls() {
  const zoom = document.getElementById('zoom');
  zoom.addEventListener('input', () => setZoom(Number(zoom.value)));

  document.querySelectorAll('.unit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.unit = btn.dataset.unit;
      document
        .querySelectorAll('.unit-btn')
        .forEach((b) => b.classList.toggle('is-active', b === btn));
      renderAll();
      writeStateToUrl();
    });
  });
}

function wireRealSize() {
  const input = document.getElementById('monitorInch');
  const btn = document.getElementById('fitReal');

  // Pre-fill with the saved value, or a best-effort guess.
  const stored = getMonitorInch();
  input.value = (stored ?? guessMonitorInch()).toFixed(1);

  const fit = () => {
    const inch = Number(input.value);
    if (!Number.isFinite(inch) || inch < 4 || inch > 120) {
      input.classList.add('is-invalid');
      return;
    }
    input.classList.remove('is-invalid');
    setMonitorInch(inch);
    const z = realSizeZoom(inch);
    if (z != null) setZoom(z);
  };

  btn.addEventListener('click', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fit();
  });
  // Persist edits so the value sticks even without clicking Fit.
  input.addEventListener('change', () => {
    const inch = Number(input.value);
    if (Number.isFinite(inch)) setMonitorInch(inch);
  });

  wireHint();
}

/** Toggle the "?" help tooltip on click/tap (hover is handled in CSS). */
function wireHint() {
  const hintBtn = document.getElementById('realSizeHint');
  if (!hintBtn) return;
  const hint = hintBtn.closest('.hint');

  hintBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hint.classList.toggle('is-open');
    hintBtn.setAttribute('aria-expanded', String(open));
  });

  // Close when clicking elsewhere or pressing Escape.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.hint')) {
      hint.classList.remove('is-open');
      hintBtn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hint.classList.remove('is-open');
      hintBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ------------------------------ Boot ------------------------------ */

/** Reflect the current `state` onto the zoom slider and unit buttons. */
function syncControlsToState() {
  const zoom = document.getElementById('zoom');
  const zoomValue = document.getElementById('zoomValue');
  zoom.value = state.zoom;
  zoomValue.textContent = state.zoom + '%';

  document.querySelectorAll('.unit-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.unit === state.unit);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  readStateFromUrl();
  syncControlsToState();
  wireSearch();
  wireControls();
  wireRealSize();
  renderAll();
});
