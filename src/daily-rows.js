/**
 * Preflight saves each session's tokens as one total but its cost per local
 * day. These rows put a share of the tokens on each day the session spent
 * on, weighted by that day's cost, so a date range can pick up part of a
 * session that ran across several days.
 */

const UNKNOWN_FOLDER = 'Unknown folder';

/** One row per (session, day) with that day's share of the session's tokens and cost. */
export function toDailyRows(sessions, { dayKey, home }) {
  const rows = [];
  for (const s of sessions) {
    const totals = {
      input: s.tokensInput ?? 0,
      // Thinking is billed as output; Preflight keeps it separate and adds it to its totals.
      output: (s.tokensOutput ?? 0) + (s.tokensThinking ?? 0),
      cacheRead: s.tokensCacheRead ?? 0,
      cacheWrite: s.tokensCacheCreation ?? 0,
      costUsd: s.estimatedCostUsd ?? 0,
    };
    if (Object.values(totals).every((v) => v === 0)) continue;
    const repo = repoLabel(s, home);
    for (const [day, weight] of dayWeights(s, dayKey)) {
      rows.push({
        sessionId: s.sessionId,
        repo,
        day,
        input: totals.input * weight,
        output: totals.output * weight,
        cacheRead: totals.cacheRead * weight,
        cacheWrite: totals.cacheWrite * weight,
        costUsd: totals.costUsd * weight,
      });
    }
  }
  return rows;
}

/** [day, weight] pairs summing to 1, from the session's cost per day; its start day if it has none. */
function dayWeights(s, dayKey) {
  const days = Object.entries(s.costByDayUsd ?? {}).filter(([, usd]) => usd > 0);
  const total = days.reduce((sum, [, usd]) => sum + usd, 0);
  if (total === 0) return [[dayKey(s.startTime), 1]];
  return days.sort(([a], [b]) => a.localeCompare(b)).map(([day, usd]) => [day, usd / total]);
}

/** The git repo name, or else the folder the session's tool calls ran in most. */
function repoLabel(s, home) {
  if (s.repoName) return s.repoName;
  const counts = new Map();
  for (const entry of s.timeline ?? []) {
    if (entry.cwd) counts.set(entry.cwd, (counts.get(entry.cwd) ?? 0) + 1);
  }
  if (counts.size === 0) return UNKNOWN_FOLDER;
  const [cwd] = [...counts].reduce((best, next) => (next[1] > best[1] ? next : best));
  return cwd === home || cwd.startsWith(home + '/') ? '~' + cwd.slice(home.length) : cwd;
}
