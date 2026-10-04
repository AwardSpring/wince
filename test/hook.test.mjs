import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../src/hook.mjs', import.meta.url));

function project({ config, rules = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wince-test-'));
  if (rules) {
    mkdirSync(join(dir, '.wince'));
    writeFileSync(
      join(dir, '.wince', 'rules.json'),
      JSON.stringify({ rules: [{ id: 'no-any', applies: ['**/*.ts'], rule: "Do not add the 'any' type." }] }),
    );
  }
  if (config) writeFileSync(join(dir, '.wince.json'), JSON.stringify(config));
  return dir;
}

function runHook(event, input, { dir, env = {} }) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [HOOK, event], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      WINCE_INNER: '',
      WINCE_BACKEND: 'fake',
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
  const out = runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } });
  assert.equal(out.code, 0);
  const json = JSON.parse(out.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(json.hookSpecificOutput.additionalContext, /no-any/);
  assert.match(json.hookSpecificOutput.additionalContext, /src\/a\.ts/);
});

test('block mode turns a rule hit into a block decision', () => {
  const dir = project({ config: { mode: 'block' } });
  const json = JSON.parse(runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } }).stdout);
  assert.equal(json.decision, 'block');
  assert.match(json.reason, /no-any/);
});

test('stays silent on none, low confidence, and files no rule covers', () => {
  const dir = project();
  assert.equal(runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'none' } }).stdout, '');
  assert.equal(runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any', WINCE_FAKE_CONFIDENCE: '0.5' } }).stdout, '');
  const css = { ...edit(dir), tool_input: { file_path: join(dir, 'a.css'), old_string: 'a', new_string: 'b' } };
  assert.equal(runHook('post-tool-use', css, { dir, env: { WINCE_FAKE: 'no-any' } }).stdout, '');
});

for (const behavior of ['throw', 'garbage']) {
  test(`fails open when the backend returns ${behavior}`, () => {
    const dir = project();
    const out = runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: behavior } });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, '');
  });
}

test('fails open within the backend timeout when the backend hangs', () => {
  const dir = project();
  const out = runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'hang' } });
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
  assert.equal(runHook('post-tool-use', edit(bare), { dir: bare, env: { WINCE_FAKE: 'no-any' } }).stdout, '');
  const broken = project();
  writeFileSync(join(broken, '.wince.json'), '{ nope');
  const out = runHook('post-tool-use', edit(broken), { dir: broken, env: { WINCE_FAKE: 'no-any' } });
  assert.equal(out.code, 0);
});

test('does nothing inside a session Wince itself spawned', () => {
  const dir = project();
  const out = runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any', WINCE_INNER: '1' } });
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
  const out = runHook('stop', { transcript_path: path, last_assistant_message: 'Fixed! All done.' }, { dir, env: { WINCE_FAKE: 'claims-done' } });
  assert.match(JSON.parse(out.stdout).systemMessage, /nothing has been tested/);
});

test('stop sends the agent back in block mode', () => {
  const dir = project({ config: { mode: 'block' } });
  const path = transcript(dir, [prompt, toolUse('Write', { file_path: 'a.ts' }), said('Done.')]);
  const json = JSON.parse(runHook('stop', { transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout);
  assert.equal(json.decision, 'block');
});

test('stop stays silent after a test run, with no edits, or when already re-prompted', () => {
  const dir = project();
  const env = { WINCE_FAKE: 'claims-done' };
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
  assert.equal(runHook('stop', { transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
});

function logLines(dir) {
  const path = join(dir, '.data', 'log.jsonl');
  try {
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('every check that reaches a backend is logged, quiet ones included', () => {
  const dir = project();
  runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'none' } });
  runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } });
  runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'throw' } });
  const outcomes = logLines(dir).map((e) => e.outcome);
  assert.deepEqual(outcomes, ['quiet', 'flagged', 'error']);
});

test('checks that never reach a backend are not logged', () => {
  const dir = project({ rules: false });
  runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } });
  assert.deepEqual(logLines(dir), []);
});

test('the log holds no file paths, code or rule text', () => {
  const dir = project();
  runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } });
  const raw = readFileSync(join(dir, '.data', 'log.jsonl'), 'utf8');
  const [entry] = logLines(dir);
  assert.equal(entry.id, 'no-any');
  assert.equal(entry.kind, '.ts');
  assert.equal(entry.backend, 'fake');
  assert.doesNotMatch(raw, /a\.ts|src|any type|let x/);
});

const shell = (command, tool = 'Bash') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } });

test('a risky command asks the user first in nudge mode', () => {
  const dir = project();
  const json = JSON.parse(runHook('pre-tool-use', shell('git push --force'), { dir }).stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /force-pushes/);
});

test('a risky command is refused in block mode', () => {
  const dir = project({ config: { mode: 'block' } });
  const json = JSON.parse(runHook('pre-tool-use', shell('git reset --hard', 'PowerShell'), { dir }).stdout);
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
});

