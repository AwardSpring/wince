import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../src/hook.mjs', import.meta.url));

function project({ config, rules = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flinch-test-'));
  if (rules) {
    mkdirSync(join(dir, '.flinch'));
    writeFileSync(
      join(dir, '.flinch', 'rules.json'),
      JSON.stringify({ rules: [{ id: 'no-any', applies: ['**/*.ts'], rule: "Do not add the 'any' type." }] }),
    );
  }
  if (config) writeFileSync(join(dir, '.flinch.json'), JSON.stringify(config));
  return dir;
}

function runHook(event, input, { dir, env = {} }) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [HOOK, event], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      FLINCH_INNER: '',
      FLINCH_BACKEND: 'fake',
      CLAUDE_PROJECT_DIR: dir,
      CLAUDE_PLUGIN_DATA: join(dir, '.data'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
  return { code: res.status, stdout: res.stdout, ms: Date.now() - started };
}

const edit = (dir) => ({
  hook_event_name: 'PostToolUse',
  cwd: dir,
  tool_name: 'Edit',
  tool_input: { file_path: join(dir, 'src', 'a.ts'), old_string: 'let x = 1;', new_string: 'let x: any = 1;' },
});

test('a confident rule hit nudges with additionalContext', () => {
  const dir = project();
  const out = runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'no-any' } });
  assert.equal(out.code, 0);
  const json = JSON.parse(out.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(json.hookSpecificOutput.additionalContext, /no-any/);
  assert.match(json.hookSpecificOutput.additionalContext, /src\/a\.ts/);
});

test('block mode turns a rule hit into a block decision', () => {
  const dir = project({ config: { mode: 'block' } });
  const json = JSON.parse(runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'no-any' } }).stdout);
  assert.equal(json.decision, 'block');
  assert.match(json.reason, /no-any/);
});

test('stays silent on none, low confidence, and files no rule covers', () => {
  const dir = project();
  assert.equal(runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'none' } }).stdout, '');
  assert.equal(runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'no-any', FLINCH_FAKE_CONFIDENCE: '0.5' } }).stdout, '');
  const css = { ...edit(dir), tool_input: { file_path: join(dir, 'a.css'), old_string: 'a', new_string: 'b' } };
  assert.equal(runHook('post-tool-use', css, { dir, env: { FLINCH_FAKE: 'no-any' } }).stdout, '');
});

for (const behavior of ['throw', 'garbage']) {
  test(`fails open when the backend returns ${behavior}`, () => {
    const dir = project();
    const out = runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: behavior } });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, '');
  });
}

test('fails open within the backend timeout when the backend hangs', () => {
  const dir = project();
  const out = runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'hang' } });
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '');
  assert.ok(out.ms < 5000, `took ${out.ms}ms`);
});

test('fails open on malformed stdin, a missing rules file, and broken config', () => {
  const dir = project();
  const malformed = runHook('post-tool-use', '{not json', { dir });
  assert.equal(malformed.code, 0);
  assert.equal(malformed.stdout, '');
  const bare = project({ rules: false });
  assert.equal(runHook('post-tool-use', edit(bare), { dir: bare, env: { FLINCH_FAKE: 'no-any' } }).stdout, '');
  const broken = project();
  writeFileSync(join(broken, '.flinch.json'), '{ nope');
  const out = runHook('post-tool-use', edit(broken), { dir: broken, env: { FLINCH_FAKE: 'no-any' } });
  assert.equal(out.code, 0);
});

test('does nothing inside a session Flinch itself spawned', () => {
  const dir = project();
  const out = runHook('post-tool-use', edit(dir), { dir, env: { FLINCH_FAKE: 'no-any', FLINCH_INNER: '1' } });
  assert.equal(out.stdout, '');
});

function transcript(dir, lines) {
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'));
  return path;
}

const prompt = { type: 'user', message: { content: 'fix the bug' } };
const toolUse = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const said = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

test('stop warns the user about an unverified done claim in nudge mode', () => {
  const dir = project();
  const path = transcript(dir, [prompt, toolUse('Edit', { file_path: 'a.ts' }), said('Fixed! All done.')]);
  const out = runHook('stop', { transcript_path: path, last_assistant_message: 'Fixed! All done.' }, { dir, env: { FLINCH_FAKE: 'claims-done' } });
  assert.match(JSON.parse(out.stdout).systemMessage, /nothing has been tested/);
});

test('stop sends the agent back in block mode', () => {
  const dir = project({ config: { mode: 'block' } });
  const path = transcript(dir, [prompt, toolUse('Write', { file_path: 'a.ts' }), said('Done.')]);
  const json = JSON.parse(runHook('stop', { transcript_path: path }, { dir, env: { FLINCH_FAKE: 'claims-done' } }).stdout);
  assert.equal(json.decision, 'block');
});

test('stop stays silent after a test run, with no edits, or when already re-prompted', () => {
  const dir = project();
  const env = { FLINCH_FAKE: 'claims-done' };
  const tested = transcript(dir, [prompt, toolUse('Edit', {}), toolUse('Bash', { command: 'npm test' }), said('Done.')]);
  assert.equal(runHook('stop', { transcript_path: tested }, { dir, env }).stdout, '');
  const noEdits = transcript(dir, [prompt, toolUse('Read', {}), said('Here is the answer.')]);
  assert.equal(runHook('stop', { transcript_path: noEdits }, { dir, env }).stdout, '');
  const edited = transcript(dir, [prompt, toolUse('Edit', {}), said('Done.')]);
  assert.equal(runHook('stop', { transcript_path: edited, stop_hook_active: true }, { dir, env }).stdout, '');
});

test('edits made before the latest prompt do not count', () => {
  const dir = project();
  const path = transcript(dir, [prompt, toolUse('Edit', {}), said('Done.'), { type: 'user', message: { content: 'thanks, what does X do?' } }, said('X does Y.')]);
  assert.equal(runHook('stop', { transcript_path: path }, { dir, env: { FLINCH_FAKE: 'claims-done' } }).stdout, '');
});
