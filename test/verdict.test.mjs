import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict } from '../src/verdict.mjs';

const choices = ['none', 'no-any'];

test('reads a bare JSON verdict', () => {
  assert.deepEqual(parseVerdict('{"choice":"no-any","confidence":0.9}', choices), { choice: 'no-any', confidence: 0.9 });
});

test('reads a verdict inside a code fence followed by an explanation', () => {
  const text = '```json\n{\n  "choice": "none",\n  "confidence": 0.95\n}\n```\n\nThe edit only adds a test.';
  assert.deepEqual(parseVerdict(text, choices), { choice: 'none', confidence: 0.95 });
});

test('takes the first object when the reply contains more than one', () => {
  const text = '{"choice":"no-any","confidence":0.8}\n{"choice":"none","confidence":0.1}';
  assert.equal(parseVerdict(text, choices).choice, 'no-any');
});

test('clamps confidence to 0..1', () => {
  assert.equal(parseVerdict('{"choice":"none","confidence":7}', choices).confidence, 1);
  assert.equal(parseVerdict('{"choice":"none","confidence":-2}', choices).confidence, 0);
});

test('rejects a choice outside the list', () => {
  assert.throws(() => parseVerdict('{"choice":"made-up","confidence":0.9}', choices), /not in list/);
});

test('rejects replies with no JSON or no usable confidence', () => {
  assert.throws(() => parseVerdict('I think it is fine.', choices), /no JSON/);
  assert.throws(() => parseVerdict('{"choice":"none","confidence":"high"}', choices), /not a number/);
});
