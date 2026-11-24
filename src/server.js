/**
 * Serves the dashboard on 127.0.0.1 and its data at /api/usage, read from
 * Preflight's session files through Preflight's own SessionStore.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toDailyRows } from './daily-rows.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFLIGHT = join(ROOT, 'preflight', 'dist');
const PORT = Number(process.env.PORT ?? 7788);

if (!existsSync(PREFLIGHT)) {
  console.error('Preflight not found at ./preflight. Run `npm run setup` to link the installed package.');
  process.exit(1);
}
const fromPreflight = (path) => import(pathToFileURL(join(PREFLIGHT, path)).href);
const { SessionStore } = await fromPreflight('storage/session-store.js');
const { localDateKey } = await fromPreflight('lib/date.js');
const { DEFAULT_STORAGE_PATH } = await fromPreflight('config.js');

// Same lookup Preflight uses for its data folder (env var, else ~/.newrelic-preflight).
const store = new SessionStore({ storagePath: process.env.NEW_RELIC_AI_MCP_STORAGE_PATH ?? DEFAULT_STORAGE_PATH });

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/aggregate.js': ['aggregate.js', 'text/javascript; charset=utf-8'],
};
// Only these Host headers, so a web page can't read the API through DNS rebinding.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host ?? '')) return send(res, 403, 'text/plain', 'Forbidden');
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/api/usage') {
      const rows = toDailyRows(store.loadAllSessions(), { dayKey: localDateKey, home: homedir() });
      return send(res, 200, 'application/json', JSON.stringify({ generatedAt: Date.now(), rows }));
    }
    const file = FILES[path];
    if (!file) return send(res, 404, 'text/plain', 'Not found');
    return send(res, 200, file[1], await readFile(join(ROOT, 'public', file[0])));
  } catch (err) {
    console.error(err);
    return send(res, 500, 'text/plain', 'Server error');
  }
})
  .on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Is the dashboard already running?` : err);
    process.exit(1);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Repo token usage: http://localhost:${PORT}/`));

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
