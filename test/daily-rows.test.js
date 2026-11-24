import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDailyRows } from '../src/daily-rows.js';

const HOME = '/Users/me';
// Tests pin the day boundary to UTC; the server passes Preflight's local-time localDateKey.
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const opts = { dayKey, home: HOME };

function session(overrides = {}) {
  return {
    sessionId: 's1',
    repoName: 'me/app',
    startTime: Date.UTC(2026, 10, 5, 10),
    tokensInput: 10,
    tokensOutput: 100,
    tokensThinking: 0,
    tokensCacheRead: 1000,
    tokensCacheCreation: 50,
    estimatedCostUsd: 2,
    costByDayUsd: { '2026-11-05': 2 },
    timeline: [],
    ...overrides,
  };
}

const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);

test('a one-day session becomes one row with its exact totals', () => {
  assert.deepEqual(toDailyRows([session()], opts), [
    {
      sessionId: 's1',
      repo: 'me/app',
      day: '2026-11-05',
      input: 10,
      output: 100,
      cacheRead: 1000,
      cacheWrite: 50,
      costUsd: 2,
    },
  ]);
});

test("a multi-day session splits its tokens by each day's share of its cost", () => {
  const rows = toDailyRows([session({ costByDayUsd: { '2026-11-07': 0.5, '2026-11-05': 1.5 } })], opts);
  assert.deepEqual(
    rows.map((r) => [r.day, r.cacheRead, r.costUsd]),
    [
      ['2026-11-05', 750, 1.5],
      ['2026-11-07', 250, 0.5],
    ],
  );
});

test('daily costs that miss part of the session cost are scaled up to it', () => {
  const rows = toDailyRows(
    [session({ estimatedCostUsd: 4, costByDayUsd: { '2026-11-05': 1, '2026-11-06': 1 } })],
    opts,
  );
  assert.deepEqual(rows.map((r) => r.costUsd), [2, 2]);
  assert.equal(sum(rows, 'output'), 100);
});

test('a session with no daily cost lands on its start day', () => {
  const rows = toDailyRows([session({ costByDayUsd: {}, startTime: Date.UTC(2026, 10, 9, 3) })], opts);
  assert.deepEqual(rows.map((r) => [r.day, r.input]), [['2026-11-09', 10]]);
});

test('thinking tokens count as output', () => {
  const [row] = toDailyRows([session({ tokensThinking: 7 })], opts);
  assert.equal(row.output, 107);
});

test('a session outside git is labeled by the folder it used most', () => {
  const timeline = [{ cwd: '/Users/me/Code/tmp' }, { cwd: '/Users/me/Code/tmp' }, { cwd: '/Users/me/Code/x' }];
  const [row] = toDailyRows([session({ repoName: null, timeline })], opts);
  assert.equal(row.repo, '~/Code/tmp');
});

test('a session with no repo and no folder is labeled Unknown folder', () => {
  const [row] = toDailyRows([session({ repoName: undefined, timeline: undefined })], opts);
  assert.equal(row.repo, 'Unknown folder');
});

test('a session with no tokens and no cost produces no rows', () => {
  const empty = session({
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheCreation: 0,
    estimatedCostUsd: 0,
    costByDayUsd: {},
  });
  assert.deepEqual(toDailyRows([empty], opts), []);
});
