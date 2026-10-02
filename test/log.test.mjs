import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, readEntries, findLogDirs, fileKind } from '../src/log.mjs';
import { summarize, render } from '../src/cli.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'flinch-log-'));

test('appendEntry writes one JSON line per entry with a timestamp', async () => {
  const d = dir();
  await appendEntry(d, { check: 'rules', outcome: 'quiet' });
  await appendEntry(d, { check: 'done', outcome: 'flagged' });
  const lines = readFileSync(join(d, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].ts);
  assert.equal(lines[1].check, 'done');
});

test('the log rolls over at the cap and never keeps more than two files', async () => {
  const d = dir();
  const maxBytes = 300;
  for (let i = 0; i < 40; i++) await appendEntry(d, { i, pad: 'x'.repeat(40) }, { maxBytes });
  assert.ok(existsSync(join(d, 'log.1.jsonl')));
  assert.ok(statSync(join(d, 'log.jsonl')).size < maxBytes + 120);
  assert.ok(statSync(join(d, 'log.1.jsonl')).size < maxBytes + 120);
  const entries = await readEntries(d);
  assert.equal(entries.at(-1).i, 39, 'newest entry is last');
  assert.ok(entries.every((e, k) => k === 0 || e.i > entries[k - 1].i), 'previous file is read first');
});

test('readEntries skips damaged lines and missing files', async () => {
  assert.deepEqual(await readEntries(dir()), []);
});

test('findLogDirs finds marketplace and --plugin-dir data folders only', async () => {
  const home = dir();
  for (const n of ['flinch-flinch', 'flinch-inline', 'other-plugin']) mkdirSync(join(home, '.claude', 'plugins', 'data', n), { recursive: true });
  const found = (await findLogDirs(home)).map((p) => p.split(/[\\/]/).pop()).sort();
  assert.deepEqual(found, ['flinch-flinch', 'flinch-inline']);
});

test('fileKind keeps only the extension', () => {
  assert.equal(fileKind('src/Orders/Query.cs'), '.cs');
  assert.equal(fileKind('Makefile'), null);
});

test('summarize counts outcomes, backends and top rules inside the window', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const at = (d) => new Date(now - d * 86_400_000).toISOString();
  const s = summarize(
    [
      { ts: at(1), check: 'rules', outcome: 'flagged', id: 'no-any', backend: 'jev', ms: 100 },
      { ts: at(1), check: 'rules', outcome: 'quiet', backend: 'jev', ms: 300 },
      { ts: at(2), check: 'done', outcome: 'flagged', id: 'unproven-done', backend: 'jev', ms: 200 },
      { ts: at(2), event: 'stop', outcome: 'error', ms: 5 },
      { ts: at(30), check: 'rules', outcome: 'flagged', id: 'old', backend: 'jev', ms: 1 },
    ],
    { days: 7, now },
  );
  assert.equal(s.total, 4);
  assert.deepEqual(s.outcomes, { flagged: 2, quiet: 1, unusable: 0, error: 1, timeout: 0 });
  assert.deepEqual(s.backends, { jev: { checks: 3, p50: 200 } });
  assert.deepEqual(s.topRules, [['no-any', 1]]);
  assert.match(render(s), /Flagged\s+2/);
});

test('render says so when nothing has been logged', () => {
  assert.match(render(summarize([], { days: 7 })), /No checks logged yet/);
});

test('entries from older versions or with missing fields never break the summary', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const ts = new Date(now - 3_600_000).toISOString();
  const s = summarize(
    [{ ts, event: 'stop', outcome: 'flagged', output: { systemMessage: 'x' }, ms: 300 }, { ts, outcome: 'quiet' }, { ts: 'garbage' }, null],
    { days: 7, now },
  );
  assert.equal(s.total, 2);
  assert.doesNotThrow(() => render(s));
});
