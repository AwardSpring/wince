import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, readAnswer, apiKey, available } from '../src/backends/jev.mjs';

test('buildRequest sends one choice question with a criterion per option', () => {
  const req = buildRequest('Q?', ['none', 'no-any'], { descriptions: { 'no-any': 'No any type.' } });
  assert.equal(req.model, 'jev-latest');
  assert.equal(req.state, 'Q?');
  assert.equal(req.questions.verdict.type, 'choice');
  assert.deepEqual(req.questions.verdict.criteria, { none: 'none', 'no-any': 'No any type.' });
});

test('readAnswer uses the probability of the chosen option as confidence', () => {
  const body = { answers: { verdict: { choice: 'no-any', confidence: 1, probabilities: { none: 0.3, 'no-any': 0.7 } } } };
  assert.deepEqual(readAnswer(body, ['none', 'no-any']).confidence, 0.7);
});

test('readAnswer falls back to confidence when probabilities are missing', () => {
  const body = { answers: { verdict: { choice: 'none', confidence: 0.9 } } };
  assert.equal(readAnswer(body, ['none', 'no-any']).confidence, 0.9);
});

test('readAnswer rejects unknown choices and missing answers', () => {
  assert.throws(() => readAnswer({ answers: { verdict: { choice: 'other', confidence: 1 } } }, ['none']), /no usable choice/);
  assert.throws(() => readAnswer({}, ['none']), /no usable choice/);
});

test('the key comes from the plugin option first, then TYPESAFE_API_KEY, then JEV_API_KEY', () => {
  assert.equal(apiKey({ CLAUDE_PLUGIN_OPTION_JEV_API_KEY: 'a', TYPESAFE_API_KEY: 'b' }), 'a');
  assert.equal(apiKey({ TYPESAFE_API_KEY: 'b', JEV_API_KEY: 'c' }), 'b');
  assert.equal(apiKey({ JEV_API_KEY: 'c' }), 'c');
  assert.equal(available({}), false);
});
