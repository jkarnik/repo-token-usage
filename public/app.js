import { addDays, colorSlots, summarize } from './aggregate.js';

const $ = (id) => document.getElementById(id);
const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', minimumSignificantDigits: 3, maximumSignificantDigits: 3 });
const fmtAxis = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmtPct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const fmtDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// Values keep three digits (1.10B next to 3.73B); axis ticks stay clean (1B, 2B).
const tokens = (n) => (Math.round(n) >= 1000 ? fmtCompact : fmtInt).format(Math.round(n));
const axisTokens = (n) => fmtAxis.format(n);
const dayLabel = (day) => fmtDay.format(new Date(`${day}T00:00:00Z`));
const PRESETS = [1, 7, 30, 90];
const REFRESH_MS = 60_000;

const state = { rows: [], slots: new Map(), from: null, to: null, view: 'chart' };

/** Today's local date as YYYY-MM-DD, the same day boundary Preflight uses. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const colorOf = (repo) => (state.slots.has(repo) ? `var(--s${state.slots.get(repo)})` : 'var(--other)');

/** Builds an element; string children become text nodes, so repo names are never parsed as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

// ---- Date range ----

function setPreset(days) {
  const to = today();
  setRange(addDays(to, 1 - days), to);
}

function setRange(from, to) {
  if (from > to) [from, to] = [to, from];
  Object.assign(state, { from, to });
  $('from').value = from;
  $('to').value = to;
  const preset = PRESETS.find((n) => to === today() && from === addDays(to, 1 - n));
  for (const b of $('presets').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.days) === preset));
  }
  // A preset stays relative to today on reload; a custom range stays fixed.
  history.replaceState(null, '', preset ? `#${preset}d` : `#${from}..${to}`);
  render();
}

function applyHash() {
  const hash = location.hash.slice(1);
  const preset = /^(\d+)d$/.exec(hash);
  const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(hash);
  if (preset) setPreset(Number(preset[1]));
  else if (custom) setRange(custom[1], custom[2]);
  else setPreset(30);
}

$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setPreset(Number(b.dataset.days));
});
for (const id of ['from', 'to']) {
  $(id).addEventListener('change', () => {
    if ($('from').value && $('to').value) setRange($('from').value, $('to').value);
  });
}

// ---- Data ----

async function load() {
  for (const id of ['repos-card', 'daily-card']) $(id).classList.add('loading');
  const res = await fetch('/api/usage', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { rows, generatedAt } = await res.json();
  state.rows = rows;
  state.slots = colorSlots(rows);
  const first = rows.reduce((min, r) => (r.day < min ? r.day : min), today());
  const sessions = new Set(rows.map((r) => r.sessionId)).size;
  const time = new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('asof').textContent = `From Preflight: ${sessions} sessions since ${dayLabel(first)}. Updated ${time}.`;
  for (const id of ['from', 'to']) Object.assign($(id), { min: first, max: today() });
  applyHash();
}

function showError(err) {
  $('asof').textContent = `Could not load Preflight data: ${err.message}`;
}

// ---- Render ----

function render() {
  if (!state.from) return;
  const { total, repos, days } = summarize(state.rows, state.from, state.to);
  renderKpis(total);
  renderRepos(repos);
  renderDaily(days);
  for (const id of ['repos-card', 'daily-card']) $(id).classList.remove('loading');
}

function renderKpis(total) {
  const tile = (cls, label, value) => el('div', { class: `kpi ${cls}` }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
  $('kpis').replaceChildren(
    tile('hero', 'Tokens', tokens(total.tokens)),
    tile('', 'Cost', fmtUsd.format(total.costUsd)),
    tile('', 'Sessions', String(total.sessions)),
    tile('', 'Cache reads, share of tokens', fmtPct.format(total.tokens ? total.cacheRead / total.tokens : 0)),
  );
}

function renderRepos(repos) {
  if (repos.length === 0) return $('repos').replaceChildren(el('div', { class: 'empty' }, 'No usage in this range.'));
  const max = repos[0].tokens;
  const heads = ['Repo', '', 'Tokens', 'Share', 'Cost', 'Sessions', 'Input', 'Output', 'Cache write', 'Cache read'];
  const num = (text) => el('td', { class: 'num' }, text);
  const bar = (repo, value) => {
    const b = el('div', { class: 'bar' });
    b.style.width = `${(value / max) * 100}%`;
    b.style.background = colorOf(repo);
    return el('td', { class: 'bar-cell', 'aria-hidden': 'true' }, b);
  };
  // Long repo and folder names wrap after a slash rather than mid-word.
  const withBreaks = (label) => label.split('/').flatMap((part, i, all) => (i < all.length - 1 ? [`${part}/`, el('wbr')] : [part]));
  const body = repos.map((r) =>
    el('tr', {},
      el('td', { class: 'repo' }, ...withBreaks(r.repo)),
      bar(r.repo, r.tokens),
      num(tokens(r.tokens)), num(fmtPct.format(r.share)), num(fmtUsd.format(r.costUsd)), num(String(r.sessions)),
      num(tokens(r.input)), num(tokens(r.output)), num(tokens(r.cacheWrite)), num(tokens(r.cacheRead)),
    ),
  );
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', i > 1 ? { class: 'num' } : {}, h)))),
    el('tbody', {}, ...body),
  );
  $('repos').replaceChildren(el('div', { style: 'overflow-x:auto' }, table));
}

// ---- Tokens per day ----

const OTHER = 'Other';
const SVG_NS = 'http://www.w3.org/2000/svg';
const PLOT_H = 200;
const AXIS_H = 22;
const LEFT = 48; // room for y-axis labels
const GAP = 2; // surface gap between stacked segments
const TOP = 10; // room above the top tick label
let lastDays = [];

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Colored repos in slot order (bottom of the stack first), and whether any other repo used tokens. */
function seriesOf(days) {
  const present = new Set(days.flatMap((d) => [...d.byRepo.keys()]));
  const colored = [...state.slots].filter(([repo]) => present.has(repo)).sort((a, b) => a[1] - b[1]).map(([repo]) => repo);
  return { colored, hasOther: [...present].some((repo) => !state.slots.has(repo)) };
}

