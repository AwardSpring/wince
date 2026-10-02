import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, score, percentile } from '../src/score.mjs';

test('decide stays quiet below the threshold and on none', () => {
  assert.equal(decide({ choice: 'no-any', confidence: 0.79 }, 0.8), 'none');
  assert.equal(decide({ choice: 'no-any', confidence: 0.8 }, 0.8), 'no-any');
  assert.equal(decide({ choice: 'none', confidence: 0.99 }, 0.8), 'none');
});

test('score sorts results into caught, wrong rule, missed and false alarms', () => {
  const row = (id, expected, said, accepted = [expected]) => ({ id, expected, said, accepted });
  const s = score([
    row('a', 'no-any', 'no-any'),
    row('b', 'no-any', 'no-console'),
    row('c', 'no-any', 'none'),
    row('d', 'none', 'none'),
    row('e', 'none', 'no-any'),
    row('f', 'no-any', 'none', ['no-any', 'none']),
  ]);
  assert.deepEqual(s.caught.map((r) => r.id), ['a', 'f']);
  assert.deepEqual(s.wrongRule.map((r) => r.id), ['b']);
  assert.deepEqual(s.missed.map((r) => r.id), ['c']);
  assert.deepEqual(s.falseAlarms.map((r) => r.id), ['e']);
  assert.equal(s.violations.length, 4);
  assert.equal(s.clean.length, 2);
});

test('percentile handles empty and small lists', () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 3);
});
