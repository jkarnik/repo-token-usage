import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, colorSlots, summarize } from '../public/aggregate.js';

function row(sessionId, repo, day, cacheRead, costUsd = 1) {
  return { sessionId, repo, day, input: 1, output: 2, cacheRead, cacheWrite: 7, costUsd };
}

const rows = [
  row('a', 'me/app', '2026-11-05', 90),
  row('a', 'me/app', '2026-11-06', 90),
  row('b', 'me/blog', '2026-11-06', 690, 3),
  row('c', 'me/app', '2026-11-09', 90),
];

test('only days inside the range count, both ends included', () => {
  const { total } = summarize(rows, '2026-11-06', '2026-11-09');
  assert.equal(total.tokens, 100 + 700 + 100);
  assert.equal(total.costUsd, 5);
});

test('repos are ranked by tokens with their share of the range', () => {
  const { repos } = summarize(rows, '2026-11-05', '2026-11-09');
  assert.deepEqual(
    repos.map((r) => [r.repo, r.tokens, r.share]),
    [
      ['me/blog', 700, 0.7],
      ['me/app', 300, 0.3],
    ],
  );
});

test('a session that spans several days counts once', () => {
  const { total, repos } = summarize(rows, '2026-11-05', '2026-11-09');
  assert.equal(total.sessions, 3);
  assert.equal(repos.find((r) => r.repo === 'me/app').sessions, 2);
});

test('the day list runs from the first day with data to the end of the range, gaps included', () => {
  const { days } = summarize(rows, '2026-11-01', '2026-11-10');
  assert.deepEqual(
    days.map((d) => [d.day, d.tokens]),
    [
      ['2026-11-05', 100],
      ['2026-11-06', 800],
      ['2026-11-07', 0],
      ['2026-11-08', 0],
      ['2026-11-09', 100],
      ['2026-11-10', 0],
    ],
  );
  assert.equal(days[1].byRepo.get('me/blog'), 700);
});

test('colors follow the all-time rank, five repos at most, whatever range is shown', () => {
  const many = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((repo, i) => row(repo, repo, '2026-11-05', 1000 - i * 100));
  const slots = colorSlots(many);
  assert.deepEqual([...slots], [['r1', 0], ['r2', 1], ['r3', 2], ['r4', 3], ['r5', 4]]);
  assert.equal(slots.has('r6'), false);
});

test('addDays moves across month ends', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-11-24', -6), '2026-11-18');
});
