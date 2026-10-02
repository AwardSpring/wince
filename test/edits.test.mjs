import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editToDiff, projectPath, capDiff } from '../src/edits.mjs';
import { currentTurn, toolCalls, unverifiedEdits } from '../src/transcript.mjs';

test('Edit becomes removed and added lines', () => {
  assert.equal(editToDiff('Edit', { old_string: 'a\nb', new_string: 'c' }), '@@\n-a\n-b\n+c');
});

test('Write becomes all added lines', () => {
  assert.equal(editToDiff('Write', { content: 'x\ny' }), '@@\n+x\n+y');
});

test('MultiEdit becomes one hunk per edit', () => {
  const diff = editToDiff('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] });
  assert.equal(diff, '@@\n-a\n+b\n@@\n-c\n+d');
});

test('projectPath makes absolute paths project-relative with forward slashes', () => {
  assert.equal(projectPath('/repo/src/a.ts', '/repo'), 'src/a.ts');
  assert.equal(projectPath('src/a.ts', '/repo'), 'src/a.ts');
  assert.equal(projectPath(undefined, '/repo'), '');
});

test('capDiff stops after the changed-line limit', () => {
  const diff = ['@@', ...Array.from({ length: 10 }, (_, i) => `+${i}`)].join('\n');
  assert.equal(capDiff(diff, 3).split('\n').length, 4);
});

const prompt = (content) => ({ type: 'user', message: { content } });
const use = (name, input = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } };

test('currentTurn starts at the latest human prompt, not at tool results', () => {
  const records = [prompt('first'), use('Edit'), prompt('second'), use('Read'), result];
  assert.deepEqual(toolCalls(currentTurn(records)).map((c) => c.name), ['Read']);
});

test('subagent and compaction records are not human prompts', () => {
  const records = [prompt('task'), use('Edit'), { ...prompt('summary'), isCompactSummary: true }, { ...prompt('sub'), isSidechain: true }];
  assert.deepEqual(toolCalls(currentTurn(records)).map((c) => c.name), ['Edit']);
});

test('unverifiedEdits is true only when no check ran after the last edit', () => {
  assert.equal(unverifiedEdits([{ name: 'Edit', input: {} }]), true);
  assert.equal(unverifiedEdits([{ name: 'Edit', input: {} }, { name: 'Bash', input: { command: 'npm test' } }]), false);
  assert.equal(unverifiedEdits([{ name: 'Bash', input: { command: 'npm test' } }, { name: 'Edit', input: {} }]), true);
  assert.equal(unverifiedEdits([{ name: 'Edit', input: {} }, { name: 'Bash', input: { command: 'ls -la' } }]), true);
  assert.equal(unverifiedEdits([{ name: 'Read', input: {} }]), false);
});

test('a PowerShell test run counts as verification', () => {
  assert.equal(unverifiedEdits([{ name: 'Edit', input: {} }, { name: 'PowerShell', input: { command: 'npm test' } }]), false);
});
