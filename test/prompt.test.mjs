import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleCheck, NONE } from '../src/prompt.mjs';

const rules = [
  { id: 'no-any', rule: "Do not add the 'any' type." },
  { id: 'no-console', rule: 'Do not add console.log calls.' },
];

test('choices are none followed by each rule id in order', () => {
  const { choices } = ruleCheck({ rules, filePath: 'a.ts', diff: '+x' });
  assert.deepEqual(choices, [NONE, 'no-any', 'no-console']);
});

test('the question carries every rule, the file and the diff', () => {
  const { question } = ruleCheck({ rules, filePath: 'src/a.ts', diff: '+const x: any = 1;' });
  assert.match(question, /no-any: Do not add the 'any' type\./);
  assert.match(question, /no-console: Do not add console\.log calls\./);
  assert.match(question, /FILE: src\/a\.ts/);
  assert.match(question, /\+const x: any = 1;/);
});
