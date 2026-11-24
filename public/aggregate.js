/**
 * Date-range math for the dashboard, shared by the page and the node tests.
 * Each row is one session's share of tokens and cost on one local day
 * (YYYY-MM-DD), as served by /api/usage.
 */

/** Repos that get their own color; the rest share "Other". */
export const COLOR_SLOTS = 5;

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'costUsd'];

export const tokensOf = (r) => r.input + r.output + r.cacheRead + r.cacheWrite;

/** Totals for the days from `from` to `to`, both included: overall, per repo (most tokens first) and per day. */
export function summarize(rows, from, to) {
  const total = blank();
  const byRepo = new Map();
  const byDay = new Map();
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    add(total, r);
    if (!byRepo.has(r.repo)) byRepo.set(r.repo, blank());
    add(byRepo.get(r.repo), r);
    const day = byDay.get(r.day) ?? new Map();
    day.set(r.repo, (day.get(r.repo) ?? 0) + tokensOf(r));
    byDay.set(r.day, day);
  }
  const overall = done(total);
  const repos = [...byRepo]
    .map(([repo, sums]) => ({ repo, ...done(sums) }))
    .map((r) => ({ ...r, share: overall.tokens ? r.tokens / overall.tokens : 0 }))
    .sort((a, b) => b.tokens - a.tokens);

  // The axis starts at the first day Preflight has data for, so days before it don't read as zero use.
  const firstDay = rows.reduce((min, r) => (min === null || r.day < min ? r.day : min), null);
  const days = [];
  if (firstDay !== null) {
    for (let day = firstDay > from ? firstDay : from; day <= to; day = addDays(day, 1)) {
      const perRepo = byDay.get(day) ?? new Map();
      days.push({ day, tokens: [...perRepo.values()].reduce((a, b) => a + b, 0), byRepo: perRepo });
    }
  }
  return { total: overall, repos, days };
}

/** Color slot per repo by all-time tokens, so a repo keeps its color whatever range is shown. */
export function colorSlots(rows) {
  const totals = new Map();
  for (const r of rows) totals.set(r.repo, (totals.get(r.repo) ?? 0) + tokensOf(r));
  const ranked = [...totals].sort((a, b) => b[1] - a[1]).slice(0, COLOR_SLOTS);
  return new Map(ranked.map(([repo], i) => [repo, i]));
}

/** The YYYY-MM-DD date `n` days after `day`; calendar math only, no time zone involved. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function blank() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, tokens: 0, sessionIds: new Set() };
}

function add(sums, r) {
  for (const f of FIELDS) sums[f] += r[f];
  sums.tokens += tokensOf(r);
  sums.sessionIds.add(r.sessionId);
}

function done({ sessionIds, ...sums }) {
  return { ...sums, sessions: sessionIds.size };
}