function stackOf(day, { colored, hasOther }) {
  const parts = colored.map((repo) => ({ name: repo, color: colorOf(repo), value: day.byRepo.get(repo) ?? 0 }));
  if (hasOther) {
    const rest = day.tokens - parts.reduce((sum, p) => sum + p.value, 0);
    parts.push({ name: OTHER, color: 'var(--other)', value: Math.max(0, rest) });
  }
  return parts;
}

function renderDaily(days) {
  lastDays = days;
  const series = seriesOf(days);
  if (!days.some((d) => d.tokens > 0)) {
    $('legend').replaceChildren();
    return $('daily').replaceChildren(el('div', { class: 'empty' }, 'No usage in this range.'));
  }
  const names = series.hasOther ? [...series.colored, OTHER] : series.colored;
  $('legend').replaceChildren(
    ...names.map((name) => {
      const sw = el('span', { class: 'swatch' });
      sw.style.background = name === OTHER ? 'var(--other)' : colorOf(name);
      return el('span', {}, sw, name);
    }),
  );
  $('daily').replaceChildren(state.view === 'table' ? dailyTable(days, series, names) : dailyChart(days, series));
}

/** Rounds the axis top up to 4 even steps of 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v) {
  if (v <= 0) return 4;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag * 4;
}

function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function dailyChart(days, series) {
  const width = $('daily').clientWidth || 800;
  const plotW = width - LEFT;
  const max = niceMax(Math.max(...days.map((d) => d.tokens)));
  const y = (v) => TOP + PLOT_H - (v / max) * PLOT_H;
  const band = plotW / days.length;
  const barW = Math.max(2, Math.min(24, band * 0.7));
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 60))));
  const root = svg('svg', { viewBox: `0 0 ${width} ${TOP + PLOT_H + AXIS_H}`, height: TOP + PLOT_H + AXIS_H, role: 'img', 'aria-label': 'Tokens per day by repo. Use the Table button for the values.' });

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    root.append(
      svg('line', { class: i ? 'grid' : 'base', x1: LEFT, x2: width, y1: y(v), y2: y(v) }),
      svg('text', { x: LEFT - 8, y: y(v) + 4, 'text-anchor': 'end' }, axisTokens(v)),
    );
  }
  days.forEach((d, i) => {
    const x = LEFT + i * band + (band - barW) / 2;
    const parts = stackOf(d, series).filter((p) => p.value >= 0.5);
    let base = 0;
    parts.forEach((p, j) => {
      const yTop = y(base + p.value);
      const h = y(base) - yTop;
      base += p.value;
      if (j === parts.length - 1) return root.append(svg('path', { d: topRounded(x, yTop, barW, h, 4), fill: p.color }));
      if (h > GAP) root.append(svg('rect', { x, y: yTop + GAP, width: barW, height: h - GAP, fill: p.color }));
    });
    if (i % labelEvery === 0) {
      root.append(svg('text', { x: LEFT + i * band + band / 2, y: TOP + PLOT_H + 16, 'text-anchor': 'middle' }, dayLabel(d.day)));
    }
    const hit = svg('rect', { class: 'hit', x: LEFT + i * band, y: TOP, width: band, height: PLOT_H, tabindex: 0, 'aria-label': `${dayLabel(d.day)}: ${tokens(d.tokens)} tokens` });
    hit.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, d, series));
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('focus', () => {
      const r = hit.getBoundingClientRect();
      showTip(r.left + r.width / 2, r.top + 24, d, series);
    });
    hit.addEventListener('blur', hideTip);
    root.append(hit);
  });
  return root;
}

function showTip(cx, cy, day, series) {
  const tip = $('tip');
  const parts = stackOf(day, series).filter((p) => p.value >= 0.5).sort((a, b) => b.value - a.value);
  tip.replaceChildren(
    el('div', { class: 'day' }, `${dayLabel(day.day)}: ${tokens(day.tokens)} tokens`),
    ...parts.map((p) => {
      const key = el('span', { class: 'key' });
      key.style.background = p.color;
      return el('div', { class: 'row' }, key, el('b', {}, tokens(p.value)), el('span', { class: 'name' }, p.name));
    }),
  );
  tip.style.display = 'block';
  tip.style.left = `${Math.min(cx + 14, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.max(8, cy - tip.offsetHeight - 12)}px`;
}

function hideTip() {
  $('tip').style.display = 'none';
}

function dailyTable(days, series, names) {
  const head = el('tr', {}, el('th', {}, 'Day'), ...names.map((n) => el('th', { class: 'num' }, n)), el('th', { class: 'num' }, 'Total'));
  const body = days
    .filter((d) => d.tokens > 0)
    .map((d) =>
      el('tr', {},
        el('td', {}, dayLabel(d.day)),
        ...stackOf(d, series).map((p) => el('td', { class: 'num' }, tokens(p.value))),
        el('td', { class: 'num' }, tokens(d.tokens)),
      ),
    );
  return el('div', { style: 'overflow-x:auto' }, el('table', {}, el('thead', {}, head), el('tbody', {}, ...body)));
}

$('view').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.view = b.dataset.view;
  for (const x of $('view').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  renderDaily(lastDays);
});

let frame = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => renderDaily(lastDays));
});
addEventListener('hashchange', applyHash);

load().catch(showError);
setInterval(() => load().catch(showError), REFRESH_MS);
