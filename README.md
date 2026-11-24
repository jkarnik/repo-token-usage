# Repo token usage

A local dashboard that shows how your AI coding token usage splits across repos for any date range. It reads the session files Preflight already keeps in `~/.newrelic-preflight/` and changes nothing in Preflight.

## Run it

```bash
npm run setup   # once: links the installed Preflight package as ./preflight
npm start       # serves http://localhost:7788
```

It needs Node 22 or later and Preflight installed with `npm install -g @newrelic/preflight`. Run `npm run setup` under the Node version that has Preflight installed, since it links whatever `npm root -g` points to.

## What the numbers mean

- Tokens are fresh input, output, cache writes and cache reads added together, the same total Preflight uses. Cache reads make up most of it and cost a twentieth of fresh input on Claude Opus and Sonnet 5.5, so the Cost column can rank repos differently.
- Preflight saves a session's tokens as one total but its cost per day. A session that ran across several days has its tokens split by each day's share of its cost. Totals for a whole session are exact.
- A session belongs to the git repo Preflight recorded for it. Sessions outside a git repo are grouped by the folder they ran in.
- Days are local dates. Preflight deletes a session file 90 days after its last change, so 90 days is the longest range with complete data.
- The five repos with the most tokens overall keep their own colors in every range; the rest share the gray "Other" in the daily chart.

## How it works

`src/server.js` loads sessions with Preflight's own `SessionStore` through the `preflight` symlink, and `src/daily-rows.js` turns each session into one row per day. The page in `public/` filters those rows by date range in the browser with `public/aggregate.js`, and fetches fresh data every minute.

Run the tests with `npm test`.