test('the risky check needs no backend and no rules file', () => {
  const dir = project({ rules: false });
  const out = runHook('pre-tool-use', shell('npm publish'), { dir, env: { WINCE_BACKEND: 'none-such', TYPESAFE_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('the risky check stays silent on safe commands, other tools, and when turned off', () => {
  const dir = project();
  assert.equal(runHook('pre-tool-use', shell('git status'), { dir }).stdout, '');
  assert.equal(runHook('pre-tool-use', { tool_name: 'Read', tool_input: { file_path: 'x' } }, { dir }).stdout, '');
  const off = project({ config: { checks: { risky: false } } });
  assert.equal(runHook('pre-tool-use', shell('git push --force'), { dir: off }).stdout, '');
});

test('flagged risky commands are logged without the command text', () => {
  const dir = project();
  runHook('pre-tool-use', shell('git push --force origin secret-branch-name'), { dir });
  const raw = readFileSync(join(dir, '.data', 'log.jsonl'), 'utf8');
  const [entry] = logLines(dir);
  assert.equal(entry.check, 'risky');
  assert.equal(entry.id, 'force-push');
  assert.doesNotMatch(raw, /secret-branch-name/);
});

test('a rule nudge also shows the user a one-line notice', () => {
  const dir = project();
  const json = JSON.parse(runHook('post-tool-use', edit(dir), { dir, env: { WINCE_FAKE: 'no-any' } }).stdout);
  assert.equal(json.systemMessage, 'Wince flagged "no-any" in a.ts');
});

test('stand-downs and session starts are logged with a short session id', () => {
  const dir = project();
  const css = { ...edit(dir), session_id: 'abcdef1234567890', tool_input: { file_path: join(dir, 'a.css'), old_string: 'a', new_string: 'b' } };
  runHook('post-tool-use', css, { dir, env: { WINCE_FAKE: 'no-any' } });
  runHook('session-start', { session_id: 'abcdef1234567890' }, { dir });
  const tested = transcript(dir, [prompt, toolUse('Edit', {}), toolUse('Bash', { command: 'npm test' }), said('Done.')]);
  runHook('stop', { transcript_path: tested, session_id: 'abcdef1234567890' }, { dir, env: { WINCE_FAKE: 'claims-done' } });
  const lines = logLines(dir);
  assert.deepEqual(lines.map((e) => [e.check, e.outcome, e.reason]), [
    ['rules', 'skipped', 'no-matching-rules'],
    ['session', 'started', undefined],
    ['done', 'skipped', 'verified'],
  ]);
  assert.ok(lines.every((e) => e.session === 'abcdef12'));
  assert.ok(lines.every((e) => !('backend' in e)), 'stand-downs never called a backend');
});

const side = (r) => ({ ...r, isSidechain: true });

test('a subagent that edits and says done without testing is sent back, in nudge mode too', () => {
  const dir = project();
  const path = transcript(dir, [side(prompt), side(toolUse('Edit', { file_path: 'a.ts' })), side(said('Done, all fixed.'))]);
  const out = runHook('subagent-stop', { agent_transcript_path: path, agent_type: 'general-purpose', last_assistant_message: 'Done, all fixed.' }, { dir, env: { WINCE_FAKE: 'claims-done' } });
  const json = JSON.parse(out.stdout);
  assert.equal(json.decision, 'block');
  assert.match(json.reason, /Run the relevant tests or build now/);
  assert.equal(logLines(dir).at(-1).agent, 'general-purpose');
});

test('"subagents": "log" only logs the finding', () => {
  const dir = project({ config: { subagents: 'log' } });
  const path = transcript(dir, [side(prompt), side(toolUse('Edit', {})), side(said('Done.'))]);
  assert.equal(runHook('subagent-stop', { agent_transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
  assert.equal(logLines(dir).at(-1).outcome, 'flagged');
});

test('block mode sends the subagent back', () => {
  const dir = project({ config: { mode: 'block' } });
  const path = transcript(dir, [side(prompt), side(toolUse('Write', { file_path: 'a.ts' })), side(said('Done.'))]);
  assert.equal(JSON.parse(runHook('subagent-stop', { agent_transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout).decision, 'block');
});

test('a subagent that tested through PowerShell stands down', () => {
  const dir = project();
  const path = transcript(dir, [side(prompt), side(toolUse('Edit', {})), side(toolUse('PowerShell', { command: 'dotnet test Awardspring.Tests' })), side(said('Done.'))]);
  assert.equal(runHook('subagent-stop', { agent_transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
  assert.equal(logLines(dir).at(-1).reason, 'verified');
});

test('the main agent check ignores subagent records, and the subagent check ignores the main agent', () => {
  const dir = project();
  const mainOnly = transcript(dir, [prompt, side(toolUse('Edit', {})), said('Done.')]);
  assert.equal(runHook('stop', { transcript_path: mainOnly }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
  const subOnly = transcript(dir, [prompt, toolUse('Edit', {}), said('Done.')]);
  assert.equal(runHook('subagent-stop', { agent_transcript_path: subOnly }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
});

test('edits outside any repository, like scratchpad files, do not count as unverified changes', () => {
  const dir = project();
  const scratch = join(mkdtempSync(join(tmpdir(), 'wince-scratch-')), 'commit-message.txt');
  const path = transcript(dir, [prompt, toolUse('Write', { file_path: scratch }), said('Committed and opened the PR.')]);
  assert.equal(runHook('stop', { transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout, '');
});

test('an edit inside a repository still counts', () => {
  const dir = project();
  mkdirSync(join(dir, '.git'));
  const path = transcript(dir, [prompt, toolUse('Edit', { file_path: join(dir, 'src', 'a.ts') }), said('Done, it works.')]);
  assert.match(JSON.parse(runHook('stop', { transcript_path: path }, { dir, env: { WINCE_FAKE: 'claims-done' } }).stdout).systemMessage, /nothing has been tested/);
});
