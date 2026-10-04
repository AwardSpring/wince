import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateRoots, changedSince, toLocalPath } from '../src/sweep.mjs';
import { verifiedAfter } from '../src/checks/done.mjs';

const HOOK = fileURLToPath(new URL('../src/hook.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
const iso = (ms) => new Date(ms).toISOString();

function repo() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'wince-sweep-')));
  git(dir, 'init', '-q');
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.wince'));
  writeFileSync(join(dir, '.wince', 'rules.json'), JSON.stringify({ rules: [{ id: 'no-any', applies: ['src/**/*.ts'], rule: 'Do not add the any type.' }] }));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'old.ts'), 'export const old = 1;\n');
  git(dir, 'add', '.');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return dir;
}

const outside = () => mkdtempSync(join(tmpdir(), 'wince-sweep-out-'));

function transcriptAt(dir, records) {
  const path = join(outside(), 't.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n'));
  return path;
}

const prompt = (ts) => ({ type: 'user', timestamp: iso(ts), message: { content: 'fix it' } });
const use = (ts, name, input) => ({ type: 'assistant', timestamp: iso(ts), message: { content: [{ type: 'tool_use', name, input }] } });
const said = (ts, text) => ({ type: 'assistant', timestamp: iso(ts), message: { content: [{ type: 'text', text }] } });

function stop(dir, path, env = {}, event = 'stop', extra = {}) {
  const data = outside();
  const res = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify({ cwd: dir, transcript_path: path, agent_transcript_path: path, ...extra }),
    env: { ...process.env, WINCE_INNER: '', WINCE_BACKEND: 'fake', CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: data, ...env },
    encoding: 'utf8',
  });
  const log = (() => {
    try {
      return readFileSync(join(data, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  })();
  return { code: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, log };
}

test('a file changed by a shell command this turn is rules-checked and counts as an untested edit', () => {
  const dir = repo();
  const t0 = Date.now() - 60_000;
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a: any = 1;\n');
  const path = transcriptAt(dir, [prompt(t0), use(t0 + 1000, 'Bash', { command: 'python fix.py' }), said(t0 + 2000, 'Fixed it, all done.')]);
  const { code, out, log } = stop(dir, path, { WINCE_FAKE: 'no-any,claims-done' });
  assert.equal(code, 0);
  assert.match(out.systemMessage, /src\/a\.ts may break "no-any"/);
  assert.match(out.systemMessage, /nothing has been tested/);
  assert.deepEqual(log.map((e) => [e.check, e.outcome]), [['sweep', 'flagged'], ['done', 'flagged']]);
});

test('changes made before the turn started are not the agent\'s and are ignored', () => {
  const dir = repo();
  writeFileSync(join(dir, 'src', 'old.ts'), 'export const old: any = 1;\n');
  const longAgo = (Date.now() - 3_600_000) / 1000;
  utimesSync(join(dir, 'src', 'old.ts'), longAgo, longAgo);
  const t0 = Date.now() - 60_000;
  const path = transcriptAt(dir, [prompt(t0), use(t0 + 1000, 'Read', { file_path: join(dir, 'src', 'old.ts') }), said(t0 + 2000, 'Done.')]);
  const { out, log } = stop(dir, path, { WINCE_FAKE: 'no-any,claims-done' });
  assert.equal(out, null);
  assert.deepEqual(log, []);
});

test('a file written with an edit tool is left to the per-edit check, not swept again', () => {
  const dir = repo();
  const t0 = Date.now() - 60_000;
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a: any = 1;\n');
  const path = transcriptAt(dir, [prompt(t0), use(t0 + 1000, 'Edit', { file_path: join(dir, 'src', 'a.ts'), old_string: 'a', new_string: 'b' }), use(t0 + 2000, 'Bash', { command: 'npm test' }), said(t0 + 3000, 'Done.')]);
  const { log } = stop(dir, path, { WINCE_FAKE: 'no-any,claims-done' });
  assert.ok(!log.some((e) => e.check === 'sweep'));
});

test('a test run after the shell write counts as checking it; the rules check still runs', () => {
  const dir = repo();
  const t0 = Date.now() - 60_000;
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a: any = 1;\n');
  const path = transcriptAt(dir, [prompt(t0), use(t0 + 1000, 'Bash', { command: 'python fix.py' }), use(Date.now() + 1000, 'Bash', { command: 'npm test' }), said(Date.now() + 2000, 'Done.')]);
  const { out, log } = stop(dir, path, { WINCE_FAKE: 'no-any,claims-done' });
  assert.deepEqual(log.map((e) => [e.check, e.outcome, e.reason]), [['sweep', 'flagged', undefined], ['done', 'skipped', 'verified']]);
  assert.doesNotMatch(out.systemMessage, /nothing has been tested/);
});

test('a subagent that broke a rule through the shell is sent back', () => {
  const dir = repo();
  const t0 = Date.now() - 60_000;
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a: any = 1;\n');
  const side = (r) => ({ ...r, isSidechain: true });
  const path = transcriptAt(dir, [side(prompt(t0)), side(use(t0 + 1000, 'PowerShell', { command: 'python fix.py; npm test' })), side(said(t0 + 2000, 'Done.'))]);
  const { out } = stop(dir, path, { WINCE_FAKE: 'no-any,claims-done' }, 'subagent-stop', { agent_type: 'general-purpose' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /no-any/);
});

test('a repository named by path in a shell command is swept too', () => {
  const dir = repo();
  const other = repo();
  const t0 = Date.now() - 60_000;
  writeFileSync(join(other, 'src', 'a.ts'), 'export const a: any = 1;\n');
  const roots = candidateRoots({ cwd: dir, projectDir: dir, calls: [{ name: 'Bash', input: { command: `cd "${other.replaceAll('\\', '/')}" && python fix.py` } }] });
  assert.ok(roots.includes(other), `roots: ${roots.join(', ')}`);
  void t0;
});

test('changedSince skips deleted files and honors the time cutoff', async () => {
  const dir = repo();
  const now = Date.now();
  writeFileSync(join(dir, 'src', 'a.ts'), 'changed\n');
  git(dir, 'rm', '-q', 'src/old.ts');
  const recent = await changedSince(dir, now - 60_000);
  assert.deepEqual(recent.map((f) => f.rel), ['src/a.ts']);
  assert.deepEqual(await changedSince(dir, now + 60_000), []);
});

test('verifiedAfter accepts a test in the same command that wrote the file', () => {
  const calls = [
    { name: 'Bash', input: { command: 'python fix.py && npm test' }, ts: 1000 },
  ];
  assert.equal(verifiedAfter(calls, 1500), true);
  assert.equal(verifiedAfter([{ name: 'Bash', input: { command: 'npm test' }, ts: 1000 }, { name: 'Bash', input: { command: 'python fix.py' }, ts: 2000 }], 2500), false);
});

test('Git Bash paths become Windows paths on Windows', () => {
  if (process.platform === 'win32') assert.equal(toLocalPath('/c/Code/x'), 'C:/Code/x');
  else assert.equal(toLocalPath('/c/Code/x'), '/c/Code/x');
});
